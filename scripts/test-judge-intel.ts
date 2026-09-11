/**
 * Judge Intelligence test suite — unit + live-server E2E.
 * Run: bun scripts/test-judge-intel.ts   (dev server must be running on :3000)
 */

import {
  JUDGE_ARCHETYPES,
  ARCHETYPE_PRIORS,
  type JudgeProfileData,
} from "../src/lib/infranex/judge/types";
import { buildCohort } from "../src/lib/infranex/judge/cohort";
import {
  extractJudgeProfile,
  extractDeadlineMs,
  parseGithubUrl,
  type JudgeInputs,
} from "../src/lib/infranex/judge/extract";
import {
  speedScore,
  availabilityScore,
  qualityScore,
  throughputScore,
  priceScore,
  verdictFor,
  percentileFor,
  simulateAgainstProfile,
} from "../src/lib/infranex/judge/simulate";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
section("1. Archetype priors");
// ---------------------------------------------------------------------------

for (const kind of JUDGE_ARCHETYPES) {
  const sum = Object.values(ARCHETYPE_PRIORS[kind]).reduce((a, b) => a + b, 0);
  check(`priors[${kind}] Σ=1 (got ${sum.toFixed(3)})`, Math.abs(sum - 1) < 0.001);
}
check("6 archetypes", JUDGE_ARCHETYPES.length === 6);

// ---------------------------------------------------------------------------
section("2. Cohort builder");
// ---------------------------------------------------------------------------

// SN-style shark tank: 256 registered, 1 whale + 9 dust earners.
const shark = buildCohort({
  registeredUids: 256,
  incentives: [
    0.9,
    ...new Array(9).fill(0.001),
    ...new Array(246).fill(0),
  ],
});
check("shark tank band", shark.band === "shark_tank", `got ${shark.band} ${shark.brutality}`);
check("shark tank brutality ≥70", shark.brutality >= 70, `${shark.brutality}`);
check("shark earningRatio tiny", shark.earningRatio < 0.05);
check("top10Take ≈ 1", shark.top10Take > 0.95);

// Healthy cohort: half earning, spread out.
const healthy = buildCohort({
  registeredUids: 100,
  incentives: Array.from({ length: 100 }, (_, i) =>
    i < 50 ? 0.01 + (i % 10) * 0.002 : 0
  ),
});
check("healthy band forgiving", healthy.band === "forgiving", `got ${healthy.band} ${healthy.brutality}`);
check("healthy brutality < 35", healthy.brutality < 35);

// Monotonicity: more earners → less brutal (same concentration).
const mid = buildCohort({
  registeredUids: 100,
  incentives: Array.from({ length: 100 }, (_, i) => (i < 25 ? 0.04 : 0)),
});
check("monotonic in earningRatio", mid.brutality >= healthy.brutality && mid.brutality <= shark.brutality);

// Empty cohort.
const empty = buildCohort({ registeredUids: 0, incentives: [] });
check("empty cohort → neutral moderate, 0 uids", empty.band === "moderate" && empty.registeredUids === 0 && empty.brutality === 50);

// Median of earning only (even count → upper middle).
const med = buildCohort({ registeredUids: 3, incentives: [0.1, 0.9, 0] });
check("medianRewarded over earning uids", med.medianIncentive === 0.9 && med.earningUids === 2);

// ---------------------------------------------------------------------------
section("3. Deadline mining");
// ---------------------------------------------------------------------------

check(
  "real timeout line mined",
  extractDeadlineMs({ "neurons/validator.py": "SYNAPSE_TIMEOUT = 12  # seconds\n" }) === 12000
);
check(
  "subprocess wait() skipped",
  extractDeadlineMs({ "neurons/validator.py": "process.wait(timeout=10)\n" }) === null
);
check(
  "sleep() skipped",
  extractDeadlineMs({ "neurons/validator.py": "time.sleep(30)\n" }) === null
);

// ---------------------------------------------------------------------------
section("4. Profile extraction (pure)");
// ---------------------------------------------------------------------------

const marketCode = `
PRICE_WEIGHT = 0.48
pricing = sorted(responses, key=lambda r: r.price_usd)
cheapest = pick_min_cost_offers()
throughput_limit = 25
`;
const codeInputs: JudgeInputs = {
  files: { "neurons/validator.py": marketCode, "README.md": "This subnet prices inference competitively." },
  tree: null,
  sources: [],
  treeFailed: false,
};
const marketProfile = extractJudgeProfile(codeInputs, "TestNet");
const dimSum = marketProfile.dimensions.reduce((a, d) => a + d.weight, 0);
check("weights Σ=1 after blend", Math.abs(dimSum - 1) < 0.01, `${dimSum}`);
check("market_clearing classified", marketProfile.judgeKind === "market_clearing", marketProfile.judgeKind);
check("evidence captured", marketProfile.dimensions.some((d) => d.evidence.length > 0));

const unknownProfile = extractJudgeProfile(
  { files: {}, tree: null, sources: [], treeFailed: false },
  "Empty"
);
check("no evidence → unknown", unknownProfile.judgeKind === "unknown");
check("no evidence → priors only", Math.abs(unknownProfile.dimensions.reduce((a, d) => a + d.weight, 0) - 1) < 0.01);
check("no evidence → low confidence", unknownProfile.confidence <= 0.2);

check("parseGithubUrl basic", parseGithubUrl("https://github.com/macrocosm-os/apex")?.owner === "macrocosm-os");
check(
  "parseGithubUrl tree branch",
  parseGithubUrl("https://github.com/o/r/tree/staging/src")?.branch === "staging"
);

// ---------------------------------------------------------------------------
section("5. Scoring curves");
// ---------------------------------------------------------------------------

check("speed at deadline = 0.5", Math.abs(speedScore(12000, 12000) - 0.5) < 0.001);
check("speed monotonic ↓ in latency", speedScore(6000, 12000) > speedScore(24000, 12000));
check("availability 99.5% ≈ 0.90", Math.abs(availabilityScore(99.5) - 0.9025) < 0.001);
check("availability 95% = 0.25", Math.abs(availabilityScore(95) - 0.25) < 0.001);
check("availability 90% = 0", availabilityScore(90) === 0);
check("quality concave", qualityScore(100) === 1 && qualityScore(82) < 0.85);
check("throughput saturating", throughputScore(50, 25) > throughputScore(25, 25) && throughputScore(25, 25) > 0.6);
check("price lower better", priceScore(0.25, 0.5) > priceScore(0.75, 0.5));

check("verdict bands", verdictFor(80) === "strong" && verdictFor(65) === "competitive" && verdictFor(50) === "marginal" && verdictFor(20) === "weak");

// Percentile ordering + shark compression.
const pWeak = percentileFor(40, 20);
const pStrong = percentileFor(80, 20);
check("percentile monotonic", pStrong > pWeak, `${pWeak} vs ${pStrong}`);
check("percentile clamped 1-99", pWeak >= 1 && pStrong <= 99);
const pSharkLow = percentileFor(30, 90);
const pForgivingLow = percentileFor(30, 10);
// Below-median composite → much worse percentile in a brutal cohort.
check("brutal cohort punishes below-median", pSharkLow < pForgivingLow, `${pSharkLow} vs ${pForgivingLow}`);

// ---------------------------------------------------------------------------
section("6. Simulation");
// ---------------------------------------------------------------------------

const syntheticProfile: JudgeProfileData = {
  netuid: 999,
  subnetName: "UnitTest",
  judgeKind: "market_clearing",
  summary: "test",
  dimensions: [
    { key: "price", label: "Price", weight: 0.5, evidence: [] },
    { key: "throughput", label: "Throughput", weight: 0.3, evidence: [] },
    { key: "response_speed", label: "Speed", weight: 0.2, evidence: [] },
  ],
  cohort: buildCohort({ registeredUids: 64, incentives: Array.from({ length: 64 }, (_, i) => (i < 16 ? 0.06 : 0)) }),
  confidence: 0.8,
  sources: [],
};

const goodSpec = { latencyMs: 1500, uptimePct: 99.9, qualityPct: 90, throughputTps: 60, pricePerMTokUsd: 0.2 };
const badSpec = { latencyMs: 120000, uptimePct: 96, qualityPct: 40, throughputTps: 3, pricePerMTokUsd: 3 };

const r1 = simulateAgainstProfile(syntheticProfile, goodSpec);
const r2 = simulateAgainstProfile(syntheticProfile, goodSpec);
const rBad = simulateAgainstProfile(syntheticProfile, badSpec);

check("deterministic", JSON.stringify(r1) === JSON.stringify(r2));
check("composite in range", r1.composite > 0 && r1.composite <= 100);
check("good spec beats bad spec", r1.composite > rBad.composite, `${r1.composite} vs ${rBad.composite}`);
check("dims Σ contribution = composite", Math.abs(r1.dimensionScores.reduce((a, d) => a + d.contribution, 0) * 100 - r1.composite) < 0.5);
check("recommendations ranked desc", r1.recommendations.every((r, i, arr) => i === 0 || arr[i - 1].gain >= r.gain));
check("bad spec has recommendations", rBad.recommendations.length > 0);
check("medianMultiple positive", r1.medianMultiple > 0);
check("disclaimer present", r1.disclaimer.length > 20);

// ---------------------------------------------------------------------------
section("7. Server E2E (live dev server)");
// ---------------------------------------------------------------------------

const BASE = "http://localhost:3000";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status, body: body as Record<string, unknown> };
}

try {
  // Sync a real subnet (8 = Vanta — validator code reachable historically).
  const sync = await api("/api/judge/sync", {
    method: "POST",
    body: JSON.stringify({ netuid: 8 }),
  });
  check("sync 200", sync.status === 200, JSON.stringify(sync.body).slice(0, 120));
  const syncedProfile = sync.body.profile as JudgeProfileData | undefined;
  check("sync returns profile with dimensions", !!syncedProfile?.dimensions?.length);

  // Registry
  const list = await api("/api/judge/profiles");
  check("profiles list 200", list.status === 200);
  const profiles = (list.body.profiles ?? []) as JudgeProfileData[];
  check("synced profile persisted", profiles.some((p) => p.netuid === 8));

  // Simulate
  const sim = await api("/api/judge/simulate", {
    method: "POST",
    body: JSON.stringify({
      netuid: 8,
      spec: { latencyMs: 1926, uptimePct: 99.5, qualityPct: 82, throughputTps: 25, pricePerMTokUsd: 0.45 },
    }),
  });
  check("simulate 200", sim.status === 200);
  const result = sim.body.result as { composite: number; verdict: string } | undefined;
  check("simulate returns composite+verdict", !!result && typeof result.composite === "number" && !!result.verdict);

  // Validation
  const bad = await api("/api/judge/simulate", {
    method: "POST",
    body: JSON.stringify({ netuid: 8, spec: { latencyMs: -5 } }),
  });
  check("simulate invalid spec → 400", bad.status === 400);

  // Runs
  const runs = await api("/api/judge/runs");
  check("runs 200", runs.status === 200);
  check("run persisted", ((runs.body.runs ?? []) as unknown[]).length > 0);

  // Single profile GET
  const single = await api("/api/judge/profiles?netuid=8");
  check("single profile 200", single.status === 200 && !!single.body.profile);
} catch (e) {
  failed++;
  failures.push(`E2E harness error: ${e instanceof Error ? e.message : String(e)}`);
}

// ---------------------------------------------------------------------------
console.log(`\n========== ${passed} passed, ${failed} failed ==========`);
if (failures.length) {
  console.log("FAILURES:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
