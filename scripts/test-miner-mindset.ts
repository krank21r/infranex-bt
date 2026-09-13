// ---------------------------------------------------------------------------
// DEVOPS-3 — the Miner Mindset strategy layer. The engine must reason like
// an experienced mining firm: detect collapsing subnet economics, propose
// compute recycling, upgrade serving runtimes, and fail over when a UID's
// incentive collapses — with every GPU change approval-gated.
//
// Covers:
//   - pickRuntimeRecipes (pure): saturation → vLLM, VRAM pressure → AWQ 4-bit,
//     incentive gap → TensorRT-LLM + LoRA, combinations merge
//   - perMinerYieldTaoPerDay / rankArbitrageTargets (pure): uplift filter,
//     capacity filter, sorting
//   - failoverFor (pure): only critical collapse/decline codes fail over
//   - buildMinerStrategyPosture (pure): mindset mapping + best alternative
//   - runMinerMindsetPass with an INJECTED snapshot (no chain): pass 1
//     baselines (no events), pass 2 collapse → ARBITRAGE (recycle, target
//     ranked), pass 3 no-alternatives → refresh to "evaluate", pass 4
//     recovery → autoResolve; RUNTIME_OPT created from hot seeded telemetry
//   - the approval-gated GPU executors via API: ARBITRAGE "recycle" act →
//     deployment terminated + audit note; RUNTIME_OPT act → apply_config
//     queued on the daemon with the recipe env + deployment config updated;
//     DEREG_RISK "failover" act → failover env pushed via daemon
//   - POST /api/triggers {action:"run"} reports mindsetEvaluated
//   - GET /api/devops/monitor exposes strategy posture + mindsetThresholds
//   - auth gating (anonymous → 401 via the proxy gate)
//
// Throwaway deployments (TESTMIND*) are fully cleaned up.
//
// Run from the repo dir:  bun scripts/test-miner-mindset.ts  (server on :3000)
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ override: true });
import { PrismaClient } from "@prisma/client";
import {
  buildMinerStrategyPosture,
  failoverFor,
  pickRuntimeRecipes,
  perMinerYieldTaoPerDay,
  rankArbitrageTargets,
  runMinerMindsetPass,
  MINDSET_THRESHOLDS,
} from "../src/lib/infranex/miner-mindset";
import type { LiveNetworkSnapshot } from "../src/lib/infranex/chain";

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

const DEP_MOCK = "TESTMIND-mock";
const DEP_DAEMON = "TESTMIND-daemon";
const DEP_REAL = "TESTMIND-real";

const MINIMAL_CONFIG = {
  docker: {
    command:
      "python neurons/miner.py --netuid 950 --subtensor.network finney --wallet.name testwallet --wallet.hotkey default --axon.port 8091",
  },
  miner: { walletName: "testwallet", hotkeyName: "default", netuid: 950 },
  requirements: { minVramGb: 24, pythonVersion: "3.10", cudaVersion: "12.1" },
};

/** Synthetic chain snapshot — DI for runMinerMindsetPass, zero chain calls. */
function fakeSnapshot(
  entries: Array<{
    netuid: number;
    miners: number;
    minerEmission: number;
    alpha?: number | null;
    name?: string;
    maxUids?: number | null;
  }>
): LiveNetworkSnapshot {
  return {
    blockNumber: 4_000_000,
    totalSubnets: entries.length,
    specVersion: 1,
    fetchedAt: new Date().toISOString(),
    taoPriceUsd: 400,
    taoMarketCapUsd: 3_000_000_000,
    taoChange24h: 0,
    subnets: entries.map((s) => ({
      netuid: s.netuid,
      name: s.name ?? `Fake α${s.netuid}`,
      minersCount: s.miners,
      validatorsCount: 2,
      subnetTao: 10_000,
      alphaIn: 10_000,
      alphaOut: 10_000,
      tempo: 360,
      emissionEnabled: true,
      movingPrice: 0.5,
      emission: null,
      emissionTaoPerDay: null,
      minerEmissionTaoPerDay: s.minerEmission,
      rewardedMiners: s.miners,
      top10IncentiveShare: 0.5,
      incentiveMedianShare: 0.8,
      burnCostTao: 100,
      immunityBlocks: 4096,
      alphaPriceChange24h: s.alpha ?? null,
      maxUids: s.maxUids ?? 256,
      owner: null,
      registeredAt: null,
      identityGithub: null,
      identityDescription: null,
    })),
    neurons: [],
    source: "live",
  };
}

const SNAPSHOT_RICH = () =>
  fakeSnapshot([
    { netuid: 950, miners: 10, minerEmission: 10 }, // yield 1.0 τ/day per miner
    { netuid: 951, miners: 10, minerEmission: 30, name: "Rich Subnet" }, // yield 3.0 → +200%
    { netuid: 952, miners: 10, minerEmission: 20 }, // yield 2.0 → +100%
  ]);
const SNAPSHOT_COLLAPSED = () =>
  fakeSnapshot([
    { netuid: 950, miners: 10, minerEmission: 5 }, // yield 0.5 → -50% vs peak
    { netuid: 951, miners: 10, minerEmission: 30, name: "Rich Subnet" },
    { netuid: 952, miners: 10, minerEmission: 20 },
  ]);
const SNAPSHOT_NO_ALTERNATIVES = () =>
  fakeSnapshot([{ netuid: 950, miners: 10, minerEmission: 4 }]); // -60%, nowhere to go
const SNAPSHOT_RECOVERED = () => SNAPSHOT_RICH();

async function createDep(id: string, mode: string) {
  await db.deployment.create({
    data: {
      id,
      minerName: `mindset-${id}`,
      netuid: 950,
      subnetName: "Mindset Test Subnet",
      gpuModel: "TestGPU",
      provider: "runpod",
      mode,
      status: "started",
      hourlyCost: 0.12,
      monthlyCost: 87.6,
      config: JSON.stringify(MINIMAL_CONFIG),
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

/** Hot + VRAM-pressured telemetry history — triggers the runtime optimizer. */
async function seedHotSamples(deploymentId: string) {
  for (let i = 0; i < 3; i++) {
    await db.gpuSample.create({
      data: {
        deploymentId,
        daemonStatus: "online",
        gpuUtilPct: 95,
        memUsedMb: 92,
        memTotalMb: 100,
        tempC: 62,
        processAlive: true,
      },
    });
  }
}

function queuedCommands(commandsJson: string): Array<{ command: string; args?: Record<string, unknown> }> {
  try {
    const v = JSON.parse(commandsJson);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function cleanup() {
  for (const id of [DEP_MOCK, DEP_DAEMON, DEP_REAL]) {
    await db.triggerEvent.deleteMany({ where: { deploymentId: id } });
    await db.daemonState.deleteMany({ where: { deploymentId: id } });
    await db.gpuSample.deleteMany({ where: { deploymentId: id } });
    await db.uidSnapshot.deleteMany({ where: { deploymentId: id } });
    await db.deployment.deleteMany({ where: { id } });
  }
}

async function main() {
  console.log(`DEVOPS-3 miner mindset test → ${BASE}\n`);

  let adminCookie = "";
  try {
    await cleanup();

    // --- auth gate --------------------------------------------------------
    const anon = await api("GET", "/api/devops/monitor");
    check("anon GET /api/devops/monitor → 401", anon.status === 401, `got ${anon.status}`);

    const admin = USERS.find((u) => u.userId === "admin");
    if (!admin) throw new Error("admin user missing from users.local.json");
    adminCookie = await login(admin.userId, admin.code);
    check("admin login", adminCookie.length > 0);

    // --- pure: runtime recipes --------------------------------------------
    const rSat = pickRuntimeRecipes({ saturatedUtil: true, memPressure: false, incentiveGap: false });
    check(
      "recipes: saturation → vLLM",
      rSat.length === 1 && rSat[0].id === "vllm",
      JSON.stringify(rSat.map((r) => r.id))
    );
    const rMem = pickRuntimeRecipes({ saturatedUtil: false, memPressure: true, incentiveGap: false });
    check(
      "recipes: VRAM pressure → AWQ 4-bit",
      rMem.length === 1 && rMem[0].id === "awq4",
      JSON.stringify(rMem.map((r) => r.id))
    );
    const rGap = pickRuntimeRecipes({ saturatedUtil: false, memPressure: false, incentiveGap: true });
    check(
      "recipes: incentive gap → TensorRT-LLM + LoRA",
      rGap.length === 2 && rGap[0].id === "tensorrt" && rGap[1].id === "lora",
      JSON.stringify(rGap.map((r) => r.id))
    );
    const rAll = pickRuntimeRecipes({ saturatedUtil: true, memPressure: true, incentiveGap: true });
    check(
      "recipes: all signals → awq4 + vllm + lora (no duplicate families)",
      rAll.length === 3 && rAll[0].id === "awq4" && rAll[1].id === "vllm" && rAll[2].id === "lora",
      JSON.stringify(rAll.map((r) => r.id))
    );
    const rNone = pickRuntimeRecipes({ saturatedUtil: false, memPressure: false, incentiveGap: false });
    check("recipes: healthy signals → none", rNone.length === 0);

    // --- pure: arbitrage math ---------------------------------------------
    const our = SNAPSHOT_RICH().subnets.find((s) => s.netuid === 950)!;
    check("perMinerYield: 10 τ/day / 10 miners = 1.0", perMinerYieldTaoPerDay(our) === 1.0);
    const targets = rankArbitrageTargets(950, 1.0, SNAPSHOT_RICH().subnets, MINDSET_THRESHOLDS);
    check(
      "arbitrage: two targets, sorted by yield, +200% first",
      targets.length === 2 && targets[0].netuid === 951 && targets[0].upliftPct === 2.0,
      JSON.stringify(targets.map((t) => `${t.netuid}:${t.upliftPct}`))
    );
    const noTargets = rankArbitrageTargets(950, 1.0, SNAPSHOT_COLLAPSED().subnets, MINDSET_THRESHOLDS);
    check(
      "arbitrage: collapsed-self snapshot still ranks 951/952",
      noTargets.length === 2,
      JSON.stringify(noTargets.map((t) => t.netuid))
    );

    // --- pure: failover ----------------------------------------------------
    check("failover: critical INCENTIVE_COLLAPSE → yes", failoverFor(["INCENTIVE_COLLAPSE"], "critical"));
    check("failover: critical PERSISTENT_DECLINE → yes", failoverFor(["PERSISTENT_DECLINE"], "critical"));
    check("failover: warning collapse → no", !failoverFor(["INCENTIVE_COLLAPSE"], "warning"));
    check("failover: critical NOT_REGISTERED → no", !failoverFor(["NOT_REGISTERED"], "critical"));

    // --- pure: posture -----------------------------------------------------
    const postureSteady = buildMinerStrategyPosture({
      netuid: 950,
      mode: "runpod",
      uid: null,
      recentSamples: [],
      openKinds: [],
      snapshot: SNAPSHOT_RICH(),
    });
    check(
      "posture: steady state, best alternative α951 +200%",
      postureSteady.mindset === "steady" &&
        postureSteady.bestAlternative?.netuid === 951 &&
        postureSteady.bestAlternative.upliftPct === 2 &&
        postureSteady.perMinerYieldTaoPerDay === 1,
      JSON.stringify(postureSteady)
    );
    const postureDefend = buildMinerStrategyPosture({
      netuid: 950,
      mode: "runpod",
      uid: { riskLevel: "critical", validatorTrust: 0.4, consensus: 0.2 },
      recentSamples: [],
      openKinds: ["ARBITRAGE", "DEREG_RISK"],
      snapshot: SNAPSHOT_RICH(),
    });
    check(
      "posture: critical UID risk → defend (beats earn_more)",
      postureDefend.mindset === "defend" && postureDefend.validatorTrust === 0.4
    );
    const postureOptimize = buildMinerStrategyPosture({
      netuid: 950,
      mode: "runpod",
      uid: { riskLevel: "healthy", validatorTrust: null, consensus: null },
      recentSamples: [
        { utilPct: 96, memRatio: 0.95 },
        { utilPct: 96, memRatio: 0.95 },
        { utilPct: 96, memRatio: 0.95 },
      ],
      openKinds: ["RUNTIME_OPT"],
      snapshot: SNAPSHOT_RICH(),
    });
    check(
      "posture: hot telemetry + open RUNTIME_OPT → optimize with recipe chips",
      postureOptimize.mindset === "optimize" &&
        postureOptimize.recommendedRecipes.length === 2 &&
        postureOptimize.recommendedRecipes.some((r) => r.id === "vllm"),
      JSON.stringify(postureOptimize.recommendedRecipes)
    );

    // --- seed ---------------------------------------------------------------
    await createDep(DEP_MOCK, "mock");
    await createDep(DEP_DAEMON, "runpod");
    await createDep(DEP_REAL, "runpod");
    await createOnlineDaemon(DEP_DAEMON);
    await seedHotSamples(DEP_DAEMON);

    // --- pass 1: baselines, no arbitrage; runtime fires on hot telemetry ----
    const p1 = await runMinerMindsetPass({
      fetchSnapshot: async () => SNAPSHOT_RICH(),
      thresholds: { yieldCollapsePasses: 1 },
    });
    const p1Arb = p1.findings.filter((f) => f.kind === "ARBITRAGE");
    const p1Rt = p1.findings.filter((f) => f.kind === "RUNTIME_OPT");
    check("pass1: no ARBITRAGE (baseline established)", p1Arb.length === 0, JSON.stringify(p1Arb));
    check(
      "pass1: RUNTIME_OPT created only for the hot daemon dep",
      p1Rt.length === 1 && p1Rt[0].deploymentId === DEP_DAEMON && p1Rt[0].action === "created",
      JSON.stringify(p1Rt)
    );

    const rtEvent = await db.triggerEvent.findFirst({
      where: { kind: "RUNTIME_OPT", deploymentId: DEP_DAEMON, status: "open" },
    });
    const rtEvidence = rtEvent ? JSON.parse(rtEvent.evidenceJson) : {};
    check(
      "pass1: RUNTIME_OPT evidence has recipes awq4+vllm and suggestedAction apply_runtime",
      rtEvidence.suggestedAction === "apply_runtime" &&
        Array.isArray(rtEvidence.recipes) &&
        rtEvidence.recipes.map((r: { id: string }) => r.id).join(",") === "awq4,vllm",
      JSON.stringify(rtEvidence.recipes?.map?.((r: { id: string }) => r.id) ?? null)
    );

    // --- pass 2: yield collapses → ARBITRAGE for all three 950 deps ---------
    const p2 = await runMinerMindsetPass({
      fetchSnapshot: async () => SNAPSHOT_COLLAPSED(),
      thresholds: { yieldCollapsePasses: 1 },
    });
    const p2Arb = p2.findings.filter((f) => f.kind === "ARBITRAGE");
    check(
      "pass2: ARBITRAGE created for all 3 collapsing deps",
      p2Arb.length === 3 && p2Arb.every((f) => f.action === "created"),
      JSON.stringify(p2Arb)
    );
    const mockArb = await db.triggerEvent.findFirst({
      where: { kind: "ARBITRAGE", deploymentId: DEP_MOCK, status: "open" },
    });
    const mockEv = mockArb ? JSON.parse(mockArb.evidenceJson) : {};
    check(
      "pass2: evidence is recycle-classified with ranked target α951 (uplift vs collapsed yield)",
      mockEv.suggestedAction === "recycle" &&
        mockEv.trigger === "yield_collapse" &&
        mockEv.target?.netuid === 951 &&
        mockEv.target?.upliftPct === 5 &&
        mockEv.dropPct === 0.5,
      JSON.stringify({ suggested: mockEv.suggestedAction, target: mockEv.target, drop: mockEv.dropPct })
    );
    check(
      "pass2: mock dep carries mode tag in evidence",
      mockEv.mode === "mock",
      JSON.stringify(mockEv.mode)
    );

    // --- API: approve + act the mock ARBITRAGE (recycle → terminate) --------
    const ap1 = await api("POST", "/api/triggers", { action: "approve", id: mockArb!.id }, adminCookie);
    check("approve ARBITRAGE", ap1.status === 200 && ap1.json?.event?.status === "approved");
    const ac1 = await api("POST", "/api/triggers", { action: "act", id: mockArb!.id }, adminCookie);
    const mockAfter = await db.deployment.findUnique({ where: { id: DEP_MOCK } });
    check(
      "act ARBITRAGE recycle → mock deployment terminated",
      ac1.status === 200 && mockAfter?.status === "terminated",
      `status=${mockAfter?.status} note=${ac1.json?.action ?? ac1.json?.error}`
    );
    check(
      "act ARBITRAGE audit note mentions compute recycled + target",
      typeof ac1.json?.action === "string" &&
        ac1.json.action.includes("compute recycled") &&
        ac1.json.action.includes("α951"),
      ac1.json?.action
    );

    // --- pass 3: collapse with NO alternatives → refresh to "evaluate" ------
    const p3 = await runMinerMindsetPass({
      fetchSnapshot: async () => SNAPSHOT_NO_ALTERNATIVES(),
      thresholds: { yieldCollapsePasses: 1 },
    });
    const p3Arb = p3.findings.filter((f) => f.kind === "ARBITRAGE");
    check(
      "pass3: open ARBITRAGE refreshed (not duplicated)",
      p3Arb.every((f) => f.action === "refreshed") && p3Arb.length >= 2,
      JSON.stringify(p3Arb)
    );
    const realArb = await db.triggerEvent.findFirst({
      where: { kind: "ARBITRAGE", deploymentId: DEP_REAL, status: "open" },
    });
    const realEv = realArb ? JSON.parse(realArb.evidenceJson) : {};
    check(
      "pass3: evidence downgraded to evaluate (no target clears uplift)",
      realEv.suggestedAction === "evaluate" && realEv.type === "evaluate" && realEv.target === null,
      JSON.stringify({ a: realEv.suggestedAction, t: realEv.type, target: realEv.target })
    );

    // --- pass 4: yield recovers → autoResolve -------------------------------
    const p4 = await runMinerMindsetPass({
      fetchSnapshot: async () => SNAPSHOT_RECOVERED(),
      thresholds: { yieldCollapsePasses: 1 },
    });
    check(
      "pass4: recovery auto-resolves both open ARBITRAGE events",
      p4.resolved >= 2,
      `resolved=${p4.resolved}`
    );

    // --- API: act the RUNTIME_OPT on the daemon dep --------------------------
    const ap2 = await api("POST", "/api/triggers", { action: "approve", id: rtEvent!.id }, adminCookie);
    check("approve RUNTIME_OPT", ap2.status === 200 && ap2.json?.event?.status === "approved");
    const ac2 = await api("POST", "/api/triggers", { action: "act", id: rtEvent!.id }, adminCookie);
    const daemonRow = await db.daemonState.findUnique({ where: { deploymentId: DEP_DAEMON } });
    const cmds = queuedCommands(daemonRow?.commandsJson ?? "[]");
    const applyCmd = [...cmds].reverse().find((c) => c.command === "apply_config");
    check(
      "act RUNTIME_OPT → apply_config queued with recipe env",
      ac2.status === 200 &&
        applyCmd?.command === "apply_config" &&
        (applyCmd?.args?.env as Record<string, string> | undefined)?.INFANEX_RUNTIME === "vllm" &&
        (applyCmd?.args?.env as Record<string, string> | undefined)?.INFANEX_QUANT === "awq4",
      JSON.stringify(applyCmd ?? ac2.json?.error)
    );
    const depAfter = await db.deployment.findUnique({ where: { id: DEP_DAEMON } });
    const cfgAfter = depAfter ? JSON.parse(depAfter.config) : null;
    const envNames = (cfgAfter?.docker?.envVars ?? []).map((e: { name: string }) => e.name);
    check(
      "act RUNTIME_OPT → deployment config env updated (durable)",
      envNames.includes("INFANEX_RUNTIME") && envNames.includes("INFANEX_QUANT"),
      JSON.stringify(envNames)
    );
    check(
      "act RUNTIME_OPT audit note mentions Applied to GPU + daemon",
      typeof ac2.json?.action === "string" &&
        ac2.json.action.includes("Applied to GPU") &&
        ac2.json.action.includes("apply_config"),
      ac2.json?.action
    );

    // --- API: DEREG_RISK failover act ---------------------------------------
    const fo = await db.triggerEvent.create({
      data: {
        kind: "DEREG_RISK",
        severity: "critical",
        status: "open",
        title: "Deregistration risk on α950 — INCENTIVE_COLLAPSE",
        detail: "test failover event",
        evidenceJson: JSON.stringify({
          suggestedAction: "failover",
          riskCodes: ["INCENTIVE_COLLAPSE"],
          failoverPlan: { strategy: "fallback serving profile + restart" },
        }),
        dedupeKey: DEP_DAEMON,
        deploymentId: DEP_DAEMON,
        netuid: 950,
        runbookJson: "[]",
      },
    });
    const ap3 = await api("POST", "/api/triggers", { action: "approve", id: fo.id }, adminCookie);
    check("approve DEREG_RISK failover", ap3.status === 200);
    const ac3 = await api("POST", "/api/triggers", { action: "act", id: fo.id }, adminCookie);
    const cmds2 = queuedCommands((await db.daemonState.findUnique({ where: { deploymentId: DEP_DAEMON } }))?.commandsJson ?? "[]");
    const foCmd = [...cmds2].reverse().find((c) => c.command === "apply_config");
    check(
      "act DEREG_RISK failover → apply_config with INFANEX_FAILOVER env",
      ac3.status === 200 &&
        (foCmd?.args?.env as Record<string, string> | undefined)?.INFANEX_FAILOVER === "1" &&
        typeof (foCmd?.args?.env as Record<string, unknown> | undefined)?.INFANEX_FAILOVER_SINCE === "string",
      JSON.stringify(foCmd ?? ac3.json?.error)
    );

    // --- wiring: POST run reports mindset + monitor payload ------------------
    const run = await api("POST", "/api/triggers", { action: "run" }, adminCookie);
    check(
      "POST run → mindsetEvaluated present and ≥ 2",
      run.status === 200 && typeof run.json?.pass?.mindsetEvaluated === "number" && run.json.pass.mindsetEvaluated >= 2,
      JSON.stringify(run.json?.pass ?? run.json?.error)
    );
    const mon = await api("GET", "/api/devops/monitor", undefined, adminCookie);
    const miners = mon.json?.miners ?? [];
    const monDaemon = miners.find((m: { deploymentId: string }) => m.deploymentId === DEP_DAEMON);
    check(
      "monitor payload: mindsetThresholds + strategy posture shape",
      mon.status === 200 &&
        mon.json?.mindsetThresholds?.yieldCollapsePct === MINDSET_THRESHOLDS.yieldCollapsePct &&
        monDaemon?.strategy?.mindset &&
        ["earn_more", "defend", "optimize", "steady"].includes(monDaemon.strategy.mindset) &&
        typeof monDaemon.strategy.top10IncentiveShare !== "undefined",
      JSON.stringify(monDaemon?.strategy ?? mon.json?.error)
    );

    // --- cleanup is also verified by the finally below ----------------------
  } finally {
    await cleanup();
    const left = await db.deployment.count({ where: { id: { startsWith: "TESTMIND-" } } });
    check("cleanup removed all TESTMIND* rows", left === 0, `left=${left}`);
    await db.$disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error("fatal:", e);
  try {
    await cleanup();
    await db.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
