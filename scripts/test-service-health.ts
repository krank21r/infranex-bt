// ---------------------------------------------------------------------------
// DEVOPS-4 — Service Health & Validator Traffic — test against a running dev
// server + direct lib calls.
//
// Covers:
//   - pure math: rollingMedianMs, isSlowProbe (absolute + ratio lines),
//     droughtVerdict (meaningful/candidate gates, unknown never droughts)
//   - probe lifecycle (DI probe + DI endpoint resolver): ok pass → fail
//     streak ×2 → PROBE_FAIL critical w/ restart plan → recovery resolves
//   - slow lifecycle: sustained slow probes → SERVICE_LATENCY w/ p50/p95
//     evidence → recovery resolves
//   - drought lifecycle (DI traffic): baseline stream → collapse ×3 windows
//     → QUERY_DROUGHT → recovery resolves; unknown traffic never alarms
//   - mock deployments: simulated probe + traffic samples, never alarm,
//     stale alarms cleared
//   - API: anonymous act → 401; POST run reports serviceEvaluated; monitor
//     payload carries per-miner service blocks + serviceThresholds
//   - approval-gated executor: approved PROBE_FAIL "restart" event → act →
//     restart_miner queued via the daemon, ACTION note recorded
//
// Throwaway deployments (TESTSVC*) are fully cleaned up.
//
// Run:  bun scripts/test-service-health.ts   (server up on :3000)
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ override: true });
import { PrismaClient } from "@prisma/client";
import {
  rollingMedianMs,
  isSlowProbe,
  droughtVerdict,
  runServiceHealthPass,
  resetServiceStateForTests,
  SERVICE_THRESHOLDS,
  type ProbeOutcome,
} from "../src/lib/infranex/service-health";

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

// --- fixtures ---------------------------------------------------------------

const DEP_PROBE = "TESTSVC-probe";
const DEP_MOCK = "TESTSVC-mock";
const DEP_ACT = "TESTSVC-act";
const ALL_DEPS = [DEP_PROBE, DEP_MOCK, DEP_ACT];

const CONFIG = JSON.stringify({
  docker: { command: "python neurons/miner.py --netuid 952" },
  miner: { walletName: "svcwallet", hotkeyName: "default", netuid: 952, axonPort: 8091 },
});

async function createDep(id: string, mode: string) {
  await db.deployment.create({
    data: {
      id,
      minerName: `svc-test-${id}`,
      netuid: 952,
      subnetName: "Service Test Subnet",
      gpuModel: "TestGPU",
      provider: "runpod",
      mode,
      status: "started",
      hourlyCost: 0.12,
      monthlyCost: 87.6,
      config: CONFIG,
    },
  });
}

async function createOnlineDaemon(deploymentId: string) {
  await db.daemonState.create({
    data: {
      deploymentId,
      status: "online",
      secretEnc: "test-secret",
      commandsJson: "[]",
      lastSeenAt: new Date(),
    },
  });
}

function okProbe(totalMs: number): ProbeOutcome {
  return { ok: true, httpStatus: 200, ttfbMs: Math.round(totalMs / 2), totalMs, errorKind: null, errorDetail: null };
}
function failProbe(kind: ProbeOutcome["errorKind"], detail: string): ProbeOutcome {
  return { ok: false, httpStatus: null, ttfbMs: null, totalMs: 0, errorKind: kind, errorDetail: detail };
}
function trafficOf(requests: number | null) {
  return {
    windowMinutes: 60,
    requests,
    distinctValidators: requests === null ? null : 4,
    topValidatorHotkey: requests === null ? null : "5DroughtTestValidatorHotkeyXXXXXXXXXXXXXXXXXR9",
    topValidatorCount: requests === null ? null : Math.max(1, Math.floor(requests / 3)),
    logFound: requests !== null,
  };
}

/** Latest event for a dep+kind regardless of status (assertion helper). */
async function latestEvent(depId: string, kind: string) {
  return db.triggerEvent.findFirst({
    where: { deploymentId: depId, kind },
    orderBy: { createdAt: "desc" },
  });
}

/** OPEN event for a dep+kind — negative assertions must ignore resolved history. */
async function openEvent(depId: string, kind: string) {
  return db.triggerEvent.findFirst({
    where: { deploymentId: depId, kind, status: "open" },
    orderBy: { createdAt: "desc" },
  });
}

async function cleanup() {
  for (const id of ALL_DEPS) {
    await db.triggerEvent.deleteMany({ where: { deploymentId: id } });
    await db.daemonState.deleteMany({ where: { deploymentId: id } });
    await db.probeSample.deleteMany({ where: { deploymentId: id } });
    await db.trafficSample.deleteMany({ where: { deploymentId: id } });
    await db.gpuSample.deleteMany({ where: { deploymentId: id } });
    await db.uidSnapshot.deleteMany({ where: { deploymentId: id } });
    await db.deployment.deleteMany({ where: { id } });
  }
}

async function main() {
  console.log(`DEVOPS-4 service-health test → ${BASE}\n`);

  const depsCreatedAt = Date.now();
  try {
    await cleanup();
    await createDep(DEP_PROBE, "runpod");
    await createDep(DEP_MOCK, "mock");
    await createDep(DEP_ACT, "runpod");
    await createOnlineDaemon(DEP_ACT);

    // --- pure helpers ---------------------------------------------------
    check(
      "rollingMedianMs — middle of sorted values",
      rollingMedianMs([900, 100, 500]) === 500 && rollingMedianMs([]) === null
    );
    check(
      "isSlowProbe — absolute slow line fires",
      isSlowProbe(9_000, 400, SERVICE_THRESHOLDS)
    );
    check(
      "isSlowProbe — 3× median ratio fires even below the absolute line",
      isSlowProbe(2_000, 400, SERVICE_THRESHOLDS) &&
        !isSlowProbe(2_000, 1_000, SERVICE_THRESHOLDS)
    );
    check(
      "isSlowProbe — null latency never slow",
      !isSlowProbe(null, 400, SERVICE_THRESHOLDS)
    );
    const dv = droughtVerdict([40, 40, 40], 5, { ...SERVICE_THRESHOLDS, minWindowsForDrought: 3 });
    check(
      "droughtVerdict — collapse candidate vs meaningful baseline",
      dv.meaningful && dv.candidate && Math.abs(dv.baselineAvg - 40) < 1e-9
    );
    const dvShort = droughtVerdict([40], 5, { ...SERVICE_THRESHOLDS, minWindowsForDrought: 3 });
    check(
      "droughtVerdict — short history is not meaningful (no false alarm)",
      !dvShort.meaningful && !dvShort.candidate
    );
    const dvUnknown = droughtVerdict([40, 40, 40], null, { ...SERVICE_THRESHOLDS, minWindowsForDrought: 3 });
    check("droughtVerdict — unknown traffic never droughts", !dvUnknown.candidate);

    // --- probe lifecycle (DI) --------------------------------------------
    resetServiceStateForTests();
    const epFake = { endpoint: "10.255.255.1", port: 8091, source: "chain" as const };
    const depSelector = (id: string) => ({ id });

    // pass 1: healthy probe
    let r = await runServiceHealthPass({
      thresholds: { minWindowsForDrought: 3 },
      resolveEndpoint: async (dep) => (depSelector(dep.id).id === DEP_PROBE ? epFake : null),
      probe: async () => okProbe(320),
      traffic: () => null,
    });
    let sample = await db.probeSample.findFirst({
      where: { deploymentId: DEP_PROBE },
      orderBy: { createdAt: "desc" },
    });
    check(
      "healthy probe → real-mode sample with timing, no alarms",
      r.probesTaken >= 2 && sample?.ok === true && sample?.mode === "real" && sample?.totalMs === 320,
      JSON.stringify({ probesTaken: r.probesTaken, sample })
    );

    // pass 2-3: dead endpoint → PROBE_FAIL on the 2nd consecutive failure
    r = await runServiceHealthPass({
      thresholds: { minWindowsForDrought: 3 },
      resolveEndpoint: async (dep) => (depSelector(dep.id).id === DEP_PROBE ? epFake : null),
      probe: async () => failProbe("connect", "ECONNREFUSED"),
      traffic: () => null,
    });
    check(
      "first failure alone → no PROBE_FAIL yet (streak=1)",
      (await openEvent(DEP_PROBE, "PROBE_FAIL")) === null
    );
    r = await runServiceHealthPass({
      thresholds: { minWindowsForDrought: 3 },
      resolveEndpoint: async (dep) => (depSelector(dep.id).id === DEP_PROBE ? epFake : null),
      probe: async () => failProbe("connect", "ECONNREFUSED"),
      traffic: () => null,
    });
    const probeFail = await latestEvent(DEP_PROBE, "PROBE_FAIL");
    check(
      "2nd consecutive failure → PROBE_FAIL critical w/ restart plan",
      probeFail !== null &&
        probeFail.severity === "critical" &&
        probeFail.status === "open" &&
        JSON.parse(probeFail.evidenceJson).suggestedAction === "restart",
      JSON.stringify(probeFail?.evidenceJson)
    );

    // pass 4: recovery → auto-resolve
    r = await runServiceHealthPass({
      thresholds: { minWindowsForDrought: 3 },
      resolveEndpoint: async (dep) => (depSelector(dep.id).id === DEP_PROBE ? epFake : null),
      probe: async () => okProbe(300),
      traffic: () => null,
    });
    const probeFailAfter = await latestEvent(DEP_PROBE, "PROBE_FAIL");
    check(
      "recovery auto-resolves the PROBE_FAIL event",
      probeFailAfter?.status === "resolved" && probeFailAfter.resolvedAt !== null,
      probeFailAfter?.status
    );

    // --- slow lifecycle (DI) ----------------------------------------------
    resetServiceStateForTests();
    for (let i = 0; i < 3; i++) {
      r = await runServiceHealthPass({
        thresholds: { minWindowsForDrought: 3 },
        resolveEndpoint: async (dep) => (depSelector(dep.id).id === DEP_PROBE ? epFake : null),
        probe: async () => okProbe(9_500),
        traffic: () => null,
      });
    }
    const slowEvent = await latestEvent(DEP_PROBE, "SERVICE_LATENCY");
    check(
      "3 consecutive slow probes → SERVICE_LATENCY with latency evidence",
      slowEvent !== null &&
        slowEvent.status === "open" &&
        JSON.parse(slowEvent.evidenceJson).lastTotalMs === 9_500,
      JSON.stringify(slowEvent?.evidenceJson)
    );
    r = await runServiceHealthPass({
      thresholds: { minWindowsForDrought: 3 },
      resolveEndpoint: async (dep) => (depSelector(dep.id).id === DEP_PROBE ? epFake : null),
      probe: async () => okProbe(310),
      traffic: () => null,
    });
    check(
      "latency back under the line → SERVICE_LATENCY resolved",
      (await latestEvent(DEP_PROBE, "SERVICE_LATENCY"))?.status === "resolved"
    );

    // --- drought lifecycle (DI traffic) ------------------------------------
    resetServiceStateForTests();
    let requests = 40;
    let droughtTraffic: number | null = 40;
    const droughtOpts = () => ({
      thresholds: { minWindowsForDrought: 3 },
      resolveEndpoint: async (dep: { id: string }) =>
        depSelector(dep.id).id === DEP_PROBE ? epFake : null,
      probe: async () => okProbe(320),
      traffic: () => trafficOf(droughtTraffic),
    });
    for (let i = 0; i < 4; i++) await runServiceHealthPass(droughtOpts());
    check(
      "baseline traffic stream → no QUERY_DROUGHT",
      (await openEvent(DEP_PROBE, "QUERY_DROUGHT")) === null
    );
    droughtTraffic = 5; // < 30% of the 40-request baseline
    for (let i = 0; i < 2; i++) await runServiceHealthPass(droughtOpts());
    check(
      "first collapse windows → no event yet (drought streak=2 of 3)",
      (await openEvent(DEP_PROBE, "QUERY_DROUGHT")) === null
    );
    await runServiceHealthPass(droughtOpts());
    const drought = await latestEvent(DEP_PROBE, "QUERY_DROUGHT");
    const droughtEv = drought ? JSON.parse(drought.evidenceJson) : null;
    // Rolling baseline: 4 baseline windows + the 2 already-recorded collapse
    // windows → (40×4 + 5×2) / 6 ≈ 28.33. The engine's rolling-window math.
    const expectedBaseline = (40 * 4 + 5 * 2) / 6;
    check(
      "3rd collapse window → QUERY_DROUGHT with baseline vs current evidence",
      drought !== null &&
        drought.status === "open" &&
        droughtEv?.requestsThisWindow === 5 &&
        Math.abs(droughtEv?.baselineAvgRequests - expectedBaseline) < 1e-6,
      JSON.stringify(droughtEv)
    );
    droughtTraffic = 42;
    await runServiceHealthPass(droughtOpts());
    check(
      "traffic recovers → QUERY_DROUGHT resolved",
      (await latestEvent(DEP_PROBE, "QUERY_DROUGHT"))?.status === "resolved"
    );

    // --- unknown traffic never alarms --------------------------------------
    resetServiceStateForTests();
    droughtTraffic = null;
    for (let i = 0; i < 5; i++) await runServiceHealthPass(droughtOpts());
    check(
      "unknown traffic (no parsable log) → never alarms",
      (await openEvent(DEP_PROBE, "QUERY_DROUGHT")) === null
    );

    // --- mock deployment: simulated, never alarms ---------------------------
    resetServiceStateForTests();
    await runServiceHealthPass({ traffic: () => null });
    const mockProbe = await db.probeSample.findFirst({
      where: { deploymentId: DEP_MOCK },
      orderBy: { createdAt: "desc" },
    });
    const mockTraffic = await db.trafficSample.findFirst({
      where: { deploymentId: DEP_MOCK },
      orderBy: { createdAt: "desc" },
    });
    check(
      "mock deployment → simulated probe sample (ok, mode=mock)",
      mockProbe?.mode === "mock" && mockProbe?.ok === true,
      JSON.stringify(mockProbe)
    );
    check(
      "mock deployment → simulated traffic sample with validator counts",
      mockTraffic !== null && (mockTraffic.requests ?? 0) > 0 && (mockTraffic.distinctValidators ?? 0) > 0,
      JSON.stringify(mockTraffic)
    );
    check(
      "mock deployment → zero service events",
      (await openEvent(DEP_MOCK, "PROBE_FAIL")) === null &&
        (await openEvent(DEP_MOCK, "SERVICE_LATENCY")) === null &&
        (await openEvent(DEP_MOCK, "QUERY_DROUGHT")) === null
    );

    // --- API: auth gate + run + monitor payload ------------------------------
    const anon = await api("POST", "/api/triggers", { action: "act", id: "whatever" });
    check("anonymous act → 401 (proxy gate)", anon.status === 401, `got ${anon.status}`);

    const admin = USERS.find((u) => u.userId === "admin")!;
    const adminCookie = await login(admin.userId, admin.code);
    check("admin login works", adminCookie.startsWith("infranex_session="));

    const runRes = await api("POST", "/api/triggers", { action: "run" }, adminCookie);
    check(
      "POST run → serviceEvaluated present (≥2 deps) + probes taken",
      runRes.status === 200 && (runRes.json?.pass?.serviceEvaluated ?? 0) >= 2,
      JSON.stringify(runRes.json?.pass)
    );

    // The monitor aggregates through two caches (overview 30s, payload 10s) —
    // poll until the throwaway deps surface, so cache timing never flakes.
    let mockMiner: Record<string, any> | undefined;
    for (let attempt = 0; attempt < 5 && !mockMiner; attempt++) {
      await new Promise((res) => setTimeout(res, attempt === 0 ? 32_000 : 11_000));
      const monTry = await api("GET", "/api/devops/monitor", undefined, adminCookie);
      mockMiner = (monTry.json?.miners as Array<Record<string, any>> | undefined)?.find(
        (m) => m.deploymentId === DEP_MOCK
      );
      if (attempt === 0) {
        // Thresholds + payload shape asserted on the first (32s-settled) fetch.
        check(
          "monitor payload — 200 + serviceThresholds shape",
          monTry.status === 200 &&
            typeof monTry.json?.serviceThresholds?.slowTotalMs === "number" &&
            typeof monTry.json?.serviceThresholds?.droughtFloorRatio === "number",
          JSON.stringify(monTry.json?.serviceThresholds)
        );
      }
    }
    check(
      "monitor payload — mock miner carries service block (probe + traffic + p50)",
      mockMiner !== undefined &&
        mockMiner?.service?.probe?.mode === "mock" &&
        mockMiner?.service?.probe?.ok === true &&
        mockMiner?.service?.traffic?.requests !== null &&
        typeof mockMiner?.service?.latencyP50Ms === "number",
      JSON.stringify(mockMiner?.service ?? null)
    );

    // --- approval-gated executor: PROBE_FAIL restart via API -----------------
    const ev = await db.triggerEvent.create({
      data: {
        kind: "PROBE_FAIL",
        severity: "critical",
        status: "approved",
        title: `Axon endpoint DEAD on "svc-test-${DEP_ACT}"`,
        detail: "Synthetic probe failed 2 consecutive passes (connect: ECONNREFUSED).",
        evidenceJson: JSON.stringify({
          reason: "probe-fail",
          suggestedAction: "restart",
          endpoint: "203.0.113.10:8091",
          failPasses: 2,
          errorKind: "connect",
        }),
        dedupeKey: `${DEP_ACT}:probe-fail`,
        deploymentId: DEP_ACT,
        netuid: 952,
        runbookJson: JSON.stringify(["Approve to queue restart_miner via the daemon."]),
      },
    });
    const act = await api("POST", "/api/triggers", { action: "act", id: ev.id }, adminCookie);
    check(
      "act(PROBE_FAIL restart) → restart_miner queued via daemon",
      act.status === 200 && String(act.json?.action ?? "").includes("restart_miner queued"),
      JSON.stringify(act.json)
    );
    check("event transitioned to acted", act.json?.event?.status === "acted");
    check(
      "ACTION note recorded in the event detail (audit trail)",
      String(act.json?.event?.detail ?? "").includes("ACTION:"),
      act.json?.event?.detail
    );
    const actDaemon = await db.daemonState.findUnique({ where: { deploymentId: DEP_ACT } });
    check(
      "restart_miner present in the daemon queue",
      String(actDaemon?.commandsJson ?? "[]").includes("restart_miner")
    );
  } finally {
    await cleanup();
    const left = await db.deployment.count({ where: { id: { in: ALL_DEPS } } });
    check("cleanup removed throwaway deployments + events + samples", left === 0, `left=${left}`);
    await db.$disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("fatal:", e);
  await cleanup().catch(() => {});
  await db.$disconnect();
  process.exit(1);
});
