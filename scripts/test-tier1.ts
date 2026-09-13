// ---------------------------------------------------------------------------
// TIER1-1 — Live Logs + Health Score + Fleet Economics tests.
//
// Three layers:
//   A. Pure health scorer (computeMinerHealth) — perfect/blind/broken/mock
//      inputs, hard-fail rules, factor-sum invariant.
//   B. MinerLog ingest lib (parseLogLine / ingestMinerLogs / simulateMockLogs)
//      — dedupe on lineKey, retention cap, severity fallback.
//   C. Live server — /api/devops/monitor payload carries health + logs +
//      machine + fleet economics per miner; a mock pass populates the log
//      panel; anonymous requests stay 401.
//
// Throwaway deployment (TESTT1-mock) is fully cleaned up.
//
// Run:  bun scripts/test-tier1.ts   (server up on :3000)
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ override: true });
import { PrismaClient } from "@prisma/client";

import {
  computeMinerHealth,
  HEALTH_THRESHOLDS,
  type MinerHealthInput,
} from "../src/lib/infranex/health-score";
import {
  parseLogLine,
  ingestMinerLogs,
  simulateMockLogs,
  LOG_RETENTION,
} from "../src/lib/infranex/miner-logs";

const BASE = process.env.AUTH_TEST_BASE ?? "http://localhost:3000";
const SCRIPT_DIR = path.dirname(process.argv[1] ?? process.cwd());
const USERS: Array<{ userId: string; code: string }> = JSON.parse(
  fs.readFileSync(path.join(SCRIPT_DIR, "users.local.json"), "utf8")
);
const db = new PrismaClient();

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

const MOCK_DEP = "TESTT1-mock";
const BASE_INPUT: MinerHealthInput = {
  processAlive: true,
  hasDaemon: true,
  daemonSilent: false,
  tempC: 60,
  tempWarnC: 78,
  tempCriticalC: 85,
  utilPct: 90,
  utilFloorPct: 30,
  probeOk: true,
  probeTotalMs: 450,
  probeSuccessRatePct: 100,
  trafficRequests: 40,
  queryDrought: false,
  uidRisk: "healthy",
};

// ---------------------------------------------------------------------------

function testHealthScorer() {
  console.log("\n-- A. health scorer (pure) --");

  const perfect = computeMinerHealth(BASE_INPUT);
  check("perfect inputs score 100 / healthy", perfect.score === 100 && perfect.status === "healthy", `score=${perfect.score}`);
  check("perfect has 7 factors, all maxed", perfect.factors.length === 7 && perfect.factors.every((f) => f.score === f.max));

  const blind: MinerHealthInput = {
    ...BASE_INPUT,
    processAlive: null,
    hasDaemon: false,
    probeOk: null,
    probeTotalMs: null,
    probeSuccessRatePct: null,
    tempC: null,
    utilPct: null,
    trafficRequests: null,
    uidRisk: null,
  };
  const blindScore = computeMinerHealth(blind);
  check(
    "fully-blind miner degrades to warning (unknown ≠ dead)",
    blindScore.status === "warning" && blindScore.score >= 60 && blindScore.score < 85,
    `score=${blindScore.score} status=${blindScore.status}`
  );

  const down = computeMinerHealth({ ...BASE_INPUT, processAlive: false });
  check(
    "process down → hard-fail critical (score 75)",
    down.status === "critical" && down.score === 75,
    `score=${down.score} status=${down.status}`
  );

  const deadAxon = computeMinerHealth({ ...BASE_INPUT, probeOk: false });
  check(
    "dead axon probe → hard-fail critical (score 80)",
    deadAxon.status === "critical" && deadAxon.score === 80,
    `score=${deadAxon.score}`
  );

  const thermal = computeMinerHealth({ ...BASE_INPUT, tempC: 90 });
  check(
    "thermal emergency → hard-fail critical (score 85)",
    thermal.status === "critical" && thermal.score === 85,
    `score=${thermal.score}`
  );

  const silent = computeMinerHealth({ ...BASE_INPUT, daemonSilent: true });
  check(
    "silent daemon → warning (75: process unknown + no telemetry)",
    silent.status === "warning" && silent.score === 75,
    `score=${silent.score} status=${silent.status}`
  );

  const drought = computeMinerHealth({ ...BASE_INPUT, queryDrought: true });
  check("query drought costs traffic points but stays healthy", drought.score === 93 && drought.status === "healthy", `score=${drought.score}`);

  // MOCK-PURGE-1: the isMock forced-healthy path was removed — every miner
  // scores honestly from its real telemetry (or its absence).

  const sumInvariant = [perfect, blindScore, down, deadAxon, thermal, silent, drought].every(
    (h) => h.factors.reduce((a, f) => a + f.score, 0) === h.score
  );
  check("factor scores always sum to the total score", sumInvariant);
  check("thresholds sanity: healthyAt > warningAt", HEALTH_THRESHOLDS.healthyAt > HEALTH_THRESHOLDS.warningAt);
}

// ---------------------------------------------------------------------------

async function testLogLib() {
  console.log("\n-- B. MinerLog ingest lib --");

  const bad = parseLogLine(MOCK_DEP, { message: "   " });
  check("parseLogLine rejects empty messages", bad === null);

  const parsed = parseLogLine(MOCK_DEP, { at: 1_700_000_000, severity: "bogus", message: "forward pass complete in 218ms" });
  check(
    "parseLogLine falls back severity=info, converts epoch seconds",
    parsed !== null && parsed.severity === "info" && parsed.at.getTime() === 1_700_000_000_000,
    JSON.stringify(parsed)
  );

  await db.minerLog.deleteMany({ where: { deploymentId: MOCK_DEP } });

  const n1 = await ingestMinerLogs(MOCK_DEP, [
    { at: Date.now() / 1000, severity: "info", message: "line one" },
    { at: Date.now() / 1000, severity: "warning", message: "line two" },
    { at: Date.now() / 1000, severity: "error", message: "boom" },
  ]);
  check("ingest stores 3 fresh lines", n1 === 3, `stored=${n1}`);

  const n2 = await ingestMinerLogs(MOCK_DEP, [
    { at: Date.now() / 1000, severity: "info", message: "line one" },
    { at: Date.now() / 1000, severity: "warning", message: "line two" },
    { at: Date.now() / 1000, severity: "info", message: "line four (new)" },
  ]);
  check("daemon retry dedupes repeats, stores only the new line", n2 === 1, `stored=${n2}`);

  const n3 = await simulateMockLogs(MOCK_DEP);
  check("simulateMockLogs populates 1-2 lines for mock fleets", n3 >= 1, `stored=${n3}`);

  // Retention — push a big batch through and expect the cap to hold.
  const flood = Array.from({ length: LOG_RETENTION + 40 }, (_, i) => ({
    at: Date.now() / 1000,
    severity: "info",
    message: `flood ${Date.now()}-${i}`,
  }));
  await ingestMinerLogs(MOCK_DEP, flood);
  const count = await db.minerLog.count({ where: { deploymentId: MOCK_DEP } });
  check(`retention cap holds at ${LOG_RETENTION} rows`, count <= LOG_RETENTION, `rows=${count}`);

  const severities = await db.minerLog.findMany({ where: { deploymentId: MOCK_DEP }, select: { severity: true } });
  check(
    "all stored severities are in the allowed set",
    severities.every((s) => ["info", "success", "warning", "error"].includes(s.severity))
  );
}

// ---------------------------------------------------------------------------

async function cleanup() {
  await db.minerLog.deleteMany({ where: { deploymentId: MOCK_DEP } });
  await db.gpuSample.deleteMany({ where: { deploymentId: MOCK_DEP } });
  await db.probeSample.deleteMany({ where: { deploymentId: MOCK_DEP } });
  await db.trafficSample.deleteMany({ where: { deploymentId: MOCK_DEP } });
  await db.triggerEvent.deleteMany({ where: { deploymentId: MOCK_DEP } });
  await db.uidSnapshot.deleteMany({ where: { deploymentId: MOCK_DEP } });
  await db.daemonState.deleteMany({ where: { deploymentId: MOCK_DEP } });
  await db.deployment.deleteMany({ where: { id: MOCK_DEP } });
}

async function main() {
  testHealthScorer();
  await testLogLib();

  console.log("\n-- C. live server payload --");

  const anon = await api("GET", "/api/devops/monitor");
  check("anon monitor request is 401", anon.status === 401, `status=${anon.status}`);

  const creds = USERS.find((u) => u.userId === "ops01") ?? USERS[0];
  const cookie = await login(creds.userId, creds.code);
  check("login works", cookie !== "");

  // Create the throwaway mock deployment and run one pass so the board has
  // fresh samples + simulated logs for it.
  await db.deployment.create({
    data: {
      id: MOCK_DEP,
      minerName: "TESTT1 mock miner",
      netuid: 1,
      subnetName: "test",
      gpuModel: "MOCK-GPU",
      provider: "mock",
      status: "started",
      mode: "mock",
      hourlyCost: 0.12,
      monthlyCost: 86.4,
      config: "{}",
    },
  });
  await api("POST", "/api/triggers", { action: "run" }, cookie);

  // The monitor route micro-caches 10s — poll until the new miner shows up.
  let payload: {
    summary?: Record<string, number | null>;
    miners?: Array<Record<string, unknown> & { deploymentId: string; mode: string }>;
  } | null = null;
  for (let i = 0; i < 10; i++) {
    const res = await api("GET", "/api/devops/monitor", undefined, cookie);
    if (res.status === 200) {
      payload = res.json;
      if (payload?.miners?.some((m) => m.deploymentId === MOCK_DEP)) break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  const mine = payload?.miners?.find((m) => m.deploymentId === MOCK_DEP);
  check("monitor payload includes the new mock miner", mine !== undefined);

  const health = mine?.health as { score: number; status: string; factors: unknown[]; simulated?: boolean } | undefined;
  // MOCK-PURGE-1 — no forced-healthy mock path: a miner with no daemon,
  // telemetry, or probe scores honestly mid-range (UNKNOWN ≠ BAD).
  check(
    "mock miner health present and honest (mid-range, no simulated flag)",
    health !== undefined && health.simulated === undefined && health.status === "warning" &&
      health.score >= 50 && health.score < 85,
    JSON.stringify(health)
  );
  check("health carries the 7-factor breakdown", health?.factors?.length === 7);

  const logs = (mine?.logs as { at: string; severity: string; message: string }[] | undefined) ?? [];
  check("mock miner has live log lines after the pass", logs.length >= 1, `lines=${logs.length}`);
  check(
    "log lines are newest-first with valid severities",
    logs.every((l) => ["info", "success", "warning", "error"].includes(l.severity)) &&
      logs.every((l, i) => i === 0 || logs[i - 1].at >= l.at)
  );

  const summary = payload?.summary as Record<string, number | null> | undefined;
  check(
    "fleet economics present: infra cost / revenue / net / avg health",
    summary !== undefined &&
      typeof summary.infraCostUsdPerDay === "number" &&
      typeof summary.revenueUsdPerDay === "number" &&
      typeof summary.netUsdPerDay === "number" &&
      (typeof summary.avgHealthScore === "number" || summary.avgHealthScore === null),
    JSON.stringify(summary ?? {})
  );
  check(
    "net/day equals revenue minus cost",
    summary != null &&
      Math.abs((summary.netUsdPerDay as number) - ((summary.revenueUsdPerDay as number) - (summary.infraCostUsdPerDay as number))) < 0.01
  );

  const machine = mine?.machine as Record<string, unknown> | null | undefined;
  check("machine facts null or well-shaped", machine === null || machine === undefined || (typeof machine.hostId === "string" && typeof machine.status === "string"), JSON.stringify(machine ?? null));

  try {
    await cleanup();
    const left = await db.deployment.count({ where: { id: MOCK_DEP } });
    check("cleanup removed the throwaway deployment + logs + samples", left === 0);
    await db.$disconnect();
  } finally {
    // retention rows for other deployments must be untouched
    console.log(`\n${pass} PASS / ${fail} FAIL`);
    process.exit(fail > 0 ? 1 : 0);
  }
}

main().catch(async (e) => {
  console.error("fatal:", e);
  await cleanup().catch(() => {});
  await db.$disconnect();
  process.exit(1);
});
