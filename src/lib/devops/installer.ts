// ---------------------------------------------------------------------------
// DevOps Engine — Requirement Installer.
//
// Takes a SubnetRequirementsProfile (pulled from the subnet) + a validated
// GPU host and INSTALLS everything the subnet needs on that machine:
//
//   1 Compatibility  host GPU/VRAM/CUDA vs the subnet's requirements
//   2 OS packages    apt: git, python3-venv, build-essential, + repo hints
//   3 Python venv    /opt/infranex/sn<netuid>/venv (version-checked)
//   4 Clone repo     the subnet's actual GitHub repo
//   5 Python deps    pip install -r requirements.txt (or bittensor baseline)
//   6 Miner env      BT_* environment file for this subnet
//   7 Wallet files   ~/.bittensor/wallets/... — MANUAL GATE (your keys, your copy)
//   8 Launch miner   systemd unit → venv python <entrypoint> --netuid … (APPROVAL)
//   9 Verify         service active + axon port listening + log tail
//
// Steps execute one at a time via the Transport (SSH or mock) and persist to
// the HostInstall row so the wizard UI is resumable and auditable.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import type { GpuHost } from "@prisma/client";
import type { Transport } from "./transport";
import type { SubnetRequirementsProfile } from "./subnet-requirements";
import type { HostFacts } from "./inspector";

export type InstallStepStatus = "pending" | "running" | "pass" | "fail" | "skipped";
export type InstallGate = "auto" | "approval" | "manual";

export interface InstallStep {
  id: string;
  idx: number;
  title: string;
  description: string;
  gate: InstallGate;
  /** Commands shown to the user + executed on the host. */
  commands: string[];
  /** When true the step checks state instead of executing commands. */
  virtual?: boolean;
  status: InstallStepStatus;
  output: string;
  remediation: string | null;
  durationMs: number;
}

export interface InstallPlanInput {
  profile: SubnetRequirementsProfile;
  walletName: string;
  hotkeyName: string;
  hostFacts: HostFacts | null;
}

const APP_ROOT = (netuid: number) => `/opt/infranex/sn${netuid}`;
const UNIT_NAME = (netuid: number) => `infranex-miner-sn${netuid}`;

// --- Plan builder -----------------------------------------------------------

export function buildInstallPlan(input: InstallPlanInput): InstallStep[] {
  const { profile, walletName, hotkeyName, hostFacts } = input;
  const netuid = profile.netuid;
  const root = APP_ROOT(netuid);
  const unit = UNIT_NAME(netuid);
  const steps: InstallStep[] = [];
  let idx = 1;
  const push = (s: Omit<InstallStep, "idx" | "status" | "output" | "remediation" | "durationMs" | "id">) =>
    steps.push({
      ...s,
      id: `s${idx}`,
      idx: idx++,
      status: "pending",
      output: "",
      remediation: null,
      durationMs: 0,
    });

  // 1 — Compatibility (virtual check against the last inspection facts)
  push({
    title: "Match subnet requirements to host",
    description: profile.minVramGb > 0
      ? `Subnet needs ≥ ${profile.minVramGb} GB VRAM (${profile.recommendedGpu}); host reports ${hostFacts?.gpuName ?? "?"}${hostFacts?.gpuVramMb ? ` ${Math.round(hostFacts.gpuVramMb / 1024)} GB` : ""}.`
      : "Subnet workload is CPU-friendly; no GPU constraint.",
    gate: "auto",
    commands: [],
    virtual: true,
  });

  // 2 — OS packages
  const pkgs = [...new Set(profile.osPackages)].join(" ");
  push({
    title: "Install OS packages",
    description: `apt-get install: ${[...new Set(profile.osPackages)].slice(0, 8).join(", ")}${profile.osPackages.length > 8 ? "…" : ""}`,
    gate: "auto",
    commands: [
      `export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq ${pkgs}`,
    ],
  });

  // 3 — Python venv (version-checked when the repo declares one).
  // uv workspace repos manage their own venv via `uv sync` — skip this.
  const pyCheck = profile.pythonVersion
    ? `python3 --version | grep -q "Python ${profile.pythonVersion}" || { echo "python ${profile.pythonVersion} required — install via deadsnakes"; exit 1; } && `
    : "";
  if (profile.packageManager === "uv") {
    push({
      title: "Python environment",
      description: `uv workspace repo — uv creates and manages the venv (${root}/app/.venv). Python ${profile.pythonVersion ?? "3"} must still be present.`,
      gate: "auto",
      commands: [],
      virtual: true,
    });
  } else {
    push({
      title: "Create Python virtual environment",
      description: profile.pythonVersion
        ? `Repo declares Python ${profile.pythonVersion}; venv at ${root}/venv`
        : `Distro Python; venv at ${root}/venv`,
      gate: "auto",
      commands: [`${pyCheck}mkdir -p ${root} && python3 -m venv ${root}/venv && ${root}/venv/bin/pip --version`],
    });
  }

  // 4 — Clone the subnet repo
  if (profile.repoUrl) {
    push({
      title: "Clone the subnet repository",
      description: `${profile.repoUrl} → ${root}/app`,
      gate: "auto",
      commands: [`rm -rf ${root}/app && git clone --depth 1 ${profile.repoUrl} ${root}/app`],
    });
  } else {
    push({
      title: "Clone the subnet repository",
      description: "No repo linked on-chain — skipped (bittensor baseline install only).",
      gate: "auto",
      commands: [],
      virtual: true,
    });
  }

  // 5 — Python dependencies (pip + requirements, or uv sync for workspaces)
  const pythonBin = profile.packageManager === "uv" ? `${root}/app/.venv/bin/python` : `${root}/venv/bin/python`;
  if (profile.packageManager === "uv") {
    push({
      title: "Install the subnet's Python dependencies",
      description: "pip installs uv, then the repo's own uv workspace resolves + installs everything into app/.venv",
      gate: "auto",
      commands: [
        `pip3 install --user uv 2>/dev/null || pip3 install uv || { curl -LsSf https://astral.sh/uv/install.sh | sh; }`,
        `cd ${root}/app && uv sync --frozen || uv sync`,
      ],
    });
  } else {
    const pipReq = profile.repoUrl
      ? `${root}/venv/bin/pip install -r ${root}/app/requirements.txt 2>/dev/null || ${root}/venv/bin/pip install bittensor`
      : `${root}/venv/bin/pip install bittensor`;
    push({
      title: "Install the subnet's Python dependencies",
      description:
        profile.pipPackageCount > 0
          ? `${profile.pipPackageCount} packages from the repo's requirements (${profile.bittensorStack.length ? `stack: ${profile.bittensorStack.join(", ")}` : "see plan commands"})`
          : "bittensor baseline stack",
      gate: "auto",
      commands: [
        `${root}/venv/bin/pip install --upgrade pip wheel setuptools`,
        pipReq,
      ],
    });
  }

  // 6 — Miner environment file
  const envLines = [
    `BT_NETWORK=finney`,
    `BT_NETUID=${netuid}`,
    `BT_WALLET_NAME=${walletName}`,
    `BT_HOTKEY_NAME=${hotkeyName}`,
    `CUDA_VISIBLE_DEVICES=0`,
    `INFRANEX_MINER_CMD=${profile.minerCommandTemplate.replace(/</g, "").replace(/>/g, "")}`,
  ];
  push({
    title: "Write the miner environment",
    description: `${root}/env — network, netuid, wallet, GPU device`,
    gate: "auto",
    commands: [
      `mkdir -p ${root} && printf '%s\\n' ${envLines.map((l) => `'${l}'`).join(" ")} > ${root}/env && cat ${root}/env`,
    ],
  });

  // 7 — Wallet files (manual gate: private keys never leave the user)
  const walletDir = `$HOME/.bittensor/wallets/${walletName}`;
  push({
    title: "Wallet files present on the host",
    description: `${walletDir}/coldkey + hotkeys/${hotkeyName} — the engine never creates or transfers your keys.`,
    gate: "manual",
    commands: [
      `test -f "${walletDir}/coldkey" && test -f "${walletDir}/hotkeys/${hotkeyName}" && echo "wallet ${walletName}/${hotkeyName} found" || { echo "MISSING: copy your coldkey + hotkey into ${walletDir}/ on the host (scp from your local machine), then continue"; exit 1; }`,
    ],
  });

  // 8 — Launch miner (systemd, approval-gated: this starts burning compute)
  const unitLines = [
    "[Unit]",
    `Description=Infranex miner — subnet ${netuid} (${profile.subnetName})`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `User=root`,
    `WorkingDirectory=${root}/app`,
    `EnvironmentFile=${root}/env`,
    `ExecStart=${pythonBin} ${profile.entrypoint ?? "neurons/miner.py"} --netuid ${netuid} --subtensor.network finney --wallet.name ${walletName} --wallet.hotkey ${hotkeyName} --axon.port ${profile.ports.axon}`,
    "Restart=always",
    "RestartSec=10",
    "StandardOutput=append:/var/log/infranex-miner-sn" + netuid + ".log",
    "StandardError=append:/var/log/infranex-miner-sn" + netuid + ".log",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
  ];
  push({
    title: "Launch the miner (systemd service)",
    description: `Creates + starts ${unit}.service — auto-restarts on crash. This starts the real workload.`,
    gate: "approval",
    commands: [
      `mkdir -p ${root}/app /var/log && printf '%s\\n' ${unitLines
        .map((l) => `'${l.replace(/'/g, "'\\''")}'`)
        .join(" ")} > /etc/systemd/system/${unit}.service`,
      `systemctl daemon-reload && systemctl enable --now ${unit}`,
    ],
  });

  // 9 — Verify
  push({
    title: "Verify the miner is live",
    description: `systemctl is-active + axon port ${profile.ports.axon} listening + first log lines`,
    gate: "auto",
    commands: [
      `systemctl is-active ${unit} && ss -tlnp | grep ':${profile.ports.axon} ' ; tail -n 5 /var/log/infranex-miner-sn${netuid}.log 2>/dev/null`,
    ],
  });

  return steps;
}

// --- Executor ---------------------------------------------------------------

function okOut(s: string): boolean {
  return s.trim().length > 0;
}

/** Compatibility step 1: compare host facts to the profile. */
function runCompatibilityStep(step: InstallStep, profile: SubnetRequirementsProfile, facts: HostFacts | null): void {
  const problems: string[] = [];
  const notes: string[] = [];
  if (profile.minVramGb > 0) {
    if (!facts?.gpuName) problems.push("No GPU facts for this host — run the 10-step environment pipeline first.");
    else {
      const vramGb = facts.gpuVramMb ? facts.gpuVramMb / 1024 : null;
      // 1 GB tolerance: a "24 GB" RTX 4090 reports 24564 MiB usable (23.98).
      if (vramGb != null && vramGb < profile.minVramGb - 1)
        problems.push(`Host GPU has ${vramGb.toFixed(0)} GB VRAM; subnet needs ≥ ${profile.minVramGb} GB (${profile.recommendedGpu}).`);
      else notes.push(`GPU ${facts.gpuName}${vramGb ? ` (${vramGb.toFixed(0)} GB)` : ""} satisfies the ≥ ${profile.minVramGb} GB requirement.`);
    }
  }
  if (profile.cudaMinVersion) {
    if (!facts?.driverCuda) notes.push("Driver CUDA unknown — install step 8 of the pipeline will exercise it.");
    else {
      const [hmaj, hmin] = facts.driverCuda.split(".").map((x) => parseInt(x, 10) || 0);
      const [rmaj, rmin] = profile.cudaMinVersion.split(".").map((x) => parseInt(x, 10) || 0);
      if (hmaj < rmaj || (hmaj === rmaj && hmin < rmin))
        problems.push(`Driver CUDA ${facts.driverCuda} < subnet requirement ${profile.cudaMinVersion}.`);
      else notes.push(`Driver CUDA ${facts.driverCuda} ≥ required ${profile.cudaMinVersion}.`);
    }
  }
  notes.push(`Work type: ${profile.category ?? "unclassified"} · source: ${profile.gpuSource}`);
  if (problems.length > 0) {
    step.status = "fail";
    step.output = problems.join("\n");
    step.remediation = "Pick a host with enough VRAM/driver, or choose a different subnet.";
  } else {
    step.status = "pass";
    step.output = notes.join("\n");
  }
}

/**
 * Execute ONE install step. action "override" only applies to the manual
 * wallet gate (user confirms files are in place). Uses the LATEST install
 * job for the host.
 */
export async function runInstallStep(
  host: GpuHost,
  secret: string,
  stepId: string,
  action: "run" | "override" = "run"
): Promise<{ install: { id: string; status: string }; step: InstallStep }> {
  const row = await db.hostInstall.findFirst({
    where: { hostId: host.id },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) throw new Error("No install job staged for this host");
  if (row.status === "deployed") throw new Error("Install already deployed — stop it before re-running steps");

  const steps = JSON.parse(row.stepsJson) as InstallStep[];
  const profile = JSON.parse(row.requirementsJson) as SubnetRequirementsProfile;
  const step = steps.find((s) => s.id === stepId);
  if (!step) throw new Error("Step not found");
  // Passed steps may only be re-executed to relaunch a stopped job
  // (e.g. start the miner again after a safety stop).
  const relaunch = row.status === "stopped";
  if (step.status === "pass" && !relaunch) throw new Error("Step already passed");

  const started = Date.now();
  step.status = "running";
  step.output = "";
  await persistSteps(row.id, steps, "running");

  try {
    if (action === "override" && step.gate === "manual") {
      step.status = "pass";
      step.output = `Manual confirmation accepted — wallet files assumed present for ${row.walletName}/${row.hotkeyName}.`;
    } else if (step.virtual) {
      if (step.idx === 1) {
        const facts: HostFacts = host.hostInfo ? JSON.parse(host.hostInfo) : {};
        runCompatibilityStep(step, profile, facts);
      } else {
        step.status = "skipped";
        step.output = "Skipped — nothing to do for this subnet.";
      }
    } else {
      const { openTransport } = await import("./transport");
      const transport: Transport = openTransport({
        kind: host.transport === "mock" ? "mock" : "ssh",
        hostId: host.id,
        host: host.host,
        port: host.port,
        user: host.user,
        authMethod: host.authMethod as "password" | "key",
        secret,
      });
      try {
        await transport.connect();
        for (const cmd of step.commands) {
          step.output += `$ ${cmd}\n`;
          const timeout = cmd.includes("pip install") ? 900_000 : cmd.includes("apt-get install") ? 600_000 : 120_000;
          const r = await transport.exec(cmd, timeout);
          if (r.stdout.trim()) step.output += r.stdout.trim() + "\n";
          if (r.stderr.trim()) step.output += r.stderr.trim() + "\n";
          if (r.code !== 0) {
            step.status = "fail";
            step.remediation = failRemediation(step, r.code);
            break;
          }
        }
        if (step.status !== "fail") {
          step.status = "pass";
          if (okOut(step.output) === false) step.output = "done";
        }
      } finally {
        transport.close();
      }
    }
  } catch (e) {
    step.status = "fail";
    step.output += `\n[engine] ${e instanceof Error ? e.message : String(e)}`;
    step.remediation = "Transport error — check the host is reachable, then retry this step.";
  } finally {
    step.durationMs = Date.now() - started;
  }

  const overall = overallStatus(steps);
  await persistSteps(row.id, steps, overall);
  return { install: { id: row.id, status: overall }, step };
}

function failRemediation(step: InstallStep, code: number): string {
  if (step.title.startsWith("Install OS")) return "apt failed — check the distro sources and network on the host, then retry.";
  if (step.title.startsWith("Create Python")) return code === 1 ? "Python version mismatch — install the required python3.x (deadsnakes PPA) or edit the plan." : "python3-venv missing — the OS-packages step installs it; retry.";
  if (step.title.startsWith("Clone")) return "git clone failed — check the repo URL is public and the host has outbound network.";
  if (step.title.startsWith("Install the subnet")) return "pip failed — inspect the output; heavy CUDA wheels may need more RAM/disk, then retry.";
  if (step.title.startsWith("Wallet")) return "Copy your bittensor coldkey + hotkey files onto the host (scp ~/.bittensor/wallets/...), or confirm they are in place and continue.";
  if (step.title.startsWith("Launch")) return "Miner failed to start — the log tail in the verify step usually shows the reason (wallet, chain, ports).";
  if (step.title.startsWith("Verify")) return "Check the service log: journalctl -u <unit>. Common causes: wrong wallet path, port conflict, chain sync errors.";
  return "Retry this step after addressing the output above.";
}

function overallStatus(steps: InstallStep[]): string {
  if (steps.every((s) => s.status === "pass" || s.status === "skipped")) return "deployed";
  if (steps.some((s) => s.status === "fail")) return "failed";
  const nextPending = steps.find((s) => s.status === "pending" || s.status === "running");
  if (nextPending?.gate === "approval") return "waiting_approval";
  return "running";
}

async function persistSteps(id: string, steps: InstallStep[], status: string) {
  await db.hostInstall.update({
    where: { id },
    data: { stepsJson: JSON.stringify(steps), status },
  });
}

/** Stop the miner service (safety stop) and mark the install stopped. */
export async function stopInstall(
  host: GpuHost,
  secret: string
): Promise<{ ok: boolean; output: string }> {
  const row = await db.hostInstall.findFirst({
    where: { hostId: host.id },
    orderBy: { updatedAt: "desc" },
  });
  if (!row) throw new Error("No install job staged for this host");
  const netuid = row.netuid;
  const unit = UNIT_NAME(netuid);

  let output = "[engine] stop requested";
  if (host.transport !== "mock") {
    const { openTransport } = await import("./transport");
    const transport = openTransport({
      kind: "ssh",
      hostId: host.id,
      host: host.host,
      port: host.port,
      user: host.user,
      authMethod: host.authMethod as "password" | "key",
      secret,
    });
    try {
      await transport.connect();
      const r = await transport.exec(`systemctl disable --now ${unit} 2>&1 || true`, 30_000);
      output = r.stdout.trim() || "service stopped";
    } finally {
      transport.close();
    }
  } else {
    output = "[mock] infranex-miner service stopped";
  }
  await db.hostInstall.update({ where: { id: row.id }, data: { status: "stopped" } });
  return { ok: true, output };
}
