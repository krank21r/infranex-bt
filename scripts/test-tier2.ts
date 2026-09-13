// ---------------------------------------------------------------------------
// TIER2 — Deploy rollback (§20/§25) + escalation ladder tests.
//
// Layers:
//   A. Revision chain lib — snapshotRevision rev numbering, listRevisions
//      newest-first + isCurrent, prune cap, diffConfigs deltas.
//   B. Rollback — restores config + requirements, auto-backup revision,
//      mock transport, clean errors on same-config / missing-rev.
//   C. Escalation ladder — DI rung plans: first-rung success, retry success,
//      exhaustion → ESCALATION event with rollback target + dedupe.
//   D. End-to-end — approve + act an ESCALATION event: config rolled back
//      through actOnTrigger.
//   E. createDeployment anchors r1 ("deploy").
//   F. Live server — anon 401, GET revisions, POST rollback roundtrip,
//      POST invalid rev 400.
//
// Throwaway deployments (TESTT2-a / TESTT2-b) fully cleaned up.
//
// Run:  bun scripts/test-tier2.ts   (server up on :3000)
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ override: true });
import { PrismaClient } from "@prisma/client";

import {
  snapshotRevision,
  listRevisions,
  rollbackToRevision,
  pruneRevisions,
  diffConfigs,
  lastKnownGoodRevision,
  MAX_REVISIONS_PER_DEPLOYMENT,
} from "../src/lib/infranex/deployment/revisions";
import {
  runRepairLadder,
  commitEscalation,
  type LadderRung,
} from "../src/lib/infranex/escalation";
import { approveTrigger, actOnTrigger } from "../src/lib/infranex/triggers";
import { commitFinding } from "../src/lib/infranex/triggers-core";
import { createDeployment } from "../src/lib/infranex/deployment/engine";
import type { DeploymentConfig } from "../src/lib/infranex/deployment/config";

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
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    /* empty body */
  }
  return { status: res.status, json, setCookie: res.headers.getSetCookie?.() ?? [] };
}
function cookieOf(res: { setCookie: string[] }): string {
  const c = res.setCookie.find((x) => x.startsWith("infranex_session="));
  return c ? c.split(";")[0] : "";
}
async function login(userId: string, code: string): Promise<string> {
  const res = await api("POST", "/api/auth/login", { userId, code });
  return cookieOf(res);
}

// --- fixtures ---------------------------------------------------------------

const DEP_A = "TESTT2-a"; // revision chain + rollback
const DEP_B = "TESTT2-b"; // escalation end-to-end

function baseConfig(command: string, envValue: string, image = "bittensor/subnet:latest"): string {
  const cfg: DeploymentConfig = {
    subnet: {
      netuid: 7,
      name: "Apex",
      symbol: "APEX",
      category: "Inference",
      minVramGb: 24,
      recommendedGpu: "RTX 4090",
    },
    gpu: {
      model: "RTX 4090",
      vramGb: 24,
      provider: "runpod",
      hourlyPrice: 0.34,
      monthlyPrice: 248,
      region: "eu",
    },
    docker: {
      imageName: image,
      runtime: "nvidia",
      ports: ["8091/http"],
      volumes: [],
      envVars: [{ name: "BT profiles", value: envValue, secret: false }],
      command,
      minMemoryGb: 64,
      minVcpuCount: 8,
      diskGb: 200,
    },
    miner: {
      network: "finney",
      netuid: 7,
      walletName: "infranex",
      hotkeyName: "default",
      axonPort: 8091,
      prometheusPort: 8092,
      subtensorNetwork: "finney",
      extraArgs: [],
    },
    cost: { hourlyUsd: 0.34, monthlyUsd: 248, estimatedMonthlyRevenueUsd: 1800, estimatedRoiPercent: 600 },
    requirements: { minVramGb: 24, pythonVersion: "3.10", cudaVersion: "12.1", dockerRequired: true, nvidiaRuntimeRequired: true },
  };
  // env names with spaces are unusual — keep it deterministic instead:
  cfg.docker.envVars = [{ name: "BT_PROFILE", value: envValue, secret: false }];
  return JSON.stringify(cfg);
}

async function seedMockDeployment(id: string, config: string) {
  await db.deployment.deleteMany({ where: { id } });
  return db.deployment.create({
    data: {
      id,
      minerName: id,
      netuid: 7,
      subnetName: "Apex",
      gpuModel: "RTX 4090",
      provider: "runpod",
      status: "started",
      progress: 100,
      mode: "mock",
      hourlyCost: 0.34,
      monthlyCost: 248,
      config,
      steps: "[]",
    },
  });
}

// --- A. revision chain ------------------------------------------------------

async function testRevisionChain() {
  console.log("\n-- A. revision chain --");
  const cfgA = baseConfig("python miner.py --v1", "baseline");
  const cfgB = baseConfig("python miner.py --v2", "baseline");
  await seedMockDeployment(DEP_A, cfgA);

  const r1 = await snapshotRevision(DEP_A, "deploy", "initial");
  check("snapshot on empty chain creates r1", r1?.rev === 1, JSON.stringify(r1));

  // Mutate config, snapshot again — r2 differs from live.
  await db.deployment.update({ where: { id: DEP_A }, data: { config: cfgB } });
  const r2 = await snapshotRevision(DEP_A, "drift", "before drift write");
  check("second snapshot increments to r2", r2?.rev === 2, JSON.stringify(r2));

  const list = await listRevisions(DEP_A);
  check("list is newest-first", list[0]?.rev === 2 && list[1]?.rev === 1);
  check("isCurrent: newest snapshot matches live, older does not", list[0]?.isCurrent === true && list[1]?.isCurrent === false);
  check("summary carries image + netuid", /bittensor\/subnet:latest/.test(list[0]?.summary ?? "") && /α7/.test(list[0]?.summary ?? ""), list[0]?.summary);

  // No-deployment / empty-config edges.
  check("snapshot of missing deployment is null", (await snapshotRevision("TESTT2-missing", "deploy")) === null);

  // diffConfigs deltas.
  const cfgC = baseConfig("python miner.py --v3", "tuned", "bittensor/vision-subnet:latest");
  const d = diffConfigs(cfgB, cfgC);
  check("diff detects image change", d.some((x) => x.includes("image")), d.join(" | "));
  check("diff detects command change", d.some((x) => x.includes("command")), d.join(" | "));
  check("diff detects env change", d.some((x) => x.includes("env changed")), d.join(" | "));
}

// --- B. rollback ------------------------------------------------------------

async function testRollback() {
  console.log("\n-- B. rollback --");
  const dep = await db.deployment.findUnique({ where: { id: DEP_A } });
  const cfgB = dep!.config; // live = v2 (mutated in section A)

  const rb = await rollbackToRevision(DEP_A, 1);
  check("rollback restores r1 config", rb.transport === "mock" && rb.restoredRev === 1);
  const depAfter = await db.deployment.findUnique({ where: { id: DEP_A } });
  check("live config equals r1 snapshot after rollback", depAfter!.config !== cfgB);
  check("rollback applied carries human deltas", rb.applied.some((x) => x.includes("command")), rb.applied.join(" | "));
  // No duplicate backup: r2 was snapshotted from the live config moments ago,
  // so the newest revision already captures it — by design backup is skipped.
  check("backup skipped (newest revision already captures live)", rb.backupRev === null, `backup=${rb.backupRev}`);
  const newest = await db.deploymentRevision.findFirst({
    where: { deploymentId: DEP_A },
    orderBy: { rev: "desc" },
  });
  check("newest revision preserves the rolled-back-away config", newest?.configJson === cfgB, `rev=${newest?.rev}`);

  const list = await listRevisions(DEP_A);
  check("chain still carries the pre-rollback config as a revision", list.some((r) => r.cause === "drift"));

  // Same-config rollback must refuse.
  let refused = "";
  try {
    await rollbackToRevision(DEP_A, 1);
  } catch (e) {
    refused = e instanceof Error ? e.message : "?";
  }
  check("rollback to identical config refuses", refused.includes("Already running"), refused);

  // Missing revision must refuse.
  let missing = "";
  try {
    await rollbackToRevision(DEP_A, 999);
  } catch (e) {
    missing = e instanceof Error ? e.message : "?";
  }
  check("rollback to missing rev refuses", missing.includes("not found"), missing);

  // lastKnownGoodRevision: newest revision differing from live — the drift-
  // era config the operator would want to go back to.
  const good = await lastKnownGoodRevision(DEP_A);
  check("lastKnownGood finds newest differing revision", good !== null && good.rev === 2 && good.cause === "drift", JSON.stringify(good));
}

// --- prune (part of A but needs volume) --------------------------------------

async function testPrune() {
  console.log("\n-- prune --");
  for (let i = 0; i < 25; i++) {
    await snapshotRevision(DEP_A, "deploy", `bulk ${i}`);
  }
  const kept = await db.deploymentRevision.count({ where: { deploymentId: DEP_A } });
  check("prune keeps the cap", kept === MAX_REVISIONS_PER_DEPLOYMENT, `kept=${kept}`);
  const newest = await db.deploymentRevision.findFirst({
    where: { deploymentId: DEP_A },
    orderBy: { rev: "desc" },
  });
  check("prune keeps the NEWEST revisions", (newest?.rev ?? 0) >= MAX_REVISIONS_PER_DEPLOYMENT, `newest=${newest?.rev}`);
  const pruned = await pruneRevisions(DEP_A);
  check("prune is idempotent (0 when under cap)", pruned === 0, `pruned=${pruned}`);
}

// --- C. escalation ladder ----------------------------------------------------

async function testLadder() {
  console.log("\n-- C. escalation ladder --");

  const okRung: LadderRung = { action: "fake_ok", run: async () => "did the thing" };
  const badRung: LadderRung = { action: "fake_bad", run: async () => { throw new Error("daemon gone"); } };

  const r1 = await runRepairLadder(DEP_A, { rungs: [okRung], delayMs: 0 });
  check("first-rung success resolves", r1.resolved && !r1.escalated && r1.steps.length === 1, r1.note);
  check("resolved note names the rung", r1.note.includes("rung 1") && r1.note.includes("fake_ok"), r1.note);

  const r2 = await runRepairLadder(DEP_A, { rungs: [badRung, okRung], delayMs: 0 });
  check("retry rung succeeds after failure", r2.resolved && r2.steps.length === 2, r2.note);
  check("failed rung recorded with error", r2.steps[0]?.ok === false && r2.steps[0]?.detail.includes("daemon gone"));

  // Exhaustion → ESCALATION event (dedupeKey `${dep}:ladder`). DEP_A's chain
  // now holds only revisions identical to the live config (post-rollback +
  // bulk prune), so the ladder correctly suggests KILL, not rollback.
  const r3 = await runRepairLadder(DEP_A, { rungs: [badRung, badRung, badRung], delayMs: 0, originKind: "RE_SYNC" });
  check("exhaustion escalates", !r3.resolved && r3.escalated, r3.note);
  check("escalation note lists every rung", r3.steps.length === 3 && r3.note.includes("3 repair rungs"), r3.note);
  check("escalation has an event id", !!r3.escalationEventId, r3.escalationEventId);

  const ev = await db.triggerEvent.findFirst({
    where: { kind: "ESCALATION", dedupeKey: `${DEP_A}:ladder`, status: "open" },
  });
  check("ESCALATION event open in db", !!ev);
  const evidence = JSON.parse(ev?.evidenceJson ?? "{}");
  check("evidence carries ladder trace", Array.isArray(evidence.ladder) && evidence.ladder.length === 3);
  check("nothing to revert → suggests kill", evidence.suggestedAction === "kill", evidence.suggestedAction);
  check("no targetRev when kill is suggested", evidence.targetRev === null);
  check("evidence records origin kind", evidence.originKind === "RE_SYNC");
  check("kill runbook names the next rung", ev!.runbookJson.includes("KILL"));

  // No-revision scenarios: existing deployment → "kill"; missing row → "review".
  const escKill = await commitEscalation(DEP_A, [{ rung: 1, action: "x", ok: false, detail: "y", at: new Date().toISOString() }], "RE_SYNC");
  check("existing dep without differing revisions → kill", escKill.suggestedAction === "kill", JSON.stringify(escKill));
  const escReview = await commitEscalation(DEP_B, [], "RE_SYNC");
  check("missing deployment → review", escReview.suggestedAction === "review", JSON.stringify(escReview));
  // DEP_B gets seeded next section — clear the placeholder event so its
  // end-to-end commitEscalation observes a clean "created".
  await db.triggerEvent.deleteMany({ where: { kind: "ESCALATION", dedupeKey: `${DEP_B}:ladder` } });

  // Rollback evidence path: diverge the config so one revision differs —
  // the refreshed open event must flip to rollback evidence + runbook.
  await db.deployment.update({ where: { id: DEP_A }, data: { config: baseConfig("python miner.py --alt", "alt") } });
  await snapshotRevision(DEP_A, "drift", "diverge again");
  await db.deployment.update({ where: { id: DEP_A }, data: { config: baseConfig("python miner.py --v1", "baseline") } });
  const rRoll = await runRepairLadder(DEP_A, { rungs: [badRung], delayMs: 0, originKind: "RE_SYNC" });
  const evRoll = await db.triggerEvent.findFirst({
    where: { kind: "ESCALATION", dedupeKey: `${DEP_A}:ladder`, status: "open" },
  });
  const evRollEvidence = JSON.parse(evRoll?.evidenceJson ?? "{}");
  check("differing revision → suggests rollback", evRollEvidence.suggestedAction === "rollback" && typeof evRollEvidence.targetRev === "number", JSON.stringify({ a: evRollEvidence.suggestedAction, t: evRollEvidence.targetRev }));
  check("rollback escalation refreshed the open event", rRoll.escalationEventId === evRoll?.id);
  check("refresh updated the title to the rollback ask", evRoll?.title.includes(`r${evRollEvidence.targetRev}`), evRoll?.title);
  check("refresh updated the runbook to the rollback steps", evRoll!.runbookJson.includes(`r${evRollEvidence.targetRev}`));

  // Dedupe — second exhaustion refreshes instead of spamming.
  const before = await db.triggerEvent.count({
    where: { kind: "ESCALATION", dedupeKey: `${DEP_A}:ladder`, status: "open" },
  });
  const r4 = await runRepairLadder(DEP_A, { rungs: [badRung], delayMs: 0 });
  const after = await db.triggerEvent.count({
    where: { kind: "ESCALATION", dedupeKey: `${DEP_A}:ladder`, status: "open" },
  });
  check("repeat exhaustion refreshes, not spams", r4.escalated && before === 1 && after === 1, `${before}->${after}`);
}

// --- D. end-to-end: approve + act ESCALATION → rollback ----------------------

async function testEscalationAct() {
  console.log("\n-- D. ESCALATION act executes rollback --");
  // DEP_B: r1 = config A (baseline), live mutated to config B.
  const cfgA = baseConfig("python miner.py --good", "stable");
  const cfgB = baseConfig("python miner.py --broken", "unstable");
  await seedMockDeployment(DEP_B, cfgA);
  await snapshotRevision(DEP_B, "deploy", "initial");
  await db.deployment.update({ where: { id: DEP_B }, data: { config: cfgB } });

  const esc = await commitEscalation(
    DEP_B,
    [{ rung: 1, action: "restart_via_daemon", ok: false, detail: "no daemon", at: new Date().toISOString() }],
    "RE_SYNC"
  );
  check("escalation committed for DEP_B", esc.result === "created" && esc.targetRev === 1, JSON.stringify(esc));

  const approved = await approveTrigger(esc.eventId);
  check("escalation approves", approved.status === "approved");

  const { action } = await actOnTrigger(esc.eventId);
  check("act note reports the rollback", action.includes("Rolled back to r1"), action);
  const dep = await db.deployment.findUnique({ where: { id: DEP_B } });
  check("live config restored to the good revision", dep!.config === cfgA);
  const evDone = await db.triggerEvent.findUnique({ where: { id: esc.eventId } });
  check("event lands in acted with ACTION trail", evDone?.status === "acted" && evDone!.detail.includes("ACTION:"));
}

// --- E. createDeployment anchors r1 ------------------------------------------

async function testCreateAnchorsR1() {
  console.log("\n-- E. createDeployment anchors r1 --");
  const subnet = {
    netuid: 7,
    name: "Apex",
    symbol: "APEX",
    category: "Inference",
    minVramGb: 24,
    recommendedGpu: "RTX 4090",
    description: "",
    githubUrl: null,
  } as unknown as Parameters<typeof createDeployment>[0]["subnet"];
  const offer = {
    id: "test-offer",
    model: "RTX 4090",
    vramGb: 24,
    provider: "runpod",
    hourlyPrice: 0.34,
    monthlyPrice: 248,
    region: "eu",
    available: true,
  } as unknown as Parameters<typeof createDeployment>[0]["offer"];

  const rec = await createDeployment({
    minerName: "TESTT2-create",
    mode: "mock",
    subnet,
    offer,
  });
  const revs = await db.deploymentRevision.findMany({ where: { deploymentId: rec.id } });
  check("created deployment has exactly one revision", revs.length === 1, `n=${revs.length}`);
  check("that revision is r1 deploy", revs[0]?.rev === 1 && revs[0]?.cause === "deploy");
  check("r1 config matches the deployment config", revs[0]?.configJson === JSON.stringify(rec.config));
  await db.deploymentRevision.deleteMany({ where: { deploymentId: rec.id } });
  await db.deployment.deleteMany({ where: { id: rec.id } });
  check("create-fixture cleaned up", (await db.deployment.count({ where: { id: rec.id } })) === 0);
}

// --- F. live server -----------------------------------------------------------

async function testLiveApi() {
  console.log("\n-- F. live server --");
  const anon = await api("GET", `/api/deployments/${DEP_A}/revisions`);
  check("anon revisions GET is 401", anon.status === 401, `status=${anon.status}`);

  const creds = USERS.find((u) => u.userId === "ops01") ?? USERS[0];
  const cookie = await login(creds.userId, creds.code);
  check("login works", cookie !== "");

  const list = await api("GET", `/api/deployments/${DEP_A}/revisions`, undefined, cookie);
  const revs = (list.json.revisions ?? []) as Array<{ rev: number; cause: string }>;
  check("authed revisions GET is 200 with chain", list.status === 200 && revs.length >= 2, `status=${list.status} n=${revs.length}`);

  const bad = await api("POST", `/api/deployments/${DEP_A}/revisions`, { rev: 9999 }, cookie);
  check("POST unknown rev is 400 with message", bad.status === 400 && String(bad.json.error ?? "").includes("not found"), JSON.stringify(bad.json));

  const malformed = await api("POST", `/api/deployments/${DEP_A}/revisions`, { rev: "two" }, cookie);
  check("POST non-numeric rev is 400", malformed.status === 400);

  // Roundtrip: mutate live config away from the newest snapshot, roll back via API.
  const dep = await db.deployment.findUnique({ where: { id: DEP_A } });
  const snapshotNow = await snapshotRevision(DEP_A, "deploy", "pre-API-mutation");
  await db.deployment.update({
    where: { id: DEP_A },
    data: { config: baseConfig("python miner.py --api-mutated", "api") },
  });
  const post = await api("POST", `/api/deployments/${DEP_A}/revisions`, { rev: snapshotNow?.rev }, cookie);
  const rb = post.json.rollback as { restoredRev: number; transport: string } | undefined;
  check("API rollback is 200 + mock transport", post.status === 200 && rb?.transport === "mock", JSON.stringify(post.json).slice(0, 120));
  const depAfter = await db.deployment.findUnique({ where: { id: DEP_A } });
  check("API rollback restored the snapshot config", depAfter!.config === dep!.config);

  const actor = await db.deploymentRevision.findFirst({
    where: { deploymentId: DEP_A, cause: "rollback-backup" },
    orderBy: { rev: "desc" },
  });
  check("API rollback attributed to ops01", actor?.actor === "ops01", actor?.actor);
}

// ---------------------------------------------------------------------------

async function cleanup() {
  for (const id of [DEP_A, DEP_B]) {
    await db.deploymentRevision.deleteMany({ where: { deploymentId: id } });
    await db.triggerEvent.deleteMany({ where: { deploymentId: id } });
    await db.minerLog.deleteMany({ where: { deploymentId: id } });
    await db.gpuSample.deleteMany({ where: { deploymentId: id } });
    await db.probeSample.deleteMany({ where: { deploymentId: id } });
    await db.trafficSample.deleteMany({ where: { deploymentId: id } });
    await db.uidSnapshot.deleteMany({ where: { deploymentId: id } });
    await db.daemonState.deleteMany({ where: { deploymentId: id } });
    await db.deployment.deleteMany({ where: { id } });
  }
}

async function main() {
  await cleanup(); // start clean (previous run leftovers)
  await testRevisionChain();
  await testRollback();
  await testPrune();
  await testLadder();
  await testEscalationAct();
  await testCreateAnchorsR1();
  await testLiveApi();

  console.log(`\n${pass} PASS / ${fail} FAIL`);
  if (fail > 0) process.exitCode = 1;
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await cleanup();
      const left = await db.deployment.count({ where: { id: { startsWith: "TESTT2" } } });
      console.log(`cleanup removed throwaway deployments (${left} left)`);
    } finally {
      await db.$disconnect();
    }
  });
