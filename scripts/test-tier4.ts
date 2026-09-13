/**
 * TIER4 test suite — RUNWAY-1 immunity runway, external alerting (webhooks),
 * Vast.ai rental adapter, AI ops agent, light tenancy.
 *
 * Run with the dev server UP (live API checks hit /api/*) and an explicit
 * DATABASE_URL (the shadow-DB gotcha). Hermetic by DI: webhook deliveries go
 * to a local Bun.serve receiver; LLM completion is injected except one live
 * API run; no real Vast.ai / GitHub calls.
 *
 *   DATABASE_URL="file:.../db/custom.db" bun scripts/test-tier4.ts
 */
import { db } from "../src/lib/db";
import {
  incentiveSlope,
  computeRunway,
  runRunwayPass,
} from "../src/lib/infranex/runway";
import { commitFinding, autoResolve } from "../src/lib/infranex/triggers-core";
import {
  formatAlertBody,
  dispatchAlertEvent,
  runAlertsDigestPass,
  createChannel,
  isChannelKind,
} from "../src/lib/infranex/alerts";
import { encryptSecret } from "../src/lib/devops/crypto";
import {
  parseVastBundleId,
  buildOnstartScript,
  buildInstanceAsk,
  createVastProvider,
  VastProvider,
} from "../src/lib/infranex/deployment/providers/vast";
import type { DeploymentConfig } from "../src/lib/infranex/deployment/config";
import { offerProviderId } from "../src/lib/infranex/types";
import {
  buildFleetContext,
  runOpsAgent,
  listAgentNotes,
} from "../src/lib/infranex/ops-agent";

let passed = 0;
let failed = 0;

// Minimal Bun global typing (the script runtime is bun; tsc has no @types/bun).
declare const Bun: {
  serve(options: { port: number; fetch(req: Request): Promise<Response> }): { stop(hard?: boolean): void };
};
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
const WEBHOOK_PORT = 4599;

async function loginCookie(userId: string, code: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, code }),
  });
  const raw = res.headers.get("set-cookie") ?? "";
  const m = raw.match(/infranex_session=([^;]+)/);
  if (!res.ok || !m) throw new Error(`login failed: ${res.status}`);
  return `infranex_session=${m[1]}`;
}

// --- Local webhook receiver -------------------------------------------------

const received: { path: string; body: string }[] = [];
const server = Bun.serve({
  port: WEBHOOK_PORT,
  fetch(req) {
    const path = new URL(req.url).pathname;
    return req.text().then((body) => {
      if (path.startsWith("/fail")) return new Response("nope", { status: 500 });
      received.push({ path, body });
      return Response.json({ ok: true });
    });
  },
});

// --- Shared fixtures --------------------------------------------------------

function makeConfig(overrides?: Partial<DeploymentConfig>): DeploymentConfig {
  return {
    subnet: { netuid: 9, name: "Pre", symbol: "PRE", category: "Inference", minVramGb: 24, recommendedGpu: "RTX 4090" },
    gpu: { model: "RTX 4090", vramGb: 24, provider: "Vast.ai", hourlyPrice: 0.4, monthlyPrice: 288, region: "global", offerId: "vast-424242" },
    docker: {
      imageName: "bittensor/subnet:latest",
      runtime: "nvidia",
      ports: ["8091/http"],
      volumes: [{ path: "/workspace", sizeGb: 100 }],
      envVars: [{ name: "BT_NETUID", value: "9", secret: false }],
      command: "python neurons/miner.py",
      minMemoryGb: 64,
      minVcpuCount: 8,
      diskGb: 120,
    },
    miner: { network: "finney", netuid: 9, walletName: "w", hotkeyName: "default", axonPort: 8091, prometheusPort: 8092, subtensorNetwork: "finney", extraArgs: [] },
    cost: { hourlyUsd: 0.4, monthlyUsd: 288, estimatedMonthlyRevenueUsd: 1800, estimatedRoiPercent: 500 },
    requirements: { minVramGb: 24, pythonVersion: "3.10", cudaVersion: "12.1", dockerRequired: true, nvidiaRuntimeRequired: true },
    ...overrides,
  };
}

const PUBKEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITest test@infranex";

async function main() {
  console.log("\n== A. RUNWAY-1 pure math ==");

  const rising = incentiveSlope([0.01, 0.02, 0.03, 0.04, 0.05]);
  check("slope rising > 0", (rising.slopePerSample ?? 0) > 0, rising);
  const falling = incentiveSlope([0.05, 0.04, 0.03, 0.02, 0.01]);
  check("slope falling < 0", (falling.slopePerSample ?? 0) < 0, falling);
  check("slope null below 3 samples", incentiveSlope([0.01, null, 0.02]).slopePerSample === null);

  // Not at capacity → safe regardless of clock. Remaining = reg + window − block
  // = 1,000,000 + 7,200 − 807,200 = 200,000 blocks.
  const safe = computeRunway({
    uid: 3, incentive: 0.02, incentiveHistory: [0.02, 0.02, 0.02],
    hyperparams: { immunityPeriod: 7200, maxAllowedUids: 256 }, registeredUids: 100,
    registrationBlock: 1000000, blockNumber: 807200,
  });
  check("not at capacity → safe", safe.verdict === "safe", safe);
  check("free slots counted", safe.margins.capacityFreeSlots === 156, safe.margins);
  check("immunity clock known", safe.margins.immunityBlocksLeft === 200000, safe.margins);

  // At capacity + expired immunity + zero income → expired (DEREG_RISK owns it).
  const expired = computeRunway({
    uid: 3, incentive: 0.0, incentiveHistory: [0.0, 0.0, 0.0],
    hyperparams: { immunityPeriod: 7200, maxAllowedUids: 256 }, registeredUids: 256,
    registrationBlock: 1000000, blockNumber: 2000000,
  });
  check("expired verdict on the eviction line", expired.verdict === "expired", expired);
  check("expired tMinus = 0", expired.tMinusBlocks === 0, expired);

  // At capacity + zero income + clock running → T-minus = immunity left.
  // Remaining = 1,000,000 + 7,200 − 1,002,200 = 5,000 blocks (~16.7 h → watch band).
  const zero = computeRunway({
    uid: 3, incentive: 0.0, incentiveHistory: [0.0, 0.0, 0.0],
    hyperparams: { immunityPeriod: 7200, maxAllowedUids: 256 }, registeredUids: 256,
    registrationBlock: 1000000, blockNumber: 1002200,
  });
  check("zero income → T-minus = immunity left", zero.margins.immunityBlocksLeft === 5000, zero.margins);
  check("5000 blocks left → watch band", zero.verdict === "watch", zero);

  // At capacity + low income + clock nearly out → at_risk.
  // Remaining = 1,000,000 + 7,200 − 1,007,000 = 200 blocks (~40 min).
  const risk = computeRunway({
    uid: 3, incentive: 0.0, incentiveHistory: [0.0, 0.0, 0.0],
    hyperparams: { immunityPeriod: 7200, maxAllowedUids: 256 }, registeredUids: 256,
    registrationBlock: 1000000, blockNumber: 1007000,
  });
  check("200 blocks left → at_risk", risk.verdict === "at_risk", risk);
  check("at_risk tMinus 200", risk.tMinusBlocks === 200, risk);

  // Declining income: T-minus bounded by income decay vs immunity.
  const declining = computeRunway({
    uid: 3, incentive: 0.002, incentiveHistory: [0.004, 0.0033, 0.0027, 0.002],
    hyperparams: { immunityPeriod: 7200, maxAllowedUids: 256 }, registeredUids: 256,
    registrationBlock: 1000000, blockNumber: 2000000, // immunity expired, income still > floor
  });
  check("declining + expired immunity but earning → not expired", declining.verdict !== "expired", declining);

  // Rising income keeps the UID safe past expiry.
  const earning = computeRunway({
    uid: 3, incentive: 0.05, incentiveHistory: [0.05, 0.05, 0.05],
    hyperparams: { immunityPeriod: 7200, maxAllowedUids: 256 }, registeredUids: 256,
    registrationBlock: 1000000, blockNumber: 2000000,
  });
  check("earning past expiry → safe", earning.verdict === "safe", earning);

  // No authoritative clock → tMinus null, no false banding.
  const noClock = computeRunway({
    uid: 3, incentive: 0.02, incentiveHistory: [0.02, 0.02, 0.02],
    hyperparams: { immunityPeriod: null, maxAllowedUids: 256 }, registeredUids: 256,
    registrationBlock: null, blockNumber: null,
  });
  check("no clock → tMinus null", noClock.tMinusBlocks === null, noClock);
  check("no clock + healthy income → safe", noClock.verdict === "safe", noClock);

  // Declining near the floor without a clock still watches.
  const drift = computeRunway({
    uid: 3, incentive: 0.001, incentiveHistory: [0.004, 0.003, 0.002, 0.001],
    hyperparams: { immunityPeriod: null, maxAllowedUids: 256 }, registeredUids: 256,
    registrationBlock: null, blockNumber: null,
  });
  check("declining near floor → watch (no clock)", drift.verdict === "watch", drift);

  // MOCK-PURGE-1: simulateMockRunway was removed — runway is chain-honest
  // only (no synthetic margins for fleets without a registered hotkey).

  console.log("\n== B. Runway pass + event lifecycle ==");

  // Pass runs; deployments with invalid hotkeys are skipped (no chain calls).
  const dep = await db.deployment.create({
    data: {
      minerName: "t4-runway-dep", netuid: 9, subnetName: "Pre", gpuModel: "RTX 4090",
      provider: "mock", status: "started", mode: "mock", hourlyCost: 0.4, monthlyCost: 288,
      config: JSON.stringify(makeConfig()), hotkey: "not-a-valid-ss58",
    },
  });
  const pass = await runRunwayPass();
  check("pass skips invalid hotkeys", pass.skipped >= 1, pass);

  // Event lifecycle: commit → dedupe → auto-resolve.
  const r1 = await commitFinding({
    kind: "RUNWAY", severity: "critical", dedupeKey: `${dep.id}:runway`,
    title: "t4 runway critical", detail: "test", evidence: { verdict: "at_risk" },
    deploymentId: dep.id, netuid: 9, runbook: ["step"],
  });
  check("RUNWAY commit created", r1 === "created", r1);
  const r2 = await commitFinding({
    kind: "RUNWAY", severity: "critical", dedupeKey: `${dep.id}:runway`,
    title: "t4 runway critical 2", detail: "test 2", evidence: { verdict: "at_risk" },
    deploymentId: dep.id, netuid: 9, runbook: ["step"],
  });
  check("RUNWAY commit dedupes while open", r2 === "refreshed", r2);
  const resolved = await autoResolve("RUNWAY", `${dep.id}:runway`);
  check("RUNWAY auto-resolve on recovery", resolved === 1, resolved);
  await db.triggerEvent.deleteMany({ where: { kind: "RUNWAY", dedupeKey: `${dep.id}:runway` } });

  console.log("\n== C. External alerting ==");

  check("isChannelKind matrix", isChannelKind("slack") && !isChannelKind("pigeon"));

  const slackBody = formatAlertBody("slack", { kind: "PROBE_FAIL", severity: "critical", title: "t4 title", detail: "d", deploymentId: null, netuid: 9 });
  check("slack body has text", typeof JSON.parse(slackBody.body).text === "string");
  const discordBody = formatAlertBody("discord", { kind: "KILL", severity: "critical", title: "t4 title", detail: "d", deploymentId: null, netuid: null });
  check("discord body has content", typeof JSON.parse(discordBody.body).content === "string");
  const genericBody = formatAlertBody("generic", { kind: "RUNWAY", severity: "warning", title: "t4 title", detail: "d", deploymentId: "dep1", netuid: 5 });
  const genericParsed = JSON.parse(genericBody.body);
  check("generic body has event envelope", genericParsed.text.includes("t4 title") && genericParsed.event.kind === "RUNWAY" && genericParsed.event.deploymentId === "dep1");

  // Severity gating with injected channels.
  const chans = [
    { id: "crit-only", name: "crit", kind: "slack", urlEnc: encryptSecret(`http://localhost:${WEBHOOK_PORT}/crit`), minSeverity: "critical" },
    { id: "warn-plus", name: "warn", kind: "slack", urlEnc: encryptSecret(`http://localhost:${WEBHOOK_PORT}/warn`), minSeverity: "warning" },
  ];
  const sentInfo = await dispatchAlertEvent({ kind: "SUBNET_DRIFT", severity: "info", title: "x", detail: "", deploymentId: null, netuid: null }, { channels: chans });
  check("info events dispatch to nobody", sentInfo.sent === 0, sentInfo);
  const sentWarn = await dispatchAlertEvent({ kind: "SERVICE_LATENCY", severity: "warning", title: "w", detail: "", deploymentId: null, netuid: null }, { channels: chans });
  check("warning reaches warning+ channel only", sentWarn.sent === 1, sentWarn);
  const sentCrit = await dispatchAlertEvent({ kind: "PROBE_FAIL", severity: "critical", title: "c", detail: "", deploymentId: null, netuid: null }, { channels: chans });
  check("critical reaches both channels", sentCrit.sent === 2, sentCrit);

  // Real end-to-end delivery to the local receiver + bookkeeping.
  const ch = await createChannel({ name: "t4-receiver", kind: "slack", url: `http://localhost:${WEBHOOK_PORT}/hook`, minSeverity: "warning", digest: true });
  await dispatchAlertEvent({ kind: "KILL", severity: "critical", title: "t4 e2e delivery", detail: "body check", deploymentId: null, netuid: 9 });
  await new Promise((r) => setTimeout(r, 200));
  const hookHit = received.find((x) => x.path === "/hook" && x.body.includes("t4 e2e delivery"));
  check("webhook receiver got the alert", !!hookHit, received.map((r) => r.path));
  const chAfter = await db.alertChannel.findUnique({ where: { id: ch.id } });
  check("delivery bookkeeping ok", chAfter!.sentCount >= 1 && chAfter!.lastStatus === "ok", chAfter);

  // Failing endpoint increments failCount with the error captured.
  const bad = await createChannel({ name: "t4-bad", kind: "generic", url: `http://localhost:${WEBHOOK_PORT}/fail`, minSeverity: "warning" });
  await dispatchAlertEvent({ kind: "KILL", severity: "critical", title: "t4 fail delivery", detail: "", deploymentId: null, netuid: null }, { channels: [{ id: bad.id, name: bad.name, kind: "generic", urlEnc: bad.urlEnc, minSeverity: "warning" }] });
  const badAfter = await db.alertChannel.findUnique({ where: { id: bad.id } });
  check("failed delivery recorded", badAfter!.failCount >= 1 && badAfter!.lastStatus === "error", badAfter);

  // commitFinding → dispatcher hook: a NEW critical event must reach the
  // receiver through the fire-and-forget hook inside triggers-core.
  received.length = 0;
  await commitFinding({
    kind: "KILL", severity: "critical", dedupeKey: "t4-hook-test",
    title: "t4 hook dispatch", detail: "via commitFinding", evidence: {},
    deploymentId: null, netuid: 9, runbook: [],
  });
  let hookHit2: { path: string; body: string } | undefined;
  for (let i = 0; i < 16 && !hookHit2; i++) {
    await new Promise((r) => setTimeout(r, 250));
    hookHit2 = received.find((x) => x.body.includes("t4 hook dispatch"));
  }
  check("commitFinding dispatches new events to webhooks", !!hookHit2, received.map((r) => r.path));
  // A refresh must NOT re-dispatch (new-conditions-only rule).
  received.length = 0;
  await commitFinding({
    kind: "KILL", severity: "critical", dedupeKey: "t4-hook-test",
    title: "t4 hook dispatch refreshed", detail: "refresh", evidence: {},
    deploymentId: null, netuid: 9, runbook: [],
  });
  await new Promise((r) => setTimeout(r, 1200));
  check("refreshed event does not re-page", !received.some((x) => x.body.includes("t4 hook dispatch refreshed")), received.map((r) => r.path));
  await db.triggerEvent.deleteMany({ where: { kind: "KILL", dedupeKey: "t4-hook-test" } });

  // Digest reaches digest-enabled channels only.
  received.length = 0;
  const digest = await runAlertsDigestPass();
  const digestHit = received.find((x) => x.body.includes("INFRANEX DIGEST"));
  check("digest delivered to digest channel", digest.sent >= 1 && !!digestHit, digest);

  console.log("\n== D. Vast.ai rental adapter ==");

  check("parseVastBundleId", parseVastBundleId("vast-424242") === 424242 && parseVastBundleId("o1") === null && parseVastBundleId("vast-x") === null);
  const onstart = buildOnstartScript(PUBKEY);
  check("onstart injects pubkey", onstart.includes(PUBKEY) && onstart.includes("authorized_keys"));
  const ask = buildInstanceAsk({ bundleId: 7, imageName: "img:1", diskGb: 120, env: { A: "b" }, onstart: "x", label: "lbl" });
  check("ask shape", ask.interruptible === false && ask.disk === 120 && (ask.env as Record<string, string>).A === "b" && ask.id === 7, ask);

  // Happy path with an injected fetch.
  const calls: { url: string; init: RequestInit }[] = [];
  const fakeFetch = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (init.method === "PUT") {
      return new Response(JSON.stringify({ success: true, new_instance: { id: 987654, cur_state: "created" } }), { status: 200 });
    }
    if (init.method === "DELETE") return new Response(JSON.stringify({ success: true }), { status: 200 });
    return new Response(JSON.stringify({ instances: [{ id: 987654, cur_state: "running", public_ipaddr: "42.1.2.3", ports: { "22": { host: 41293 } } }] }), { status: 200 });
  };
  const vast = createVastProvider({ fetchImpl: fakeFetch as unknown as (u: string, i: RequestInit) => Promise<Response> });
  const provisioned = await vast.provision(makeConfig(), "dep-t4-vast", { sshPublicKey: PUBKEY });
  check("vast provision returns podId + pending", provisioned.podId === "987654" && provisioned.status === "pending", provisioned);
  const putCall = calls.find((c) => c.init.method === "PUT");
  const putBody = JSON.parse(String(putCall!.init.body));
  check("vast ask carries bundle + image + onstart key", putBody.id === 424242 && putBody.image === "bittensor/subnet:latest" && String(putBody.onstart).includes(PUBKEY), putBody);
  const status = await vast.getStatus("987654");
  check("vast status maps running + ssh port", status.status === "running" && status.ipAddress === "42.1.2.3" && status.sshPort === 41293, status);
  const killed = await vast.terminate("987654");
  check("vast terminate DELETEs", killed.success && calls.some((c) => c.init.method === "DELETE" && c.url.endsWith("/instances/987654/")));

  // Non-running state mapping.
  const vast2 = createVastProvider({
    fetchImpl: async () => new Response(JSON.stringify({ instances: [{ id: 1, cur_state: "exited" }] }), { status: 200 }) as unknown as Response,
  });
  const deadStatus = await vast2.getStatus("1");
  check("vast exited → terminated", deadStatus.status === "terminated", deadStatus);

  // Hotkey-only policy gate — the scan sees "NOTE=my seed phrase here".
  const badConfig = makeConfig();
  badConfig.docker.envVars = [...badConfig.docker.envVars, { name: "NOTE", value: "my seed-phrase illusion", secret: true }];
  let policyThrew = false;
  try {
    await vast.provision(badConfig, "dep-t4-bad", {});
  } catch (e) {
    policyThrew = e instanceof Error && e.message.includes("Hotkey-only policy violation");
  }
  check("vast provision enforces hotkey-only", policyThrew);

  // Missing bundle offer id.
  const noOffer = makeConfig();
  noOffer.gpu = { ...noOffer.gpu, offerId: "o1" };
  let offerThrew = false;
  try {
    await vast.provision(noOffer, "dep-t4-nooffer", {});
  } catch (e) {
    offerThrew = e instanceof Error && e.message.includes("Vast bundle offer");
  }
  check("vast provision requires a bundle offer", offerThrew);

  // Live adapter without a configured key → clean error (no key in test DB for vast).
  let keyThrew = false;
  try {
    await VastProvider.provision(makeConfig(), "dep-t4-nokey", {});
  } catch (e) {
    keyThrew = e instanceof Error && e.message.includes("key not configured");
  }
  check("vast live adapter gates on API key", keyThrew);

  // offerProviderId normalization (fixes the Tier-3 lowercase/label bug).
  check("offerProviderId normalizes labels", offerProviderId("RunPod") === "runpod" && offerProviderId("Vast.ai") === "vast" && offerProviderId("lambda") === "lambda" && offerProviderId("TensorDock") === "other");

  console.log("\n== E. Migration widening ==");

  const vastDep = await db.deployment.create({
    data: {
      minerName: "t4-vast-dep", netuid: 9, subnetName: "Pre", gpuModel: "RTX 4090",
      provider: "Vast.ai", status: "started", mode: "vast", hourlyCost: 0.4, monthlyCost: 288,
      config: JSON.stringify(makeConfig()),
    },
  });
  const { migrateDeployment } = await import("../src/lib/infranex/deployment/migrate");
  let mismatchThrew = "";
  try {
    await migrateDeployment(vastDep.id, { offer: { id: "rp-1", model: "H100", vramGb: 80, provider: "runpod", region: "x", hourlyPrice: 2, monthlyPrice: 1460, availability: "available", isSpot: false, ramGb: 0, cpuCores: 0 } });
  } catch (e) {
    mismatchThrew = e instanceof Error ? e.message : "";
  }
  check("vast deployment refuses runpod offers", mismatchThrew.includes("Vast.ai deployments migrate onto Vast.ai offers"), mismatchThrew);

  let spotThrew = "";
  try {
    await migrateDeployment(vastDep.id, { offer: { id: "vast-9", model: "RTX 4090", vramGb: 24, provider: "Vast.ai", region: "x", hourlyPrice: 0.1, monthlyPrice: 73, availability: "available", isSpot: true, ramGb: 0, cpuCores: 0 } });
  } catch (e) {
    spotThrew = e instanceof Error ? e.message : "";
  }
  check("spot offers still refused", spotThrew.includes("spot/interruptible"), spotThrew);

  console.log("\n== F. AI Ops Agent ==");

  const ctx = await buildFleetContext();
  check("fleet context built", Array.isArray(ctx.miners) && ctx.economics.infraPerDay >= 0, ctx.counts);

  let agentOutput = "";
  const note = await runOpsAgent({
    question: "t4 test question?",
    completion: async (messages) => {
      agentOutput = messages.map((m) => m.content).join("\n");
      return "SITUATION: test answer.\nTOP RISKS: none.\nRECOMMENDED ACTIONS: [auto-safe] restart t4-runway-dep.\nANSWER: 42.";
    },
  });
  check("agent note persisted with question", note.question === "t4 test question?" && note.content.includes("SITUATION"), note);
  check("agent context includes fleet numbers", agentOutput.includes("FLEET DIGEST") && agentOutput.includes("OPERATOR QUESTION"), agentOutput.slice(0, 200));
  check("agent meta has latency", typeof note.meta.latencyMs === "number", note.meta);
  const notes = await listAgentNotes(10);
  check("listAgentNotes returns the note", notes.some((n) => n.id === note.id), notes.length);

  console.log("\n== G. Live API — gates, tenancy, alerting channels, agent ==");

  const anonChannels = await fetch(`${BASE}/api/alerts/channels`);
  check("channels anon → 401", anonChannels.status === 401, anonChannels.status);
  const anonAgent = await fetch(`${BASE}/api/devops/agent`);
  check("agent anon → 401", anonAgent.status === 401, anonAgent.status);

  const adminC = await loginCookie("admin", "BRJ2-W2GT-WJNF-97VC");
  const opsC = await loginCookie("ops01", "JFU8-8KJR-CZGH-PN8W");
  check("admin + ops logins work", !!adminC && !!opsC);

  // Channels: member read OK, member mutation 403, admin mutation 201.
  const memberGet = await fetch(`${BASE}/api/alerts/channels`, { headers: { cookie: opsC } });
  check("member GET channels → 200", memberGet.status === 200, memberGet.status);
  const memberPost = await fetch(`${BASE}/api/alerts/channels`, {
    method: "POST", headers: { cookie: opsC, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "t4-member", kind: "slack", url: `http://localhost:${WEBHOOK_PORT}/x` }),
  });
  check("member POST channel → 403", memberPost.status === 403, memberPost.status);
  const adminPost = await fetch(`${BASE}/api/alerts/channels`, {
    method: "POST", headers: { cookie: adminC, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "t4-admin-ch", kind: "slack", url: `http://localhost:${WEBHOOK_PORT}/admin-hook`, minSeverity: "warning", digest: false }),
  });
  check("admin POST channel → 201", adminPost.status === 201, adminPost.status);
  const createdCh = ((await adminPost.json()) as { channel?: { id?: string } }).channel;
  const createdChId = createdCh?.id ?? "";

  // Bad URL refused.
  const badUrlPost = await fetch(`${BASE}/api/alerts/channels`, {
    method: "POST", headers: { cookie: adminC, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "t4-badurl", kind: "slack", url: "ftp://nope" }),
  });
  check("non-http URL refused 400", badUrlPost.status === 400, badUrlPost.status);

  // Test-send goes end-to-end through the dev server to the local receiver.
  received.length = 0;
  const testRes = await fetch(`${BASE}/api/alerts/channels/${createdChId}/test`, { method: "POST", headers: { cookie: adminC } });
  const testJson = (await testRes.json()) as { ok?: boolean; error?: string };
  const testHit = received.find((x) => x.body.includes("Alert channel test"));
  check("admin test-send delivers end-to-end", testRes.status === 200 && testJson.ok === true && !!testHit, { status: testRes.status, testJson, paths: received.map((r) => r.path) });
  const memberTest = await fetch(`${BASE}/api/alerts/channels/${createdChId}/test`, { method: "POST", headers: { cookie: opsC } });
  check("member test-send → 403", memberTest.status === 403, memberTest.status);

  // PATCH + DELETE: member 403, admin OK.
  const memberPatch = await fetch(`${BASE}/api/alerts/channels/${createdChId}`, {
    method: "PATCH", headers: { cookie: opsC, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  check("member PATCH channel → 403", memberPatch.status === 403, memberPatch.status);
  const adminPatch = await fetch(`${BASE}/api/alerts/channels/${createdChId}`, {
    method: "PATCH", headers: { cookie: adminC, "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false, digest: true }),
  });
  check("admin PATCH channel → ok", adminPatch.status === 200, adminPatch.status);
  const channelsAfter = (await (await fetch(`${BASE}/api/alerts/channels`, { headers: { cookie: adminC } })).json()) as { channels: { id: string; urlHint: string; digest: boolean; enabled: boolean }[] };
  const patched = channelsAfter.channels.find((c) => c.id === createdChId);
  check("channel list masks URL + reflects patch", !!patched && patched.urlHint.includes("****") && patched.enabled === false, patched);

  // Tenancy: POST /api/deployments attributes the creator; ?scope=mine filters.
  const createRes = await fetch(`${BASE}/api/deployments`, {
    method: "POST", headers: { cookie: adminC, "Content-Type": "application/json" },
    body: JSON.stringify({ netuid: 9, offerId: "o2", minerName: "t4-tenancy-dep", mode: "runpod" }),
  });
  check("deployment created via API", createRes.status === 201, createRes.status);
  const createdDep = ((await createRes.json()) as { deployment?: { id?: string; ownerUserId?: string; createdByLabel?: string } }).deployment;
  check("deployment attributed to admin", createdDep?.ownerUserId === "admin" && createdDep?.createdByLabel === "Administrator", createdDep);
  const mineAdmin = (await (await fetch(`${BASE}/api/deployments?scope=mine`, { headers: { cookie: adminC } })).json()) as { deployments: { id: string }[] };
  check("scope=mine includes own", mineAdmin.deployments.some((d) => d.id === createdDep?.id), mineAdmin.deployments.length);
  const mineOps = (await (await fetch(`${BASE}/api/deployments?scope=mine`, { headers: { cookie: opsC } })).json()) as { deployments: { id: string }[] };
  check("scope=mine excludes others", !mineOps.deployments.some((d) => d.id === createdDep?.id), mineOps.deployments.length);
  const allOps = (await (await fetch(`${BASE}/api/deployments`, { headers: { cookie: opsC } })).json()) as { deployments: { id: string }[] };
  check("default list stays team-shared", allOps.deployments.some((d) => d.id === createdDep?.id), allOps.deployments.length);
  const badMode = await fetch(`${BASE}/api/deployments`, {
    method: "POST", headers: { cookie: adminC, "Content-Type": "application/json" },
    body: JSON.stringify({ netuid: 9, offerId: "o2", minerName: "t4-badmode", mode: "lambda" }),
  });
  check("invalid mode refused 400", badMode.status === 400, badMode.status);

  // Monitor payload: mock miners are reported honestly — no simulated runway,
  // no forced health (MOCK-PURGE-1). Runway exists only with a hotkey.
  interface MonitorProbe {
    miners?: {
      minerName: string;
      mode: string;
      runway?: object | null;
    }[];
  }
  let monitorJson: MonitorProbe | null = null;
  for (let i = 0; i < 12; i++) {
    const mres = await fetch(`${BASE}/api/devops/monitor`, { headers: { cookie: adminC } });
    const mj = (await mres.json()) as MonitorProbe;
    if (mj?.miners && mj.miners.length > 0) {
      monitorJson = mj;
      break;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  check("monitor payload has miners", !!monitorJson?.miners?.length, monitorJson?.miners?.length);
  const mockMiner = monitorJson?.miners?.find((m) => m.mode === "mock");
  check("mock miner present but never simulated", !!mockMiner, monitorJson?.miners?.length);
  check("mock miner has NO runway (honest null)", !mockMiner?.runway, mockMiner?.runway);

  // Agent live API run (real SDK — one call).
  const agentRun = await fetch(`${BASE}/api/devops/agent`, {
    method: "POST", headers: { cookie: adminC, "Content-Type": "application/json" },
    body: JSON.stringify({ question: "Give me a one-line fleet status for the Tier 4 test." }),
  });
  const agentJson = (await agentRun.json()) as { ok?: boolean; note?: { content?: string; question?: string | null }; error?: string };
  check("live agent run via API", agentRun.status === 200 && agentJson.ok === true && (agentJson.note?.content?.length ?? 0) > 20, { status: agentRun.status, err: agentJson.error, len: agentJson.note?.content?.length });

  console.log("\n== I. Cleanup ==");

  // Prefix sweep (by-id deletes above can be skipped when a section throws).
  await db.deployment.deleteMany({ where: { minerName: { startsWith: "t4-" } } }).catch(() => {});
  await db.deployment.delete({ where: { id: dep.id } }).catch(() => {});
  await db.deployment.delete({ where: { id: vastDep.id } }).catch(() => {});
  if (createdDep?.id) await db.deployment.delete({ where: { id: createdDep.id } }).catch(() => {});
  await db.alertChannel.delete({ where: { id: ch.id } }).catch(() => {});
  await db.alertChannel.delete({ where: { id: bad.id } }).catch(() => {});
  if (createdChId) await db.alertChannel.delete({ where: { id: createdChId } }).catch(() => {});
  await db.agentNote.delete({ where: { id: note.id } }).catch(() => {});
  // Remove the live agent note (identified by the test question).
  await db.agentNote.deleteMany({ where: { question: { contains: "Tier 4 test" } } }).catch(() => {});
  await db.triggerEvent.deleteMany({ where: { deploymentId: { in: [dep.id, vastDep.id] } } }).catch(() => {});
  server.stop(true);
  check("cleanup done", true);

  console.log(`\n=== TIER4 RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("FATAL:", e);
    process.exit(1);
  });
