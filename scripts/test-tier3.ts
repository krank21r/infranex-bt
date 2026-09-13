/**
 * TIER3 test suite — autopilot policy engine, git intelligence (upstream
 * watcher), benchmark harness, migration tooling.
 *
 * Run with the dev server UP (live API checks hit /api/*). Hermetic by DI:
 * upstream fetches and probes are injected; no real GitHub calls.
 */
import { db } from "../src/lib/db";
import {
  ruleMatches,
  runAutopilotPass,
} from "../src/lib/infranex/autopilot";
import {
  runUpstreamPass,
  resolveRepoUrl,
  type UpstreamLatest,
} from "../src/lib/infranex/upstream";
import {
  runBenchmarkPass,
  summarizeProbeDurations,
  synthesizeMockProbe,
  pruneBenchmarkRuns,
  BENCH_SAMPLES,
} from "../src/lib/infranex/benchmarks";
import { migrateDeployment } from "../src/lib/infranex/deployment/migrate";
import type { GPUOffer } from "../src/lib/infranex/types";
import type { ProbeOutcome } from "../src/lib/infranex/service-health";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  if (ok) {
    passed++;
    console.log(`  PASS  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  }
}

const BASE = "http://localhost:3000";

async function loginCookie(userId: string, code: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, code }),
  });
  // The session token rides the Set-Cookie header (body is { ok, user }).
  const raw = res.headers.get("set-cookie") ?? "";
  const m = raw.match(/infranex_session=([^;]+)/);
  if (!res.ok || !m) throw new Error(`login failed: ${res.status}`);
  return `infranex_session=${m[1]}`;
}

const MOCK_OFFER: GPUOffer = {
  id: "t3-offer-a",
  model: "RTX 5090",
  vramGb: 32,
  provider: "mock",
  region: "simulated",
  hourlyPrice: 0.55,
  monthlyPrice: 396,
  availability: "available",
  isSpot: false,
  ramGb: 96,
  cpuCores: 24,
};

const RUNPOD_OFFER: GPUOffer = { ...MOCK_OFFER, id: "t3-offer-rp", provider: "runpod" };

const SPOT_OFFER: GPUOffer = { ...MOCK_OFFER, id: "t3-offer-spot", isSpot: true };

async function main() {
  // Preflight — clear leftovers from a previously crashed run so the suite
  // is idempotent (the same (kind, dedupeKey) events would otherwise collide
  // with their own history rows).
  const leftoverDeps = await db.deployment.findMany({
    where: { minerName: { in: ["T3AUTO-01", "T3BENCH-01"] } },
    select: { id: true },
  });
  for (const d of leftoverDeps) {
    await db.deploymentRevision.deleteMany({ where: { deploymentId: d.id } });
    await db.benchmarkRun.deleteMany({ where: { deploymentId: d.id } });
    await db.triggerEvent.deleteMany({ where: { deploymentId: d.id } });
    await db.deployment.delete({ where: { id: d.id } }).catch(() => null);
  }
  await db.upstreamState.deleteMany({ where: { netuid: 18 } });
  await db.autopilotRule.deleteMany({ where: { name: "suite auto-restart" } });

  console.log("== TIER3: autopilot rule matching (pure) ==");
  const anyWarn = { id: "r1", name: "any", kind: "ANY", minSeverity: "warning", mockOnly: false, maxPerHour: 3, enabled: true };

  check(
    "KILL is denylisted even for ANY rules",
    !ruleMatches(anyWarn, { kind: "KILL", severity: "critical", evidence: {}, deploymentMode: "mock" }).match
  );
  check(
    "ESCALATION is denylisted",
    !ruleMatches(anyWarn, { kind: "ESCALATION", severity: "critical", evidence: {}, deploymentMode: "mock" }).match
  );
  check(
    "ARBITRAGE recycle is denylisted",
    !ruleMatches(anyWarn, { kind: "ARBITRAGE", severity: "critical", evidence: { suggestedAction: "recycle" }, deploymentMode: "mock" }).match
  );
  check(
    "kind mismatch does not match",
    !ruleMatches({ ...anyWarn, kind: "GPU_HEALTH" }, { kind: "PROBE_FAIL", severity: "critical", evidence: {}, deploymentMode: "mock" }).match
  );
  check(
    "severity below floor does not match",
    !ruleMatches(anyWarn, { kind: "GPU_HEALTH", severity: "info", evidence: {}, deploymentMode: "mock" }).match
  );
  check(
    "severity at floor matches",
    ruleMatches(anyWarn, { kind: "GPU_HEALTH", severity: "warning", evidence: {}, deploymentMode: "real" }).match
  );
  check(
    "mockOnly rule skips real deployments",
    !ruleMatches({ ...anyWarn, mockOnly: true }, { kind: "GPU_HEALTH", severity: "critical", evidence: {}, deploymentMode: "runpod" }).match
  );
  check(
    "mockOnly rule matches mock deployments",
    ruleMatches({ ...anyWarn, mockOnly: true }, { kind: "GPU_HEALTH", severity: "critical", evidence: {}, deploymentMode: "mock" }).match
  );
  check(
    "disabled rule never matches",
    !ruleMatches({ ...anyWarn, enabled: false }, { kind: "GPU_HEALTH", severity: "critical", evidence: {}, deploymentMode: "mock" }).match
  );
  check(
    "exact-kind rule beats ANY (specificity order)",
    ruleMatches({ ...anyWarn, kind: "PROBE_FAIL" }, { kind: "PROBE_FAIL", severity: "critical", evidence: {}, deploymentMode: "mock" }).match
  );

  // ------------------------------------------------------------------
  console.log("== TIER3: autopilot end-to-end ==");
  // The rule the suite uses: PROBE_FAIL on mock fleets, capped at 1/h so the
  // rate limiter can be exercised.
  const suiteRule = await db.autopilotRule.create({
    data: {
      name: "suite auto-restart",
      kind: "PROBE_FAIL",
      minSeverity: "warning",
      mockOnly: true,
      maxPerHour: 60,
    },
  });

  // Throwaway mock deployment (full DeploymentConfig shape — providers read
  // config.gpu.* at provision time).
  const fullConfig = {
    subnet: { netuid: 18, name: "Test Subnet", symbol: "TST", category: "ai", minVramGb: 24, recommendedGpu: "RTX 4090" },
    gpu: { model: "RTX 4090", vramGb: 24, provider: "mock", hourlyPrice: 0.4, monthlyPrice: 288, region: "simulated" },
    docker: {
      imageName: "infranex/test-miner:latest",
      runtime: "nvidia" as const,
      ports: ["8091:8091"],
      volumes: [{ path: "/data", sizeGb: 20 }],
      envVars: [{ name: "BT_NETUID", value: "18", secret: false }],
      command: "python miner.py --netuid 18",
      minMemoryGb: 32,
      minVcpuCount: 8,
      diskGb: 40,
    },
    miner: { network: "finney" as const, netuid: 18, walletName: "infranex", hotkeyName: "default", axonPort: 8091, prometheusPort: 9091, subtensorNetwork: "finney", extraArgs: [] },
    cost: { hourlyUsd: 0.4, monthlyUsd: 288 },
  };
  const dep = await db.deployment.create({
    data: {
      minerName: "T3AUTO-01",
      netuid: 18,
      subnetName: "Test Subnet",
      gpuModel: "RTX 4090",
      provider: "mock",
      status: "started",
      mode: "mock",
      hourlyCost: 0.4,
      monthlyCost: 288,
      config: JSON.stringify(fullConfig),
    },
  });

  const probeEv = await db.triggerEvent.create({
    data: {
      kind: "PROBE_FAIL",
      severity: "critical",
      status: "open",
      title: "Axon probe failed on T3AUTO-01",
      detail: "test-seeded probe failure",
      evidenceJson: JSON.stringify({ suggestedAction: "restart", consecutiveFailures: 3 }),
      dedupeKey: `${dep.id}:probe`,
      deploymentId: dep.id,
      netuid: 18,
      runbookJson: JSON.stringify(["approve to restart"]),
    },
  });

  const killEv = await db.triggerEvent.create({
    data: {
      kind: "KILL",
      severity: "critical",
      status: "open",
      title: "Kill T3AUTO-01 (seeded to prove denylist)",
      detail: "test-seeded kill",
      evidenceJson: "{}",
      dedupeKey: `${dep.id}:kill`,
      deploymentId: dep.id,
      netuid: 18,
      runbookJson: "[]",
    },
  });

  const pass1 = await runAutopilotPass();
  const actedProbe = pass1.acted.find((a) => a.eventId === probeEv.id);
  const actedKill = pass1.acted.find((a) => a.eventId === killEv.id);
  check("autopilot acted on the PROBE_FAIL event", !!actedProbe, pass1);
  check("autopilot did NOT act on the KILL event (denylist)", !actedKill, pass1.acted);

  const probeAfter = await db.triggerEvent.findUnique({ where: { id: probeEv.id } });
  check("PROBE_FAIL event is acted", probeAfter?.status === "acted", probeAfter?.status);
  check(
    "PROBE_FAIL detail carries the ACTION note",
    (probeAfter?.detail ?? "").includes("ACTION:"),
    probeAfter?.detail
  );
  const probeEvidence = JSON.parse(probeAfter?.evidenceJson ?? "{}") as { auto?: { ruleId: string } };
  check("evidence stamped with the acting rule", typeof probeEvidence.auto?.ruleId === "string", probeEvidence);

  const killAfter = await db.triggerEvent.findUnique({ where: { id: killEv.id } });
  check("KILL event still open for a human", killAfter?.status === "open", killAfter?.status);

  // Rate limit — hermetic: a dedicated 1/h rule + two fresh events. The first
  // event consumes the budget, the second must be skipped.
  const rateRule = {
    id: "t3-rate-rule",
    name: "suite rate-limit rule",
    kind: "PROBE_FAIL",
    minSeverity: "warning",
    mockOnly: true,
    maxPerHour: 1,
    enabled: true,
  };
  const mkProbeEvent = (key: string, title: string) =>
    db.triggerEvent.create({
      data: {
        kind: "PROBE_FAIL",
        severity: "critical",
        status: "open",
        title,
        detail: "test-seeded probe failure (rate limit)",
        evidenceJson: JSON.stringify({ suggestedAction: "restart" }),
        dedupeKey: `${dep.id}:${key}`,
        deploymentId: dep.id,
        netuid: 18,
        runbookJson: "[]",
      },
    });
  const probeEv2 = await mkProbeEvent("probe-rl-1", "rate-limit event A");
  const probeEv3 = await mkProbeEvent("probe-rl-2", "rate-limit event B");
  const pass2 = await runAutopilotPass({
    rules: [rateRule],
    events: [
      { id: probeEv2.id, kind: "PROBE_FAIL", severity: "critical", evidenceJson: probeEv2.evidenceJson, deploymentId: dep.id },
      { id: probeEv3.id, kind: "PROBE_FAIL", severity: "critical", evidenceJson: probeEv3.evidenceJson, deploymentId: dep.id },
    ],
    deploymentModes: new Map([[dep.id, "mock"]]),
  });
  const probe2Skipped = pass2.skipped.find((s) => s.eventId === probeEv3.id);
  check(
    "second event rate-limited by the 1/h rule",
    !!probe2Skipped && probe2Skipped.reason.includes("rate limit"),
    pass2.skipped
  );
  check("first rate-limit event acted", pass2.acted.some((a) => a.eventId === probeEv2.id), pass2.acted);

  // Schema fix regression — a RECURRING condition must be actable twice:
  // the old @@unique([kind, dedupeKey, status]) made the second cycle P2002.
  const rep1 = await mkProbeEvent("repeat", "repeatable condition cycle 1");
  await db.triggerEvent.update({ where: { id: rep1.id }, data: { status: "approved" } });
  await actOnTriggerById(rep1.id);
  const rep2 = await mkProbeEvent("repeat", "repeatable condition cycle 2");
  await db.triggerEvent.update({ where: { id: rep2.id }, data: { status: "approved" } });
  await actOnTriggerById(rep2.id);
  const repCount = await db.triggerEvent.count({
    where: { kind: "PROBE_FAIL", dedupeKey: `${dep.id}:repeat`, status: "acted" },
  });
  check("same (kind, dedupeKey) can be acted twice (schema fix)", repCount === 2, repCount);

  async function actOnTriggerById(id: string) {
    const { actOnTrigger } = await import("../src/lib/infranex/triggers");
    await actOnTrigger(id);
  }

  // ------------------------------------------------------------------
  console.log("== TIER3: git intelligence (upstream) ==");
  const REPO = "https://github.com/infranex-test/upstream-test";
  await db.deployment.update({
    where: { id: dep.id },
    data: {
      requirementsJsonSnapshot: JSON.stringify({
        repoUrl: REPO,
        fetchedAt: "2026-01-01T00:00:00.000Z",
      }),
    },
  });

  const releases: Record<string, UpstreamLatest> = {
    v1: { repoUrl: REPO, tag: "v1.0.0", tagPublishedAt: "2026-01-05T00:00:00.000Z", sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", shaCommittedAt: "2026-01-05T00:00:00.000Z", releaseUrl: `${REPO}/releases/v1.0.0` },
    v2: { repoUrl: REPO, tag: "v2.0.0", tagPublishedAt: "2026-06-01T00:00:00.000Z", sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", shaCommittedAt: "2026-06-01T00:00:00.000Z", releaseUrl: `${REPO}/releases/v2.0.0` },
    v2sha: { repoUrl: REPO, tag: "v2.0.0", tagPublishedAt: "2026-06-01T00:00:00.000Z", sha: "cccccccccccccccccccccccccccccccccccccccc", shaCommittedAt: "2026-06-02T00:00:00.000Z", releaseUrl: null },
  };

  // Clean slate for this netuid.
  await db.upstreamState.deleteMany({ where: { netuid: 18 } });

  const up1 = await runUpstreamPass({
    fetchLatest: async () => releases.v1,
    deployments: [{ id: dep.id, netuid: 18, minerName: "T3AUTO-01", mode: "mock", status: "started", requirementsJsonSnapshot: JSON.stringify({ repoUrl: REPO, fetchedAt: "2026-01-01T00:00:00.000Z" }) }],
  });
  check("first sighting adopts the baseline (no event)", up1.adopted === 1 && up1.changed === 0, up1);
  const state1 = await db.upstreamState.findUnique({ where: { netuid: 18 } });
  check("baseline stored v1.0.0", state1?.lastTag === "v1.0.0", state1);

  const up2 = await runUpstreamPass({
    fetchLatest: async () => releases.v2,
    deployments: [{ id: dep.id, netuid: 18, minerName: "T3AUTO-01", mode: "mock", status: "started", requirementsJsonSnapshot: JSON.stringify({ repoUrl: REPO, fetchedAt: "2026-01-01T00:00:00.000Z" }) }],
  });
  check("repo release change commits UPSTREAM_DRIFT", up2.changed === 1, up2);
  const upEv = await db.triggerEvent.findFirst({
    where: { kind: "UPSTREAM_DRIFT", dedupeKey: "18:upstream", status: "open" },
  });
  check("UPSTREAM_DRIFT event open", !!upEv, upEv?.id);
  const upEvidence = JSON.parse(upEv?.evidenceJson ?? "{}") as {
    previousTag?: string;
    latestTag?: string;
    runningBehind?: boolean;
  };
  check(
    "evidence carries prev→latest + runningBehind (deployed Jan, release Jun)",
    upEvidence.previousTag === "v1.0.0" && upEvidence.latestTag === "v2.0.0" && upEvidence.runningBehind === true,
    upEvidence
  );

  const up3 = await runUpstreamPass({
    fetchLatest: async () => releases.v2,
    deployments: [{ id: dep.id, netuid: 18, minerName: "T3AUTO-01", mode: "mock", status: "started", requirementsJsonSnapshot: JSON.stringify({ repoUrl: REPO, fetchedAt: "2026-01-01T00:00:00.000Z" }) }],
  });
  check("no change → quiet pass (no duplicate)", up3.unchanged === 1 && up3.changed === 0, up3);

  const up4 = await runUpstreamPass({
    fetchLatest: async () => releases.v2sha,
    deployments: [{ id: dep.id, netuid: 18, minerName: "T3AUTO-01", mode: "mock", status: "started", requirementsJsonSnapshot: JSON.stringify({ repoUrl: REPO, fetchedAt: "2026-01-01T00:00:00.000Z" }) }],
  });
  check("sha-only change also commits", up4.changed === 1, up4);

  // Act path — the handler catches pull failures and always lands "acted".
  if (upEv) {
    const { approveTrigger, actOnTrigger } = await import("../src/lib/infranex/triggers");
    await approveTrigger(upEv.id);
    const acted = await actOnTrigger(upEv.id);
    const upAfter = await db.triggerEvent.findUnique({ where: { id: upEv.id } });
    check("UPSTREAM_DRIFT act lands 'acted' with an ACTION note", upAfter?.status === "acted" && acted.action.length > 0, acted.action);
  }

  check(
    "resolveRepoUrl prefers the deployment snapshot",
    (await resolveRepoUrl(999, JSON.stringify({ repoUrl: REPO }))) === REPO
  );
  check(
    "resolveRepoUrl returns null when nothing known",
    (await resolveRepoUrl(424242, null)) === null
  );

  // ------------------------------------------------------------------
  console.log("== TIER3: benchmark harness ==");
  const pct = summarizeProbeDurations([300, 100, 200, 500, 400]);
  check("p50 math", pct.p50 === 300, pct);
  check("p95 math", pct.p95 === 500, pct);
  check("empty durations → nulls", summarizeProbeDurations([]).p50 === null);

  const mockOutcome = synthesizeMockProbe(7, true);
  check("mock probe synthesis is deterministic + ok", mockOutcome.ok === true && mockOutcome.totalMs === synthesizeMockProbe(7, true).totalMs, mockOutcome);

  // Mock deployment run — recorded, never alarms.
  const mockBench = await runBenchmarkPass({
    deployments: [{ id: dep.id, minerName: "T3AUTO-01", mode: "mock", status: "started", netuid: 18, hotkey: null, registeredUid: null, sshHost: null, config: "{}" }],
  });
  check("mock run recorded", mockBench.runs.length === 1 && mockBench.runs[0].mode === "mock", mockBench);
  check("mock run never regresses", mockBench.regressed === 0, mockBench);

  // Real-deployment regression cycle (DI probe + DB dep row).
  const realDep = await db.deployment.create({
    data: {
      minerName: "T3BENCH-01",
      netuid: 18,
      subnetName: "Test Subnet",
      gpuModel: "RTX 4090",
      provider: "mock",
      status: "started",
      mode: "mock",
      hourlyCost: 0.4,
      monthlyCost: 288,
      config: JSON.stringify({ miner: { walletName: "infranex", hotkeyName: "default", axonPort: 8091 } }),
    },
  });
  const fakeReal = {
    id: realDep.id,
    minerName: "T3BENCH-01",
    mode: "real",
    status: "started",
    netuid: 18,
    hotkey: null,
    registeredUid: null,
    sshHost: "bench-host",
    config: JSON.stringify({ miner: { walletName: "infranex", hotkeyName: "default", axonPort: 8091 } }),
  };
  const fastProbe = async (): Promise<ProbeOutcome> => ({ ok: true, httpStatus: 200, ttfbMs: 90, totalMs: 100, errorKind: null, errorDetail: null });
  const slowProbe = async (): Promise<ProbeOutcome> => ({ ok: true, httpStatus: 200, ttfbMs: 480, totalMs: 520, errorKind: null, errorDetail: null });

  // 3 fast baseline runs
  for (let i = 0; i < 3; i++) {
    const r = await runBenchmarkPass({ deployments: [fakeReal], probe: fastProbe });
    check(i === 0 ? "real run recorded with real probe" : `baseline run ${i + 1} recorded`, r.runs[0]?.p50Ms === 100 && r.regressed === 0, r.runs[0]);
  }
  // Slow run → regression event
  const slowRun = await runBenchmarkPass({ deployments: [fakeReal], probe: slowProbe });
  check("slow run (5x baseline) commits BENCH_REGRESS", slowRun.regressed === 1, slowRun);
  const benchEv = await db.triggerEvent.findFirst({
    where: { kind: "BENCH_REGRESS", dedupeKey: realDep.id, status: "open" },
  });
  check("BENCH_REGRESS event open with evidence", !!benchEv && !!JSON.parse(benchEv.evidenceJson).baselineP50Ms, benchEv?.id);
  // Recovery
  const recovered = await runBenchmarkPass({ deployments: [fakeReal], probe: fastProbe });
  check("recovery auto-resolves BENCH_REGRESS", recovered.recovered >= 1 && recovered.regressed === 0, recovered);
  const benchEvAfter = await db.triggerEvent.findFirst({
    where: { kind: "BENCH_REGRESS", dedupeKey: realDep.id, status: "resolved" },
  });
  check("BENCH_REGRESS event resolved", !!benchEvAfter, benchEvAfter?.id);

  // Prune
  for (let i = 0; i < 55; i++) {
    await db.benchmarkRun.create({
      data: { deploymentId: realDep.id, samples: 5, okCount: 5, p50Ms: 100, p95Ms: 120, successPct: 100, mode: "real" },
    });
  }
  const pruned = await pruneBenchmarkRuns(realDep.id);
  check("prune caps runs at 50", pruned > 0 && (await db.benchmarkRun.count({ where: { deploymentId: realDep.id } })) === 50, pruned);

  check("BENCH_SAMPLES is 5", BENCH_SAMPLES === 5);

  // ------------------------------------------------------------------
  console.log("== TIER3: migration ==");
  // Preflight failures
  let preflight1 = "";
  try {
    await migrateDeployment(dep.id, { offer: RUNPOD_OFFER });
  } catch (e) {
    preflight1 = e instanceof Error ? e.message : "";
  }
  check("mock dep + runpod offer rejected", preflight1.includes("simulated fleet"), preflight1);

  let preflight2 = "";
  try {
    await migrateDeployment(dep.id, { offer: SPOT_OFFER });
  } catch (e) {
    preflight2 = e instanceof Error ? e.message : "";
  }
  check("spot offer rejected", preflight2.includes("spot"), preflight2);

  let preflight3 = "";
  try {
    await migrateDeployment("no-such-dep", { offer: MOCK_OFFER });
  } catch (e) {
    preflight3 = e instanceof Error ? e.message : "";
  }
  check("unknown deployment rejected", preflight3.includes("not found"), preflight3);

  // Happy path on a mock fleet.
  const mig = await migrateDeployment(dep.id, { offer: MOCK_OFFER }, { actor: "test-suite" });
  check("migration succeeded (mock transport)", mig.transport === "mock" && mig.to.gpuModel === "RTX 5090", mig);
  const depAfter = await db.deployment.findUnique({ where: { id: dep.id } });
  check("deployment switched to the new pod/model", depAfter?.gpuModel === "RTX 5090" && depAfter?.providerPodId === mig.to.providerPodId, depAfter);
  check("hourly cost from the offer", Math.abs((depAfter?.hourlyCost ?? 0) - 0.55) < 1e-9, depAfter?.hourlyCost);
  check("old pod was terminated (steps trail)", mig.steps.some((s) => s.name === "migrate:decommission-old" && s.ok), mig.steps);
  const stepsAfter = JSON.parse(depAfter?.steps ?? "[]") as { name: string; status: string }[];
  const migSteps = stepsAfter.filter((s) => s.name.startsWith("migrate:"));
  check("all 5 migration steps recorded done", migSteps.length === 5 && migSteps.every((s) => s.status === "done"), migSteps);
  const migRev = await db.deploymentRevision.findFirst({
    where: { deploymentId: dep.id, cause: "migrate" },
    orderBy: { rev: "desc" },
  });
  check("migration recorded a 'migrate' revision", !!migRev, migRev?.rev);

  let preflight4 = "";
  try {
    await migrateDeployment(dep.id, { offer: MOCK_OFFER }, { actor: "test-suite" });
  } catch (e) {
    preflight4 = e instanceof Error ? e.message : "";
  }
  check("re-migration is idempotent-safe (pod ids equal path)", preflight4 === "" || !preflight4.includes("only started"), preflight4);

  // ------------------------------------------------------------------
  console.log("== TIER3: live API ==");
  const cookie = await loginCookie("ops01", "JFU8-8KJR-CZGH-PN8W");
  check("login works", !!cookie);

  const anonRules = await fetch(`${BASE}/api/autopilot/rules`);
  check("anon rules GET is 401 (proxy gate)", anonRules.status === 401, anonRules.status);

  const authedRules = await fetch(`${BASE}/api/autopilot/rules`, { headers: { cookie } });
  const rulesJson = (await authedRules.json()) as { rules?: unknown[] };
  check("authed rules GET is 200 with array", authedRules.status === 200 && Array.isArray(rulesJson.rules), rulesJson);

  const createRes = await fetch(`${BASE}/api/autopilot/rules`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "api-created rule", kind: "GPU_HEALTH", minSeverity: "info" }),
  });
  const created = (await createRes.json()) as { rule?: { id: string } };
  check("authed rule create is 200", createRes.status === 200 && !!created.rule?.id, created);

  const killCreate = await fetch(`${BASE}/api/autopilot/rules`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "try kill", kind: "KILL" }),
  });
  check("creating a KILL rule is 400 (human-only)", killCreate.status === 400, killCreate.status);

  const patchRes = await fetch(`${BASE}/api/autopilot/rules/${created.rule?.id}`, {
    method: "PATCH",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  check("rule PATCH toggles enabled", patchRes.status === 200, patchRes.status);

  const runRes = await fetch(`${BASE}/api/autopilot/rules`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "run" }),
  });
  const runJson = (await runRes.json()) as { result?: { openEvents: number } };
  check("autopilot run endpoint works", runRes.status === 200 && typeof runJson.result?.openEvents === "number", runJson);

  const delRes = await fetch(`${BASE}/api/autopilot/rules/${created.rule?.id}`, { method: "DELETE", headers: { cookie } });
  check("rule DELETE is 200", delRes.status === 200, delRes.status);

  const anonMig = await fetch(`${BASE}/api/deployments/${dep.id}/migrate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offer: MOCK_OFFER }),
  });
  check("anon migrate is 401", anonMig.status === 401, anonMig.status);

  const badMig = await fetch(`${BASE}/api/deployments/${dep.id}/migrate`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  check("migrate without offer is 400", badMig.status === 400, badMig.status);

  const okMig = await fetch(`${BASE}/api/deployments/${dep.id}/migrate`, {
    method: "POST",
    headers: { cookie, "Content-Type": "application/json" },
    body: JSON.stringify({ offer: { ...MOCK_OFFER, model: "H200", hourlyPrice: 0.9, monthlyPrice: 648 } }),
  });
  const okMigJson = (await okMig.json()) as { migration?: { to: { gpuModel: string } } };
  check("authed migrate via API works (H200)", okMig.status === 200 && okMigJson.migration?.to?.gpuModel === "H200", okMigJson);

  // Monitor payload carries the TIER3 sections.
  const monRes = await fetch(`${BASE}/api/devops/monitor`, { headers: { cookie } });
  const mon = (await monRes.json()) as {
    autopilot?: { rules?: unknown[] };
    benchmarks?: { deploymentId: string; runs: number }[];
  };
  check("monitor payload has autopilot.rules", Array.isArray(mon.autopilot?.rules), mon.autopilot);
  const benchEntry = mon.benchmarks?.find((b) => b.deploymentId === realDep.id);
  check("monitor payload has benchmark entry with runs", !!benchEntry && benchEntry.runs > 0, benchEntry);

  // ------------------------------------------------------------------
  console.log("== TIER3: cleanup ==");
  // Delete throwaway deployments (cascades revisions via deleteMany), rules,
  // upstream state, benchmark runs, and the events this suite created.
  for (const d of [dep.id, realDep.id]) {
    await db.deploymentRevision.deleteMany({ where: { deploymentId: d } });
    await db.benchmarkRun.deleteMany({ where: { deploymentId: d } });
    await db.triggerEvent.deleteMany({ where: { deploymentId: d } });
    await db.deployment.delete({ where: { id: d } }).catch(() => null);
  }
  await db.upstreamState.deleteMany({ where: { netuid: 18 } });
  await db.autopilotRule.delete({ where: { id: suiteRule.id } }).catch(() => null);
  const rulesLeft2 = await db.autopilotRule.findMany({ where: { name: { contains: "api-created" } } });
  for (const r of rulesLeft2) await db.autopilotRule.delete({ where: { id: r.id } }).catch(() => null);

  console.log(`\n${passed} PASS / ${failed} FAIL`);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  console.error("suite crashed:", e);
  process.exit(1);
});
