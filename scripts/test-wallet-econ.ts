/**
 * WALLET-ECON-1 — live-mining persistence layer, end-to-end against a
 * running server.
 *
 * Usage: BASE=http://localhost:3000 bunx tsx scripts/test-wallet-econ.ts
 * (needs the server up; covers wallet profiles, platform settings, the
 * audit trail, and the economics read model).
 */
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
dotenv.config({ override: true });

const BASE = process.env.BASE ?? "http://localhost:3000";

const USERS: Array<{ userId: string; code: string; role?: string }> = JSON.parse(
  fs.readFileSync(
    path.join(path.dirname(process.argv[1] ?? ""), "users.local.json"),
    "utf8"
  )
);
const admin = USERS.find((u) => u.userId === "admin");
const member = USERS.find((u) => u.userId !== "admin" && u.role !== "admin");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`PASS — ${name}`);
  } else {
    fail++;
    console.log(`FAIL — ${name}${detail ? ` (${detail})` : ""}`);
  }
}

function cookieOf(res: Response): string {
  return (res.headers.getSetCookie?.() ?? []).find((c) => c.startsWith("infranex_session=")) ?? "";
}

let COOKIE = "";

async function api(method: string, path: string, body?: unknown, useCookie = true) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(useCookie && COOKIE ? { cookie: COOKIE } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function main() {
  if (!admin) {
    console.log("FAIL — admin user missing from users.local.json");
    process.exit(1);
  }

  // --- 0. sign in (audit: login.success) ----------------------------------
  const anon = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: admin.userId, code: admin.code }),
  });
  COOKIE = cookieOf(anon);
  check("admin login", anon.status === 200 && COOKIE.length > 0, `status ${anon.status}`);

  // Gates: unauthenticated requests are bounced by the edge proxy.
  const noAuth = await api("GET", "/api/wallets", undefined, false);
  check("wallets GET without session -> 401", noAuth.status === 401, `status ${noAuth.status}`);

  // --- 1. wallet profiles --------------------------------------------------
  let r = await api("GET", "/api/wallets");
  check("wallets GET (session) -> 200 + array", r.status === 200 && Array.isArray(r.json?.wallets));
  const before = r.json.wallets.length;

  const unique = Date.now().toString(36);
  r = await api("POST", "/api/wallets", {
    label: `Suite wallet ${unique}`,
    walletName: `suite-${unique}`,
    hotkeyName: "miner",
    coldAddress: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY", // valid SS58 shape
    hotAddress: "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",
  });
  check("wallet POST -> 201", r.status === 201, `status ${r.status} ${JSON.stringify(r.json)}`);
  const wid = r.json?.wallet?.id as string | undefined;
  check("wallet POST returns id + isDefault false", Boolean(wid) && r.json.wallet.isDefault === false);

  r = await api("POST", "/api/wallets", {
    label: "dup",
    walletName: `suite-${unique}`,
    hotkeyName: "miner",
  });
  check("wallet POST duplicate pair -> 409", r.status === 409, `status ${r.status}`);

  r = await api("POST", "/api/wallets", { label: "bad name", walletName: "bad name; rm -rf", hotkeyName: "x" });
  check("wallet POST shell-unsafe name -> 400", r.status === 400, `status ${r.status}`);

  r = await api("POST", "/api/wallets", {
    label: "secrets rejected",
    walletName: `suite2-${unique}`,
    hotkeyName: "m",
    mnemonic: "this is never stored anywhere",
  });
  check("wallet POST containing secret material -> 400", r.status === 400, `status ${r.status}`);

  r = await api("POST", "/api/wallets", { label: "bad addr", walletName: `suite3-${unique}`, hotkeyName: "m", hotAddress: "not-ss58" });
  check("wallet POST invalid SS58 -> 400", r.status === 400, `status ${r.status}`);

  // --- 2. settings ---------------------------------------------------------
  r = await api("GET", "/api/settings");
  check("settings GET -> 200 with defaults", r.status === 200 && r.json?.settings?.chainNetwork === "finney");
  const settingsBefore = r.json?.settings;

  r = await api("PATCH", `/api/wallets/${wid}`, { isDefault: true });
  check("wallet PATCH set default -> 200 + flag", r.status === 200 && r.json?.wallet?.isDefault === true);

  r = await api("GET", "/api/settings");
  check("default wallet propagated to settings", r.json?.settings?.defaultWalletProfileId === wid, JSON.stringify(r.json?.settings));

  r = await api("PUT", "/api/settings", { registrationBufferTao: 1.5 });
  check("settings PUT admin -> 200 buffer 1.5", r.status === 200 && r.json?.settings?.registrationBufferTao === 1.5);

  r = await api("PUT", "/api/settings", { chainNetwork: "not-a-network" });
  check("settings PUT invalid network -> 400", r.status === 400);

  r = await api("POST", "/api/settings");
  check("master-key backup ack -> timestamp set", r.status === 200 && typeof r.json?.settings?.masterKeyBackedUpAt === "string");

  // Member gating.
  if (member) {
    const mres = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.userId, code: member.code }),
    });
    const mCookie = cookieOf(mres);
    check("member login", mres.status === 200 && mCookie.length > 0);
    const saved = COOKIE;
    COOKIE = mCookie;

    r = await api("PUT", "/api/settings", { registrationBufferTao: 5 });
    check("settings PUT as member -> 403", r.status === 403, `status ${r.status}`);

    r = await api("GET", "/api/audit");
    check("audit GET as member -> 403", r.status === 403, `status ${r.status}`);

    r = await api("GET", "/api/economics");
    check("economics GET as member -> 200 (read ok)", r.status === 200);

    COOKIE = saved;
  }

  // --- 3. audit trail ------------------------------------------------------
  r = await api("GET", "/api/audit?limit=100");
  check("audit GET admin -> 200 array", r.status === 200 && Array.isArray(r.json?.entries));
  const entries = r.json?.entries ?? [];
  const actions = new Set(entries.map((e: { action: string }) => e.action));
  check("audit has login.success", actions.has("login.success"));
  check("audit has wallet.saved", actions.has("wallet.saved"));
  check("audit has settings.updated", actions.has("settings.updated"));
  check("audit has settings.master-key-acked", actions.has("settings.master-key-acked"));
  const walletEntry = entries.find((e: { action: string; detail: string }) => e.action === "wallet.saved");
  check("audit wallet entry carries no secret material", walletEntry && !JSON.stringify(entries).includes("mnemonic"));

  // --- 4. economics read model --------------------------------------------
  r = await api("GET", "/api/economics?days=30");
  check("economics GET -> 200 shape", r.status === 200 && Array.isArray(r.json?.days) && typeof r.json?.totals === "object" && Array.isArray(r.json?.byDeployment));
  check(
    "economics totals numeric + consistent",
    typeof r.json.totals.spendUsd === "number" &&
      typeof r.json.totals.earnedTao === "number" &&
      Math.abs(r.json.totals.netUsd - (r.json.totals.earnedUsd - r.json.totals.spendUsd)) < 0.02
  );

  // --- 5. cleanup: delete the profile, default must clear ------------------
  r = await api("DELETE", `/api/wallets/${wid}`);
  check("wallet DELETE -> 200", r.status === 200);
  r = await api("GET", "/api/settings");
  check("default cleared after delete", r.json?.settings?.defaultWalletProfileId !== wid);
  r = await api("GET", "/api/wallets");
  check("wallets count back to baseline", r.json.wallets.length === before, `${r.json.wallets.length} vs ${before}`);
  // restore the settings mutated by the suite
  await api("PUT", "/api/settings", { registrationBufferTao: settingsBefore?.registrationBufferTao ?? 1 });

  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
