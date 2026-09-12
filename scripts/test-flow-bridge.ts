/**
 * FLOW-1 — rental → DevOps auto-bridge test suite.
 *
 * Covers the shared bridge lib (src/lib/infranex/deployment/to-devops.ts):
 *   1. bridgeDeploymentToDevOps creates a GPU host from a provisioned
 *      runpod deployment's connect info (IP, mapped SSH port, engine key).
 *   2. Idempotency — a second bridge call reuses the same host row.
 *   3. Mock deployments are rejected (no real host behind them).
 *   4. Status gate — a deployment that never reached provisioned is rejected.
 *   5. appendProvisionNote appends exactly one honest note line (idempotent).
 *
 * Run: bunx tsx scripts/test-flow-bridge.ts   (needs the dev DB + .env)
 */

import dotenv from "dotenv";
// override: the shell may carry a STALE DATABASE_URL export (pre-recovery
// path) — the project .env must win, matching what the dev server loads.
dotenv.config({ override: true });
import { db } from "../src/lib/db";
import { encryptSecret } from "../src/lib/devops/crypto";
import {
  BridgeError,
  bridgeDeploymentToDevOps,
  appendProvisionNote,
} from "../src/lib/infranex/deployment/to-devops";
import { serializeSteps, initSteps } from "../src/lib/infranex/deployment/state-machine";
import type { DeploymentStep } from "../src/lib/infranex/deployment/state-machine";

let failures = 0;
function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
  if (!cond) failures++;
}

const POD_ID = `flow1-test-pod-${Date.now()}`;
const createdDeploymentIds: string[] = [];
const createdHostIds: string[] = [];

async function makeDeployment(opts: {
  mode: "runpod" | "mock";
  status: string;
  withKey?: boolean;
}): Promise<string> {
  const steps: DeploymentStep[] = initSteps().map((s) =>
    s.name === "provision" ? { ...s, status: "done", output: ["Pod provisioned ✓"] } : s
  );
  const row = await db.deployment.create({
    data: {
      minerName: "flow1-bridge-test",
      netuid: 64,
      subnetName: "Chutes",
      gpuModel: "H100 80GB",
      provider: opts.mode === "runpod" ? "RunPod" : "Demo",
      status: opts.status,
      progress: 40,
      mode: opts.mode,
      hourlyCost: 1.19,
      monthlyCost: 856,
      estimatedRevenue: 1200,
      config: JSON.stringify({
        docker: { envVars: [{ name: "POD_IP", value: "10.0.0.7" }] },
      }),
      providerPodId: opts.mode === "runpod" ? POD_ID : null,
      sshPublicKey: opts.withKey === false ? null : "ssh-ed25519 AAAA test-key",
      sshPrivKeyEnc: opts.withKey === false ? null : encryptSecret("-----BEGIN TEST KEY-----"),
      sshHost: opts.mode === "runpod" ? "203.0.113.10" : null,
      sshPort: opts.mode === "runpod" ? 18745 : null,
      steps: serializeSteps(steps),
    },
  });
  createdDeploymentIds.push(row.id);
  return row.id;
}

async function main() {
  console.log("— FLOW-1 bridge: create → reuse → reject → note —\n");

  // 1 — happy path: provisioned runpod deployment → host created with prefilled connect info
  const depId = await makeDeployment({ mode: "runpod", status: "provisioned" });
  const r1 = await bridgeDeploymentToDevOps(depId);
  check("bridge succeeds on provisioned runpod deployment", r1.ok === true && r1.created === true);
  check("host name follows the miner name", r1.hostName === "flow1-bridge-test", r1.hostName);
  const host1 = await db.gpuHost.findUnique({ where: { id: r1.hostId } });
  createdHostIds.push(r1.hostId);
  check(
    "connect info prefilled: IP from sshHost (fresh engine capture wins)",
    host1?.host === "203.0.113.10",
    host1?.host
  );
  check("mapped SSH port carried over", host1?.port === 18745, String(host1?.port));
  check("provider tagged runpod", host1?.provider === "runpod", host1?.provider);
  check("auth is key-based, user root", host1?.authMethod === "key" && host1?.user === "root");
  check("host starts as pending validation", host1?.status === "pending", host1?.status);
  check("pod id linked for idempotency", host1?.providerPodId === POD_ID);

  // 2 — idempotency: second call reuses the SAME host row
  const r2 = await bridgeDeploymentToDevOps(depId);
  check("second bridge reuses the same host (created=false)", r2.created === false && r2.hostId === r1.hostId);
  const hostCount = await db.gpuHost.count({ where: { providerPodId: POD_ID } });
  check("no duplicate host rows", hostCount === 1, String(hostCount));

  // 3 — daemon registered for the trigger engine
  const daemon = await db.daemonState.findUnique({ where: { deploymentId: depId } });
  check("node daemon registered for the host", daemon != null);

  // 4 — mock deployments rejected (no real machine behind them)
  const mockId = await makeDeployment({ mode: "mock", status: "provisioned" });
  let mockErr: BridgeError | null = null;
  try {
    await bridgeDeploymentToDevOps(mockId);
  } catch (e) {
    mockErr = e as BridgeError;
  }
  check(
    "mock deployment rejected with 400",
    mockErr instanceof BridgeError && mockErr.status === 400,
    mockErr?.message
  );

  // 5 — status gate: requested (pre-provision) runpod deployment rejected
  const earlyId = await makeDeployment({ mode: "runpod", status: "requested" });
  let earlyErr: BridgeError | null = null;
  try {
    await bridgeDeploymentToDevOps(earlyId);
  } catch (e) {
    earlyErr = e as BridgeError;
  }
  check(
    "pre-provision deployment rejected",
    earlyErr instanceof BridgeError && earlyErr.status === 400,
    earlyErr?.message
  );

  // 6 — honest provision note, exactly once
  await appendProvisionNote(depId, "DevOps hand-off: pod registered as GPU host \"flow1-bridge-test\" — connect info prefilled in the host inventory.");
  await appendProvisionNote(depId, "DevOps hand-off: pod registered as GPU host \"flow1-bridge-test\" — connect info prefilled in the host inventory.");
  const after = await db.deployment.findUnique({ where: { id: depId } });
  const steps: DeploymentStep[] = JSON.parse(after!.steps);
  const prov = steps.find((s) => s.name === "provision");
  const noteLines = prov!.output.filter((l) => l.startsWith("DevOps hand-off:"));
  check("provision note appended exactly once", noteLines.length === 1, JSON.stringify(prov!.output));

  console.log("");
  if (failures > 0) {
    console.log(`RESULT: ${failures} FAILURE(S)`);
    process.exitCode = 1;
  } else {
    console.log("RESULT: all bridge checks passed");
  }
}

main()
  .catch((e) => {
    console.error("FATAL —", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Cleanup — remove every row this test created.
    for (const id of createdDeploymentIds) {
      await db.daemonState.deleteMany({ where: { deploymentId: id } });
      await db.deployment.deleteMany({ where: { id } });
    }
    for (const id of createdHostIds) {
      await db.gpuHost.deleteMany({ where: { id } });
    }
    await db.$disconnect();
  });
