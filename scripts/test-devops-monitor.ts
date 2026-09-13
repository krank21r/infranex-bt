// ---------------------------------------------------------------------------
// DEVOPS-1 — DevOps engine test against a running dev server.
//
// Covers: auth gating on the monitor API (anon 401, member 200 — the board
// is for all operators), payload shape, the devops pass riding POST
// /api/triggers {action:"run"}, mock deployments sampling without alarms,
// real deployments without a daemon raising a deduped GPU_HEALTH invite,
// GpuSample history persistence, and the scheduled devops-monitor worker
// being alive (boot-time instrumentation).
//
// Throwaway deployments (TESTDEVOPS*) are used for mutations and fully
// cleaned up — nothing else in the DB is touched.
//
// Run:  bun scripts/test-devops-monitor.ts   (server up on :3000)
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

const MOCK_DEP = "TESTDEVOPS-mock";
const REAL_DEP = "TESTDEVOPS-real";

async function createTempDeployment(id: string, mode: string): Promise<void> {
  await db.deployment.create({
    data: {
      id,
      minerName: `devops-test-${mode}`,
      netuid: 999,
      subnetName: "DevOps Test Subnet",
      gpuModel: "TestGPU",
      provider: "runpod",
      mode,
      status: "started",
      hourlyCost: 0.12,
      monthlyCost: 87.6,
      config: "{}",
    },
  });
}

async function cleanup() {
  for (const id of [MOCK_DEP, REAL_DEP]) {
    await db.gpuSample.deleteMany({ where: { deploymentId: id } });
    await db.triggerEvent.deleteMany({ where: { deploymentId: id } });
    await db.uidSnapshot.deleteMany({ where: { deploymentId: id } });
    await db.daemonState.deleteMany({ where: { deploymentId: id } });
    await db.deployment.deleteMany({ where: { id } });
  }
}

async function main() {
  console.log(`DEVOPS-1 test → ${BASE}\n`);

  try {
    await cleanup();

    // --- auth gating -------------------------------------------------------
    const anon = await api("GET", "/api/devops/monitor");
    check("anonymous GET monitor → 401 (proxy gate)", anon.status === 401, `got ${anon.status}`);

    const admin = USERS.find((u) => u.userId === "admin")!;
    const ops01 = USERS.find((u) => u.userId === "ops01")!;
    const adminCookie = await login(admin.userId, admin.code);
    check("admin login works", adminCookie.startsWith("infranex_session="));
    const memberCookie = await login(ops01.userId, ops01.code);

    // The DevOps board is an OPERATIONS view — every signed-in operator sees it.
    const memberMon = await api("GET", "/api/devops/monitor", undefined, memberCookie);
    check(
      "member GET monitor → 200 with ok payload",
      memberMon.status === 200 && memberMon.json?.ok === true,
      `got ${memberMon.status}`
    );

    const mon = await api("GET", "/api/devops/monitor", undefined, adminCookie);
    check("admin GET monitor → 200", mon.status === 200, `got ${mon.status}`);
    const payload = mon.json ?? {};
    check(
      "payload has summary block (monitored/healthy/warning/critical/daemons/open)",
      ["monitored", "healthy", "warning", "critical", "daemonsOnline", "openRecommendations"].every(
        (k) => typeof payload.summary?.[k] === "number"
      ),
      JSON.stringify(payload.summary)
    );
    check("payload has miners array", Array.isArray(payload.miners));
    check("payload has openEvents + recentEvents arrays", Array.isArray(payload.openEvents) && Array.isArray(payload.recentEvents));
    check(
      "payload carries engine thresholds (tempWarnC/tempCriticalC/utilFloorPct)",
      typeof payload.thresholds?.tempWarnC === "number" &&
        typeof payload.thresholds?.tempCriticalC === "number" &&
        typeof payload.thresholds?.utilFloorPct === "number",
      JSON.stringify(payload.thresholds)
    );

    // --- devops pass rides the manual run ----------------------------------
    const run = await api("POST", "/api/triggers", { action: "run" }, adminCookie);
    check(
      "POST triggers run → pass.devopsEvaluated present (devops pass rides)",
      run.status === 200 && typeof run.json?.pass?.devopsEvaluated === "number",
      `got ${run.status} pass=${JSON.stringify(run.json?.pass)}`
    );

    // --- scheduled worker alive (boot-time instrumentation) -----------------
    // Give the boot/immediate worker run a moment to log.
    await new Promise((r) => setTimeout(r, 3000));
    const workerRow = await db.workerStatus.findFirst({
      where: { workerName: "devops-monitor" },
      orderBy: { createdAt: "desc" },
    });
    check(
      "devops-monitor worker has logged a pass (WorkerStatus row)",
      workerRow !== null && workerRow.status === "completed",
      workerRow ? `status=${workerRow.status}` : "no row found"
    );

    // --- mock deployment: sampled, never alarmed ----------------------------
    await createTempDeployment(MOCK_DEP, "mock");
    await api("POST", "/api/triggers", { action: "run" }, adminCookie);
    const mockSample = await db.gpuSample.findFirst({ where: { deploymentId: MOCK_DEP } });
    check("mock started deployment gets a GpuSample heartbeat", mockSample !== null);
    check("mock sample tagged daemonStatus=mock", mockSample?.daemonStatus === "mock");
    const mockAlarms = await db.triggerEvent.findMany({
      where: { deploymentId: MOCK_DEP, kind: { in: ["GPU_HEALTH", "SUBNET_DRIFT"] }, status: "open" },
    });
    check("mock deployment raises NO GPU_HEALTH/SUBNET_DRIFT alarms", mockAlarms.length === 0,
      JSON.stringify(mockAlarms.map((a) => a.kind)));

    // --- real deployment without daemon: deduped GPU_HEALTH invite ----------
    await createTempDeployment(REAL_DEP, "runpod");
    await api("POST", "/api/triggers", { action: "run" }, adminCookie);
    const noDaemon = await db.triggerEvent.findFirst({
      where: { deploymentId: REAL_DEP, kind: "GPU_HEALTH", status: "open" },
    });
    check(
      "real deployment without daemon → open GPU_HEALTH (no-daemon) event",
      noDaemon !== null,
      "no event found"
    );
    await api("POST", "/api/triggers", { action: "run" }, adminCookie);
    const noDaemonCount = await db.triggerEvent.count({
      where: { deploymentId: REAL_DEP, kind: "GPU_HEALTH", status: "open" },
    });
    check("second pass dedupes — still exactly 1 open GPU_HEALTH event", noDaemonCount === 1,
      `count=${noDaemonCount}`);
    check("no-daemon event is severity info with runbook",
      noDaemon?.severity === "info" && JSON.parse(noDaemon.runbookJson).length >= 2);

    // --- monitor payload reflects the temp miners ---------------------------
    // Two cache layers must expire first: the monitor payload micro-cache
    // (10s) and the monitoring overview cache (30s). Poll until the board
    // rebuilds with the throwaway miners (timeout ~60s).
    let miners: Array<{ deploymentId: string; mode: string; daemon: unknown }> = [];
    let mockInBoard: { deploymentId: string; mode: string; daemon: unknown } | undefined;
    let realInBoard: { deploymentId: string; mode: string; daemon: unknown } | undefined;
    let openEvents: Array<{ kind: string }> = [];
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 4000));
      const mon2 = await api("GET", "/api/devops/monitor", undefined, adminCookie);
      miners = (mon2.json?.miners ?? []) as typeof miners;
      openEvents = (mon2.json?.openEvents ?? []) as Array<{ kind: string }>;
      mockInBoard = miners.find((m) => m.deploymentId === MOCK_DEP);
      realInBoard = miners.find((m) => m.deploymentId === REAL_DEP);
      if (mockInBoard && realInBoard) break;
    }
    check(
      "monitor board includes the mock temp miner",
      mockInBoard !== undefined && mockInBoard.mode === "mock"
    );
    check(
      "real temp miner shows daemon missing in board",
      realInBoard !== undefined && realInBoard.daemon === null,
      JSON.stringify(realInBoard ?? {})
    );

    // --- new trigger kinds render in the payload ----------------------------
    const kindsOk = openEvents.every((e) =>
      ["RE_SYNC", "SCALE", "KILL", "DEREG_RISK", "GPU_HEALTH", "SUBNET_DRIFT"].includes(e.kind)
    );
    check("all open events use known TriggerKinds (incl. GPU_HEALTH/SUBNET_DRIFT)", kindsOk);
  } finally {
    await cleanup();
    const left = await db.deployment.count({ where: { id: { in: [MOCK_DEP, REAL_DEP] } } });
    check("cleanup removed throwaway deployments + samples + events", left === 0, `left=${left}`);
    await db.$disconnect();
  }

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("fatal:", e);
  await cleanup().catch(() => {});
  await db.$disconnect();
  process.exit(1);
});
