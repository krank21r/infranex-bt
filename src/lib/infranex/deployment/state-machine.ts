/**
 * Deployment state machine.
 *
 * States:
 *   requested → approved → provisioning → provisioned → setup
 *     → ready → deploying → started → stopping → stopped → terminated
 *
 * Plus a terminal `failed` state reachable from most active states.
 */

export type DeploymentState =
  | "requested"
  | "approved"
  | "provisioning"
  | "provisioned"
  | "setup"
  | "ready"
  | "deploying"
  | "started"
  | "stopping"
  | "stopped"
  | "terminated"
  | "failed";

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface DeploymentStep {
  name: string;
  label: string;
  status: StepStatus;
  startedAt: string | null;
  completedAt: string | null;
  output: string[];
}

export const DEPLOYMENT_STEPS: { name: string; label: string }[] = [
  { name: "request", label: "Request" },
  { name: "approve", label: "Approve" },
  { name: "provision", label: "Provision GPU" },
  { name: "setup", label: "Environment Setup" },
  { name: "deploy", label: "Deploy Miner" },
  { name: "health", label: "Health Check" },
];

const VALID_TRANSITIONS: Record<DeploymentState, DeploymentState[]> = {
  requested: ["approved", "failed", "terminated"],
  approved: ["provisioning", "terminated"],
  provisioning: ["provisioned", "failed", "terminated"],
  provisioned: ["setup", "terminated"],
  setup: ["ready", "failed", "terminated"],
  ready: ["deploying", "terminated"],
  deploying: ["started", "failed", "terminated"],
  started: ["stopping", "terminated"],
  stopping: ["stopped", "terminated"],
  stopped: ["terminated", "provisioning"],
  terminated: [],
  failed: [],
};

export function canTransition(from: DeploymentState, to: DeploymentState): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertCanTransition(from: DeploymentState, to: DeploymentState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition: ${from} → ${to}`);
  }
}

/** Map a deployment state to its step index (0-5). */
export function stateToStepIndex(state: DeploymentState): number {
  const map: Partial<Record<DeploymentState, number>> = {
    requested: 0,
    approved: 1,
    provisioning: 2,
    provisioned: 2,
    setup: 3,
    ready: 3,
    deploying: 4,
    started: 5,
  };
  return map[state] ?? 0;
}

/** Compute progress (0-100) from state. */
export function stateToProgress(state: DeploymentState): number {
  const map: Record<DeploymentState, number> = {
    requested: 5,
    approved: 15,
    provisioning: 35,
    provisioned: 45,
    setup: 60,
    ready: 70,
    deploying: 85,
    started: 100,
    stopping: 50,
    stopped: 100,
    terminated: 100,
    failed: 100,
  };
  return map[state] ?? 0;
}

/** Initialize step log from the template. */
export function initSteps(): DeploymentStep[] {
  return DEPLOYMENT_STEPS.map((s) => ({
    ...s,
    status: "pending" as StepStatus,
    startedAt: null,
    completedAt: null,
    output: [],
  }));
}

/** Advance the step log to reflect the current state. */
export function syncSteps(
  steps: DeploymentStep[],
  state: DeploymentState,
  outputs?: Record<string, string[]>
): DeploymentStep[] {
  const targetIdx = stateToStepIndex(state);
  return steps.map((step, i) => {
    if (i < targetIdx) {
      return {
        ...step,
        status: "done",
        startedAt: step.startedAt ?? new Date().toISOString(),
        completedAt: step.completedAt ?? new Date().toISOString(),
        output: outputs?.[step.name] ?? step.output,
      };
    }
    if (i === targetIdx) {
      const isRunning =
        state === "provisioning" ||
        state === "setup" ||
        state === "deploying" ||
        (state === "requested" && step.name === "request") ||
        (state === "approved" && step.name === "approve") ||
        (state === "started" && step.name === "health");
      if (state === "started" && step.name === "health") {
        return {
          ...step,
          status: "done",
          startedAt: step.startedAt ?? new Date().toISOString(),
          completedAt: new Date().toISOString(),
          output: outputs?.[step.name] ?? step.output,
        };
      }
      return {
        ...step,
        status: isRunning ? "running" : step.status === "done" ? "done" : "running",
        startedAt: step.startedAt ?? new Date().toISOString(),
        completedAt: null,
        output: outputs?.[step.name] ?? step.output,
      };
    }
    return step;
  });
}

export function serializeSteps(steps: DeploymentStep[]): string {
  return JSON.stringify(steps);
}

export function deserializeSteps(s: string): DeploymentStep[] {
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed as DeploymentStep[];
  } catch {
    // fall through
  }
  return initSteps();
}
