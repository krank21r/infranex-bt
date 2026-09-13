// ---------------------------------------------------------------------------
// DEVOPS-2 — "the DevOps engine checks subnet changes and implements them in
// the GPU" — test against a running dev server + direct lib calls.
//
// Covers:
//   - planDriftRemediation classification (hyper → resync_config, capacity
//     → restart, economics → evaluate, strongest wins on mixed drift)
//   - diffProfiles human-readable deltas
//   - applySubnetConfigToGpu with an ONLINE daemon: regenerates the miner
//     command from the fresh profile, updates snapshot + deployment config,
//     enqueues apply_config (with substituted wallet/env) on the daemon
//   - applySubnetConfigToGpu on a mock deployment: simulated apply
//   - the approval-gated executor via API: approved SUBNET_DRIFT "restart"
//     event → act → restart_miner queued via daemon, event acted, ACTION
//     note recorded; "evaluate" event → acknowledged, daemon untouched
//   - auth gating (anonymous act → 401 via the proxy gate)
//
// Throwaway deployments (TESTAPPLY*) are fully cleaned up.
//
// Run:  bun scripts/test-devops-apply.ts   (server up on :3000)
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
dotenv.config({ override: true });
import { PrismaClient } from "@prisma/client";
import { planDriftRemediation } from "../src/lib/infranex/devops-monitor";
import {
  applySubnetConfigToGpu,
  diffProfiles,
} from "../src/lib/infranex/deployment/apply-drift";
import type { SubnetRequirementsProfile } from "../src/lib/devops/subnet-requirements";

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

const DEP_DAEMON = "TESTAPPLY-daemon";
const DEP_MOCK = "TESTAPPLY-mock";
const DEP_API = "TESTAPPLY-api";

function makeProfile(over: Partial<SubnetRequirementsProfile> = {}): SubnetRequirementsProfile {
  return {
    netuid: 950,
    subnetName: "Apply Test Subnet",
    description: null,
    category: "Inference",
    minVramGb: 24,
    recommendedGpu: "RTX 4090",
    gpuSource: "curated",
    osPackages: ["git", "curl"],
    pythonVersion: "3.10",
    pipPackages: ["bittensor"],
    pipPackageCount: 10,
    gitDeps: [],
    cudaMinVersion: "12.1",
    dockerImage: null,
    dockerRequired: false,
    bittensorStack: ["bittensor"],
    packageManager: "pip",
    repoUrl: null,
    repoBranch: "main",
    entrypoint: "neurons/miner.py",
    readmeUrl: null,
    requirementsUrl: null,
    dockerfileFound: false,
    chainNetwork: "finney",
    ports: { axon: 8091, prometheus: 8092 },
    envKeys: [
      { name: "BT_NETWORK", description: "network", required: true },
      { name: "BT_NETUID", description: "netuid", required: true },
      { name: "BT_WALLET_NAME", description: "wallet", required: true },
      { name: "BT_HOTKEY_NAME", description: "hotkey", required: true },
    ],
    minerCommandTemplate:
      "python neurons/miner.py --netuid 950 --subtensor.network finney --wallet.name <WALLET> --wallet.hotkey <HOTKEY> --axon.port 8091",
    sources: ["curated"],
    confidence: "low",
    notes: [],
    fetchedAt: new Date().toISOString(),
    ...over,
  };
}

const MINIMAL_CONFIG = {
  docker: {
    command:
      "python neurons/miner.py --netuid 950 --subtensor.network finney --wallet.name testwallet --wallet.hotkey default --axon.port 8091",
  },
  miner: { walletName: "testwallet", hotkeyName: "default", netuid: 950 },
  requirements: { minVramGb: 24, pythonVersion: "3.10", cudaVersion: "12.1" },
};

async function createDep(id: string, mode: string, netuid: number, withSnapshot: boolean) {
  await db.deployment.create({
    data: {
      id,
      minerName: `apply-test-${id}`,
      netuid,
      subnetName: "Apply Test Subnet",
      gpuModel: "TestGPU",
      provider: "runpod",
      mode,
      status: "started",
      hourlyCost: 0.12,
      monthlyCost: 87.6,
      config: JSON.stringify(MINIMAL_CONFIG),
      requirementsJsonSnapshot: withSnapshot ? JSON.stringify(makeProfile()) : null,
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

function queuedCommands(commandsJson: string): Array<{ command: string; args?: Record<string, unknown> }> {
  try {
    const v = JSON.parse(commandsJson);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

async function cleanup() {
  for (const id of [DEP_DAEMON, DEP_MOCK, DEP_API]) {
    await db.triggerEvent.deleteMany({ where: { deploymentId: id } });
    await db.daemonState.deleteMany({ where: { deploymentId: id } });
    await db.gpuSample.deleteMany({ where: { deploymentId: id } });
    await db.uidSnapshot.deleteMany({ where: { deploymentId: id } });
    await db.deployment.deleteMany({ where: { id } });
  }
}

async function main() {
  console.log(`DEVOPS-2 apply test → ${BASE}\n`);

  try {
    await cleanup();

    // --- remediation planner (pure) ----------------------------------------
    const hyper = planDriftRemediation(["tempo 100 → 50"]);
    check(
      "hyperparameter drift → resync_config with 4-step GPU apply plan",
      hyper.suggestedAction === "resync_config" && hyper.applyPlan.length === 4,
      JSON.stringify(hyper)
    );
    const cap = planDriftRemediation(["metagraph capacity 256 → 300 UIDs (+44)"]);
    check("capacity drift → restart", cap.suggestedAction === "restart");
    const econ = planDriftRemediation(["subnet economics shifted down: median rewarded incentive 1.20% → 0.40%"]);
    check("economics drift → evaluate (no GPU mutation)", econ.suggestedAction === "evaluate");
    const mixed = planDriftRemediation([
      "subnet economics shifted down",
      "immunityPeriod 7200 → 3600 blocks",
    ]);
    check("mixed drift → strongest remediation wins (resync_config)", mixed.suggestedAction === "resync_config");

    // --- profile diff --------------------------------------------------------
    const deltas = diffProfiles(makeProfile(), makeProfile({ entrypoint: "neurons/awesome/miner.py", pipPackageCount: 14 }));
    check(
      "diffProfiles lists entrypoint + python deps deltas",
      deltas.some((d) => d.includes("entrypoint")) && deltas.some((d) => d.includes("10 → 14")),
      JSON.stringify(deltas)
    );

    // --- direct apply with an ONLINE daemon ----------------------------------
    await createDep(DEP_DAEMON, "runpod", 950, true);
    await createOnlineDaemon(DEP_DAEMON);
    const freshProfile = makeProfile({
      entrypoint: "neurons/awesome/miner.py",
      pipPackageCount: 14,
      minerCommandTemplate:
        "python neurons/awesome/miner.py --netuid 950 --subtensor.network finney --wallet.name <WALLET> --wallet.hotkey <HOTKEY> --axon.port 8091",
    });
    const r1 = await applySubnetConfigToGpu(DEP_DAEMON, {
      fetchProfile: async () => ({ profile: freshProfile, cached: false }),
    });
    check(
      "apply → daemon transport, ≥2 deltas applied",
      r1.transport === "daemon" && r1.applied.length >= 2,
      JSON.stringify(r1)
    );
    const daemonRow = await db.daemonState.findUnique({ where: { deploymentId: DEP_DAEMON } });
    const cmds = queuedCommands(daemonRow?.commandsJson ?? "[]");
    const applyCmd = cmds.find((c) => c.command === "apply_config");
    check("apply_config enqueued on the daemon", applyCmd !== undefined, JSON.stringify(cmds));
    const minerCommand = typeof applyCmd?.args?.minerCommand === "string" ? applyCmd.args.minerCommand : "";
    check(
      "apply_config carries the NEW entrypoint with wallet substituted (no < placeholders)",
      minerCommand.includes("neurons/awesome/miner.py") &&
        minerCommand.includes("--wallet.name testwallet") &&
        !minerCommand.includes("<"),
      minerCommand
    );
    const envArgs = applyCmd?.args?.env as Record<string, unknown> | undefined;
    check(
      "apply_config carries env (BT_NETUID/BT_WALLET_NAME)",
      envArgs?.BT_NETUID === "950" && envArgs?.BT_WALLET_NAME === "testwallet",
      JSON.stringify(applyCmd?.args?.env)
    );
    const depAfter = await db.deployment.findUnique({ where: { id: DEP_DAEMON } });
    const snap = depAfter?.requirementsJsonSnapshot ? JSON.parse(depAfter.requirementsJsonSnapshot) : null;
    check("requirements snapshot updated to the fresh profile", snap?.entrypoint === "neurons/awesome/miner.py");
    const cfgAfter = JSON.parse(depAfter?.config ?? "{}");
    check(
      "deployment docker.command regenerated",
      cfgAfter?.docker?.command?.includes("neurons/awesome/miner.py") &&
        cfgAfter?.docker?.command?.includes("--wallet.name testwallet"),
      cfgAfter?.docker?.command
    );

    // --- direct apply on a MOCK deployment (no daemon) -----------------------
    await createDep(DEP_MOCK, "mock", 951, true);
    const r2 = await applySubnetConfigToGpu(DEP_MOCK, {
      fetchProfile: async () => ({ profile: makeProfile({ entrypoint: "neurons/mock/miner.py" }), cached: false }),
    });
    check(
      "mock deployment apply → simulated (mock transport)",
      r2.transport === "mock" && r2.applied.some((d) => d.includes("entrypoint")),
      JSON.stringify(r2)
    );

    // --- API: auth gate + executor -------------------------------------------
    const anon = await api("POST", "/api/triggers", { action: "act", id: "whatever" });
    check("anonymous act → 401 (proxy gate)", anon.status === 401, `got ${anon.status}`);

    const admin = USERS.find((u) => u.userId === "admin")!;
    const adminCookie = await login(admin.userId, admin.code);
    check("admin login works", adminCookie.startsWith("infranex_session="));

    // approved "restart" drift → act queues restart_miner via daemon
    await createDep(DEP_API, "runpod", 951, false);
    await createOnlineDaemon(DEP_API);
    const evRestart = await db.triggerEvent.create({
      data: {
        kind: "SUBNET_DRIFT",
        severity: "warning",
        status: "approved",
        title: "α951 Apply Test Subnet changed (restart)",
        detail: "metagraph capacity changed",
        evidenceJson: JSON.stringify({
          netuid: 951,
          changes: ["metagraph capacity 256 → 300 UIDs (+44)"],
          suggestedAction: "restart",
          actionLabel: "Restart the miner so it re-syncs the metagraph (GPU apply)",
        }),
        dedupeKey: `${DEP_API}:subnet-drift`,
        deploymentId: DEP_API,
        netuid: 951,
        runbookJson: JSON.stringify(["Approve to apply the change to the GPU miner."]),
      },
    });
    const actRestart = await api("POST", "/api/triggers", { action: "act", id: evRestart.id }, adminCookie);
    check(
      "act(restart drift) → restart_miner queued via daemon",
      actRestart.status === 200 &&
        String(actRestart.json?.action ?? "").includes("restart_miner queued"),
      JSON.stringify(actRestart.json)
    );
    check("event transitioned to acted", actRestart.json?.event?.status === "acted");
    check(
      "ACTION note recorded in the event detail (audit trail)",
      String(actRestart.json?.event?.detail ?? "").includes("ACTION: Applied to GPU"),
      actRestart.json?.event?.detail
    );
    const apiDaemon = await db.daemonState.findUnique({ where: { deploymentId: DEP_API } });
    check(
      "restart_miner present in the daemon queue",
      queuedCommands(apiDaemon?.commandsJson ?? "[]").some((c) => c.command === "restart_miner")
    );

    // approved "evaluate" drift → act acknowledges, daemon queue untouched
    const cmdsBefore = (apiDaemon?.commandsJson ?? "[]").length;
    const evEval = await db.triggerEvent.create({
      data: {
        kind: "SUBNET_DRIFT",
        severity: "info",
        status: "approved",
        title: "α951 Apply Test Subnet changed (economics)",
        detail: "economics shifted",
        evidenceJson: JSON.stringify({
          netuid: 951,
          changes: ["subnet economics shifted down"],
          suggestedAction: "evaluate",
        }),
        dedupeKey: `${DEP_API}:econ`,
        deploymentId: DEP_API,
        netuid: 951,
        runbookJson: JSON.stringify(["Review economics."]),
      },
    });
    const actEval = await api("POST", "/api/triggers", { action: "act", id: evEval.id }, adminCookie);
    check(
      "act(evaluate drift) → acknowledged, no GPU mutation",
      actEval.status === 200 && String(actEval.json?.action ?? "").includes("Acknowledged"),
      JSON.stringify(actEval.json)
    );
    const apiDaemonAfter = await db.daemonState.findUnique({ where: { deploymentId: DEP_API } });
    check(
      "evaluate path left the daemon queue untouched",
      (apiDaemonAfter?.commandsJson ?? "[]").length === cmdsBefore
    );
  } finally {
    await cleanup();
    const left = await db.deployment.count({
      where: { id: { in: [DEP_DAEMON, DEP_MOCK, DEP_API] } },
    });
    check("cleanup removed throwaway deployments + events + daemons", left === 0, `left=${left}`);
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
