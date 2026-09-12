// ---------------------------------------------------------------------------
// ADMINPANEL-1 — admin credential panel test against a running dev server.
//
// Covers: role gating (anonymous 401, member 403), the admin list with
// viewable codes, regeneration (old code dies, new code signs in, mirror
// files update), disable/enable sign-in enforcement, and the self-disable
// guard. Uses a THROWAWAY temp user for mutations so the 5 real credentials
// stay exactly as delivered.
//
// Run:  bun scripts/test-admin-users.ts   (server up on :3000)
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ override: true });
import { PrismaClient } from "@prisma/client";

const BASE = process.env.AUTH_TEST_BASE ?? "http://localhost:3000";
const SCRIPT_DIR = path.dirname(process.argv[1] ?? process.cwd());
const USERS: Array<{ userId: string; code: string }> = JSON.parse(
  fs.readFileSync(path.join(SCRIPT_DIR, "users.local.json"), "utf8")
);
const CODE_RE = /^[A-HJ-KM-NP-Z2-9]{4}(-[A-HJ-KM-NP-Z2-9]{4}){3}$/;
const db = new PrismaClient();
const TEMP = "testtmp1";

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function api(method: string, p: string, body?: unknown, cookie?: string) {
  const res = await fetch(`${BASE}${p}`, {
    method,
    redirect: "manual",
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json, setCookie: res.headers.getSetCookie?.() ?? [] };
}

function cookieOf(res: { setCookie: string[] }): string {
  const pair = res.setCookie.find((c) => c.startsWith("infranex_session="));
  return pair ? pair.split(";")[0] : "";
}

async function login(userId: string, code: string): Promise<string> {
  const res = await api("POST", "/api/auth/login", { userId, code });
  return cookieOf(res);
}

async function main() {
  console.log(`ADMINPANEL-1 test → ${BASE}\n`);

  try {
    const admin = USERS.find((u) => u.userId === "admin")!;
    const ops01 = USERS.find((u) => u.userId === "ops01")!;

    // --- role gating ------------------------------------------------------
    const anon = await api("GET", "/api/admin/users");
    check("anonymous GET → 401 (proxy gate)", anon.status === 401, `got ${anon.status}`);

    const adminCookie = await login(admin.userId, admin.code);
    check("admin login works", adminCookie.startsWith("infranex_session="));

    const memberCookie = await login(ops01.userId, ops01.code);
    const memberGet = await api("GET", "/api/admin/users", undefined, memberCookie);
    check("member GET → 403", memberGet.status === 403, `got ${memberGet.status}`);
    const memberPost = await api(
      "POST", "/api/admin/users",
      { action: "regenerate", userId: "admin" }, memberCookie
    );
    check("member POST regenerate → 403", memberPost.status === 403, `got ${memberPost.status}`);

    // --- admin list shows viewable codes ----------------------------------
    const list = await api("GET", "/api/admin/users", undefined, adminCookie);
    const users = (list.json?.users ?? []) as Array<Record<string, unknown>>;
    check("admin GET → 200 with 5 users", list.status === 200 && users.length === 5,
      `got ${list.status}/${users.length}`);
    const allCodes = users.every((u) => typeof u.code === "string" && CODE_RE.test(u.code as string));
    check("every user has a viewable XXXX-XXXX-XXXX-XXXX code", allCodes,
      JSON.stringify(users.map((u) => [u.userId, u.code])));
    const adminRow = users.find((u) => u.userId === "admin");
    check("admin row code matches the credential file", adminRow?.code === admin.code);

    // --- temp user for mutations (real credentials stay untouched) --------
    await db.appUser.upsert({
      where: { userId: TEMP },
      create: { userId: TEMP, codeHash: "s1:00:00", label: "Temp", role: "member" },
      update: {},
    });

    const regen = await api("POST", "/api/admin/users",
      { action: "regenerate", userId: TEMP }, adminCookie);
    const newCode = regen.json?.code as string | undefined;
    check("regenerate temp → 200 + new code", regen.status === 200 && CODE_RE.test(newCode ?? ""),
      `got ${regen.status} code=${newCode}`);

    const oldLogin = await api("POST", "/api/auth/login", { userId: TEMP, code: "XXXX-XXXX-XXXX-XXXX" });
    check("old/unknown code rejected after regen", oldLogin.status === 401);
    const newLogin = await api("POST", "/api/auth/login", { userId: TEMP, code: newCode! });
    check("new code signs in", newLogin.status === 200, `got ${newLogin.status}`);

    // --- mirror files updated ---------------------------------------------
    const mirror = JSON.parse(
      fs.readFileSync(path.join(SCRIPT_DIR, "users.local.json"), "utf8")
    ) as Array<{ userId: string; code: string }>;
    const mirrorTemp = mirror.find((u) => u.userId === TEMP);
    check("repo mirror contains temp user's NEW code", mirrorTemp?.code === newCode);
    const backupExists = fs.existsSync("/tmp/my-project/infranex-users.local.json");
    check("wipe-proof mirror exists", backupExists);
    if (backupExists) {
      const backup = JSON.parse(
        fs.readFileSync("/tmp/my-project/infranex-users.local.json", "utf8")
      ) as Array<{ userId: string; code: string }>;
      check("backup mirror matches repo mirror", backup.find((u) => u.userId === TEMP)?.code === newCode);
    }
    const realCodeIntact = mirror.find((u) => u.userId === "admin")?.code === admin.code;
    check("real admin code untouched by temp regen", realCodeIntact);

    // --- disable / enable ---------------------------------------------------
    const off = await api("POST", "/api/admin/users",
      { action: "setActive", userId: TEMP, active: false }, adminCookie);
    check("disable temp → ok", off.status === 200);
    const offLogin = await api("POST", "/api/auth/login", { userId: TEMP, code: newCode! });
    check("disabled user cannot sign in", offLogin.status === 401, `got ${offLogin.status}`);
    const on = await api("POST", "/api/admin/users",
      { action: "setActive", userId: TEMP, active: true }, adminCookie);
    const onLogin = await api("POST", "/api/auth/login", { userId: TEMP, code: newCode! });
    check("re-enabled user signs in again", on.status === 200 && onLogin.status === 200);

    // --- self-disable guard -------------------------------------------------
    const selfOff = await api("POST", "/api/admin/users",
      { action: "setActive", userId: "admin", active: false }, adminCookie);
    check("admin cannot disable own account → 400", selfOff.status === 400, `got ${selfOff.status}`);

    // --- bad requests -------------------------------------------------------
    const unknown = await api("POST", "/api/admin/users",
      { action: "regenerate", userId: "ghost" }, adminCookie);
    check("regenerate unknown user → 404", unknown.status === 404);
    const badAction = await api("POST", "/api/admin/users",
      { action: "explode" }, adminCookie);
    check("unknown action → 400", badAction.status === 400);
  } finally {
    await db.appUser.deleteMany({ where: { userId: TEMP } }).catch(() => undefined);
    // Re-sync mirrors without the temp user.
    const { syncCredentialFiles } = await import("../src/lib/auth-users");
    await syncCredentialFiles().catch(() => undefined);
    await db.$disconnect();
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if (fail > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(1);
});
