// ---------------------------------------------------------------------------
// AUTH-1 — end-to-end gate test against the running dev server.
//
// Covers: proxy redirects, login failure/success, cookie minting, protected
// pages + APIs, tampered tokens, logout, login-page bounce for signed-in
// users, rate limiting, and a regression probe of the GPU offers API.
//
// Run:  bun scripts/test-auth.ts   (server must be up on :3000)
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";

const BASE = process.env.AUTH_TEST_BASE ?? "http://localhost:3000";
const SCRIPT_DIR = path.dirname(process.argv[1] ?? process.cwd());
const USERS: Array<{ userId: string; code: string }> = JSON.parse(
  fs.readFileSync(path.join(SCRIPT_DIR, "users.local.json"), "utf8")
);

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

const get = (path: string, cookie?: string) =>
  fetch(BASE + path, {
    redirect: "manual",
    headers: cookie ? { cookie } : undefined,
  });

const post = (path: string, body: unknown, extra: Record<string, string> = {}) =>
  fetch(BASE + path, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json", ...extra },
    body: JSON.stringify(body),
  });

function sessionCookie(res: Response): string {
  const setCookie = res.headers.getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];
  const pair = setCookie.find((c) => c.startsWith("infranex_session="));
  if (!pair) return "";
  return pair.split(";")[0];
}

async function main() {
  const admin = USERS.find((u) => u.userId === "admin");
  if (!admin) throw new Error("admin user missing from users.local.json");

  console.log(`AUTH-1 gate test → ${BASE}\n`);

  // 1 — anonymous page hit bounces to /login
  const anon = await get("/");
  check("GET / anonymous → 307 /login",
    anon.status === 307 && (anon.headers.get("location") ?? "").includes("/login"),
    `status=${anon.status}`);

  // 2 — anonymous API hit gets JSON 401
  const anonApi = await get("/api/deployments");
  check("GET /api/deployments anonymous → 401", anonApi.status === 401,
    `status=${anonApi.status}`);

  // 3 — login page is public
  const loginPage = await get("/login");
  check("GET /login public → 200", loginPage.status === 200, `status=${loginPage.status}`);

  // 4 — wrong code rejected (uniform 401)
  const bad = await post("/api/auth/login", { userId: admin.userId, code: "WRONG-CODE-0000" });
  check("login wrong code → 401", bad.status === 401, `status=${bad.status}`);

  // 5 — unknown user rejected
  const ghost = await post("/api/auth/login", { userId: "ghost", code: "whatever" });
  check("login unknown user → 401", ghost.status === 401, `status=${ghost.status}`);

  // 6 — correct credentials mint the session cookie
  const good = await post("/api/auth/login", { userId: admin.userId, code: admin.code });
  const cookie = sessionCookie(good);
  const goodBody = await good.json().catch(() => ({}));
  check("login admin → 200 + cookie",
    good.status === 200 && cookie.startsWith("infranex_session=v1."),
    `status=${good.status} cookie=${cookie ? "set" : "MISSING"}`);
  check("login payload has user identity",
    goodBody?.user?.userId === "admin" && !!goodBody?.user?.label,
    JSON.stringify(goodBody).slice(0, 80));

  // 7 — session works on pages and APIs
  const home = await get("/", cookie);
  check("GET / with session → 200", home.status === 200, `status=${home.status}`);
  const api = await get("/api/deployments", cookie);
  check("GET /api/deployments with session → 200", api.status === 200, `status=${api.status}`);
  const offers = await get("/api/gpu-offers", cookie);
  check("GET /api/gpu-offers with session → 200 (regression)", offers.status === 200,
    `status=${offers.status}`);

  // 8 — session endpoint identifies the operator
  const sess = await get("/api/auth/session", cookie);
  const sessBody = await sess.json().catch(() => ({}));
  check("GET /api/auth/session → admin", sess.status === 200 && sessBody?.user?.userId === "admin",
    `status=${sess.status}`);

  // 9 — tampered token rejected
  const tampered = cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  const tam = await get("/", tampered);
  check("GET / tampered cookie → 307 /login",
    tam.status === 307 && (tam.headers.get("location") ?? "").includes("/login"),
    `status=${tam.status}`);

  // 10 — signed-in user bounced away from /login
  const bounce = await get("/login", cookie);
  check("GET /login with session → 307 /", bounce.status === 307 &&
    (bounce.headers.get("location") ?? "").endsWith("/"), `status=${bounce.status}`);

  // 11 — logout clears the cookie
  const out = await post("/api/auth/logout", {});
  const cleared = out.headers.getSetCookie?.().join(" ") ?? "";
  check("POST /api/auth/logout → ok + cleared cookie",
    out.status === 200 && /infranex_session=/.test(cleared) && /Max-Age=0/i.test(cleared),
    `status=${out.status}`);

  // 12 — rate limit: 11th consecutive failure from one IP → 429
  const rlIp = "203.0.113.77";
  let lastStatus = 0;
  for (let i = 0; i < 11; i++) {
    const r = await post("/api/auth/login",
      { userId: admin.userId, code: `RL-FAIL-${i}` }, { "x-forwarded-for": rlIp });
    lastStatus = r.status;
  }
  check("rate limit → 429 after 10 failures", lastStatus === 429, `last=${lastStatus}`);

  // 13 — other seeded user can sign in too
  const ops1 = USERS.find((u) => u.userId === "ops01");
  const second = ops1
    ? await post("/api/auth/login", { userId: ops1.userId, code: ops1.code })
    : null;
  check("login ops01 → 200", second?.status === 200, `status=${second?.status}`);

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("test crashed:", e);
  process.exit(1);
});
