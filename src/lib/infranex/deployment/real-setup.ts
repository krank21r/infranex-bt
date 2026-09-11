// ---------------------------------------------------------------------------
// Real setup — the rental pipeline's actual muscle.
//
// Until now the rental engine's setup/deploy phases printed CANNED progress
// lines. This module replaces them with REAL execution:
//
//   provisioned → "setup"     kickSetup():  build the subnet's install plan
//                             (profiler profile + docker-or-venv path) and
//                             run every AUTO step over SSH on the pod,
//                             persisting per-step progress to the DB.
//   ready       → "deploying" kickDeploy(): wallet check (manual confirm),
//                             miner launch (the user's Advance click IS the
//                             approval), then live verify.
//   deploying   → "started"   transitionDeployment() once verify passes.
//
// Transport: runpod mode SSHes to the pod (ephemeral ed25519 key, encrypted
// at rest); mock mode runs the same plan against the scripted MockTransport
// so the whole flow is demoable with zero hardware.
//
// The runner is fire-and-forget: the API tick/GET only REPORTS progress
// (installStatus + mirrored output lines). The deployment state machine
// stays the single writer of `status`.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import {
  buildInstallPlan,
  failRemediation,
  runCompatibilityStep,
  timeoutForCmd,
  type InstallStep,
} from "@/lib/devops/installer";
import {
  pullSubnetRequirements,
  type SubnetRequirementsProfile,
} from "@/lib/devops/subnet-requirements";
import { openTransport } from "@/lib/devops/transport";
import type { Transport } from "@/lib/devops/transport";
import { decryptSecret } from "@/lib/devops/crypto";
import type { HostFacts } from "@/lib/devops/inspector";
import type { DeploymentConfig } from "./config";

/** In-flight runner guard — survives Next.js per-route module instances. */
const inFlight: Set<string> =
  ((globalThis as Record<string, unknown>).__infranexSetupRunning as Set<string>) ??
  new Set<string>();
(globalThis as Record<string, unknown>).__infranexSetupRunning = inFlight;

/** Host facts synthesized from the offer the user picked (no inspector run). */
export function syntheticFacts(config: DeploymentConfig): HostFacts {
  return {
    gpuName: config.gpu.model,
    gpuVramMb: Math.round(config.gpu.vramGb * 1024),
    // driver CUDA unknown until the docker step probes it on the real host
    driverCuda: undefined,
  };
}

async function loadRec(id: string) {
  const row = await db.deployment.findUnique({ where: { id } });
  if (!row) throw new Error("Deployment not found");
  if (!row.config) throw new Error("Deployment config missing");
  return row;
}

/** Open the transport for a deployment (SSH to the pod, or mock). */
export async function transportFor(id: string): Promise<Transport> {
  const row = await loadRec(id);
  if (row.mode === "mock") {
    return openTransport({ kind: "mock", hostId: `deployment-${id}` });
  }
  if (!row.sshHost || !row.sshPrivKeyEnc) {
    throw new Error(
      "Pod SSH details missing (ip / private key) — provisioning did not capture them"
    );
  }
  return openTransport({
    kind: "ssh",
    hostId: `deployment-${id}`,
    host: row.sshHost,
    port: row.sshPort ?? 22,
    user: "root",
    authMethod: "key",
    secret: decryptSecret(row.sshPrivKeyEnc),
  });
}

async function loadPlan(id: string): Promise<{
  steps: InstallStep[];
  profile: SubnetRequirementsProfile;
  config: DeploymentConfig;
}> {
  const row = await loadRec(id);
  if (!row.installStepsJson) throw new Error("No install plan staged for this deployment");
  return {
    steps: JSON.parse(row.installStepsJson) as InstallStep[],
    profile: JSON.parse(row.requirementsJsonSnapshot ?? "{}") as SubnetRequirementsProfile,
    config: JSON.parse(row.config) as DeploymentConfig,
  };
}

/** Mirror runner output lines into the deployment step log (setup/deploy/health). */
export async function mirrorStepOutput(
  id: string,
  phase: "setup" | "deploy" | "health",
  lines: string[]
): Promise<void> {
  if (lines.length === 0) return;
  const row = await db.deployment.findUnique({ where: { id } });
  if (!row) return;
  const steps = JSON.parse(row.steps) as Array<{
    name: string;
    output: string[];
    [k: string]: unknown;
  }>;
  const step = steps.find((s) => s.name === phase);
  if (!step) return;
  step.output = [...step.output, ...lines];
  await db.deployment.update({ where: { id }, data: { steps: JSON.stringify(steps) } });
}

async function persistInstall(
  id: string,
  steps: InstallStep[],
  status: "running" | "awaiting_wallet" | "installed" | "failed"
): Promise<void> {
  await db.deployment.update({
    where: { id },
    data: { installStepsJson: JSON.stringify(steps), installStatus: status },
  });
}

/** Execute one non-virtual step's commands over the transport. */
async function execStep(step: InstallStep, transport: Transport): Promise<void> {
  step.status = "running";
  step.output = "";
  for (const cmd of step.commands) {
    step.output += `$ ${cmd}\n`;
    const r = await transport.exec(cmd, timeoutForCmd(cmd));
    if (r.stdout.trim()) step.output += r.stdout.trim() + "\n";
    if (r.stderr.trim()) step.output += r.stderr.trim() + "\n";
    if (r.code !== 0) {
      step.status = "fail";
      step.remediation = failRemediation(step, r.code);
      return;
    }
  }
  step.status = "pass";
  if (step.output.trim().length === 0) step.output = "done";
}

/** Fire-and-forget runner start (idempotent per deployment). */
function startRunner(id: string, fn: () => Promise<void>): void {
  if (inFlight.has(id)) return;
  inFlight.add(id);
  void (async () => {
    try {
      await fn();
    } catch (e) {
      console.warn(`[real-setup ${id}] runner crashed: ${e instanceof Error ? e.message : e}`);
      await db.deployment
        .update({ where: { id }, data: { installStatus: "failed" } })
        .catch(() => {});
    } finally {
      inFlight.delete(id);
    }
  })();
}

// ---------------------------------------------------------------------------
// Staging + runners
// ---------------------------------------------------------------------------

/**
 * Build and stage the install plan for a deployment, then start the auto-step
 * runner (setup phase). Called when the rental engine enters "setup".
 */
export async function stageAndRunSetup(id: string): Promise<void> {
  const row = await loadRec(id);
  const config = JSON.parse(row.config) as DeploymentConfig;
  const { profile } = await pullSubnetRequirements(config.miner.netuid);
  const plan = buildInstallPlan({
    profile,
    walletName: config.miner.walletName,
    hotkeyName: config.miner.hotkeyName,
    hostFacts: syntheticFacts(config),
  });
  await db.deployment.update({
    where: { id },
    data: {
      installStepsJson: JSON.stringify(plan),
      installStatus: "running",
      requirementsJsonSnapshot: JSON.stringify(profile),
    },
  });
  await mirrorStepOutput(id, "setup", [
    `[plan] ${plan.length} steps staged — subnet "${profile.subnetName}" (repo: ${profile.repoUrl ?? "none"}), path: ${profile.dockerfileFound && profile.dockerImage ? "Docker" : "Python venv"}`,
  ]);
  startRunner(id, () => runAutoSteps(id));
}

/** Run every gate==="auto" step of the plan, mirroring progress. */
async function runAutoSteps(id: string): Promise<void> {
  const { steps, profile, config } = await loadPlan(id);
  let transport: Transport | null = null;
  try {
    for (const step of steps) {
      if (step.gate !== "auto") break; // stop at the wallet gate
      if (step.status === "pass" || step.status === "skipped") continue;
      try {
        if (step.virtual) {
          if (step.idx === 1) {
            runCompatibilityStep(step, profile, syntheticFacts(config));
          } else {
            step.status = "skipped";
            step.output = "Skipped — nothing to do for this subnet.";
          }
        } else {
          transport ??= await transportFor(id);
          await execStep(step, transport);
        }
      } catch (e) {
        step.status = "fail";
        step.output += `\n[engine] ${e instanceof Error ? e.message : String(e)}`;
        step.remediation = "Transport error — check the pod is RUNNING, then press Advance to retry.";
      }
      await persistInstall(id, steps, step.status === "fail" ? "failed" : "running");
      // "pass" falls into the else — TS's loop-entry narrowing excludes it.
      const mark = step.status === "fail" ? "✗" : step.status === "skipped" ? "·" : "✓";
      await mirrorStepOutput(id, "setup", [
        `[${step.idx}/${steps.length}] ${mark} ${step.title}`,
        ...step.output.split("\n").filter(Boolean).slice(0, 12),
        ...(step.status === "fail" && step.remediation ? [`[fix hint] ${step.remediation}`] : []),
      ]);
      if (step.status === "fail") return; // tick reports; Advance = retry
    }
    await persistInstall(id, steps, "awaiting_wallet");
    await mirrorStepOutput(id, "setup", [
      "[plan] environment ready — wallet files gate next.",
      "Copy your keys with the Connect & register wizard (Step 5 of the journey), then press Advance to launch.",
    ]);
  } finally {
    transport?.close();
  }
}

/**
 * Deploy phase: wallet gate (manual confirmation — the user's Advance click),
 * miner launch (approval gate — same click), then live verify. On success the
 * deployment transitions to "started".
 */
export async function runDeployPhase(id: string): Promise<void> {
  const { steps } = await loadPlan(id);
  let transport: Transport | null = null;
  try {
    for (const step of steps) {
      if (step.status === "pass" || step.status === "skipped") continue;
      const phase: "deploy" | "health" = step.title.startsWith("Verify") ? "health" : "deploy";
      try {
        if (step.gate === "manual") {
          // Manual confirmation — mirrors the DevOps engine's wallet override.
          step.status = "pass";
          step.output = `Manual confirmation accepted — wallet files assumed in place ($HOME/.bittensor/wallets). Real pods: scp your keys or let the wizard guide you BEFORE this point; a missing key fails the launch step.`;
        } else if (step.virtual) {
          step.status = "skipped";
          step.output = "Skipped.";
        } else {
          transport ??= await transportFor(id);
          await execStep(step, transport);
        }
      } catch (e) {
        step.status = "fail";
        step.output += `\n[engine] ${e instanceof Error ? e.message : String(e)}`;
        step.remediation = "Transport error — check the pod is RUNNING, then press Advance to retry.";
      }
      const anyFail = steps.some((s) => s.status === "fail");
      await persistInstall(id, steps, anyFail ? "failed" : "running");
      await mirrorStepOutput(id, phase, [
        `[${step.title}] ${step.status}`,
        ...step.output.split("\n").filter(Boolean).slice(0, 14),
        ...(step.status === "fail" && step.remediation ? [`[fix hint] ${step.remediation}`] : []),
      ]);
      if (step.status === "fail") return;
    }
    // All steps passed — flip deploying → started BEFORE marking installed so
    // the tick never races into a double advance (state machine is the
    // single writer of `status`; installStatus is just reporting).
    const { transitionDeployment } = await import("./engine");
    await transitionDeployment(id, "started");
    await persistInstall(id, steps, "installed");
  } finally {
    transport?.close();
  }
}

/** Kick the deploy-phase runner (called by the engine entering "deploying"). */
export function kickDeploy(id: string): void {
  startRunner(id, () => runDeployPhase(id));
}

/**
 * Retry the setup phase after a failure: reset failed/running steps to
 * pending (passed steps stay passed), re-stage, re-kick. Triggered by an
 * explicit Advance press in "setup" when installStatus is "failed".
 */
export async function retrySetup(id: string): Promise<void> {
  const { steps } = await loadPlan(id);
  for (const s of steps) {
    if (s.status === "fail" || s.status === "running") {
      s.status = "pending";
      s.output = "";
      s.remediation = null;
      s.durationMs = 0;
    }
  }
  await db.deployment.update({
    where: { id },
    data: { installStepsJson: JSON.stringify(steps), installStatus: "running" },
  });
  await mirrorStepOutput(id, "setup", ["[plan] retry requested — re-running failed steps…"]);
  startRunner(id, () => runAutoSteps(id));
}
