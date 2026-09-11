// ---------------------------------------------------------------------------
// Mining Journey progress — Phase 3: the 5-step stepper is driven by REAL
// state, not by what the user clicked.
//
// Two paths lead to a live miner and BOTH are honored (done = either):
//
//   Rental pipeline ("New deployment", DB rows):
//     choose subnet → the journey subnet itself (localStorage intent)
//     get a GPU     → a non-terminal Deployment row exists for the netuid
//     install       → its installStatus reached "installed" (or "started")
//     deploy & mine → status === "started"
//     connect       → registrationState === "registered" (chain-verified)
//
//   DevOps engine (BYO SSH hosts): the pre-existing host-based signals
//     (host connected / validated ready / install deployed), unchanged.
//
// The wizard's verified UID (localStorage) also counts for step 5 — it IS a
// real chain check, just performed before the deployment was bound.
//
// Pure and unit-tested — no react, no db, no chain.
// ---------------------------------------------------------------------------

export interface JourneyRentalState {
  deploymentId: string;
  minerName: string;
  status: string;
  mode: string;
  gpuModel: string;
  installStatus: string | null;
  installDone: number | null;
  installTotal: number | null;
  registrationState: string | null;
  registeredUid: number | null;
  restartedAfterRegistration: boolean;
  /** Short human line for the card body, e.g. "started · UID 0". */
  hint: string;
}

export interface JourneyProgress {
  s1: boolean;
  s2: boolean;
  s3: boolean;
  s4: boolean;
  s5: boolean;
  current: 1 | 2 | 3 | 4 | 5;
  rental: JourneyRentalState | null;
}

export interface JourneyProgressDeployment {
  id: string;
  minerName: string;
  netuid: number;
  status: string;
  mode: string;
  gpuModel: string;
  installStatus: string | null;
  installDone: number | null;
  installTotal: number | null;
  registrationState: string | null;
  registeredUid: number | null;
  restartedAfterRegistration: boolean;
}

const TERMINAL = new Set(["terminated", "failed"]);

/** Newest non-terminal deployment for the journey subnet (list is newest-first). */
export function findJourneyDeployment(
  deployments: JourneyProgressDeployment[],
  netuid: number
): JourneyProgressDeployment | null {
  return (
    deployments.find((d) => d.netuid === netuid && !TERMINAL.has(d.status)) ?? null
  );
}

function rentalHint(d: JourneyProgressDeployment): string {
  const parts: string[] = [d.status];
  if (d.status === "started") {
    if (d.registrationState === "registered") {
      parts.push(`UID ${d.registeredUid ?? "?"}`);
      if (!d.restartedAfterRegistration) parts.push("restart pending");
    } else if (d.registrationState === "unregistered") {
      parts.push("unregistered — register last");
    }
  } else if (d.installStatus === "awaiting_wallet" || d.installStatus === "running") {
    if (d.installDone !== null && d.installTotal !== null) {
      parts.push(`${d.installDone}/${d.installTotal} install steps`);
    }
  }
  return parts.join(" · ");
}

export function resolveJourneyProgress(input: {
  journey: { netuid: number } | null;
  hosts: { status: string; latestInstall?: { status?: string | null } | null }[];
  deployments: JourneyProgressDeployment[];
  verifiedUid: number | null;
  verifiedNetuid: number | null;
}): JourneyProgress {
  const s1 = input.journey !== null;

  // Rental path — the DB row for the journey subnet.
  const dep = input.journey
    ? findJourneyDeployment(input.deployments, input.journey.netuid)
    : null;
  const rental: JourneyRentalState | null = dep
    ? {
        deploymentId: dep.id,
        minerName: dep.minerName,
        status: dep.status,
        mode: dep.mode,
        gpuModel: dep.gpuModel,
        installStatus: dep.installStatus,
        installDone: dep.installDone,
        installTotal: dep.installTotal,
        registrationState: dep.registrationState,
        registeredUid: dep.registeredUid,
        restartedAfterRegistration: dep.restartedAfterRegistration,
        hint: rentalHint(dep),
      }
    : null;

  // DevOps (BYO host) path — pre-existing signals.
  const hostConnected = input.hosts.length > 0;
  const hostReady = input.hosts.some((h) => h.status === "ready");
  const hostDeployed = input.hosts.some((h) => h.latestInstall?.status === "deployed");

  const s2 = hostConnected || dep !== null;
  const s3 = hostReady || dep?.installStatus === "installed" || dep?.status === "started";
  const s4 = hostDeployed || dep?.status === "started";
  const s5 =
    dep?.registrationState === "registered" ||
    (input.verifiedUid !== null &&
      input.verifiedNetuid !== null &&
      input.journey !== null &&
      input.verifiedNetuid === input.journey.netuid);

  const current: 1 | 2 | 3 | 4 | 5 = !s1 ? 1 : !s2 ? 2 : !s3 ? 3 : !s4 ? 4 : 5;

  return { s1, s2, s3, s4, s5, current, rental };
}
