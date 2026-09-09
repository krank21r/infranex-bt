// ---------------------------------------------------------------------------
// DevOps Engine — Environment Inspector: the 10-step validation pipeline.
//
//   1 Connect to GPU        SSH handshake
//   2 Detect OS             distro / version / arch
//   3 Detect NVIDIA GPU     PCI probe + nvidia-smi (model, VRAM)
//   4 Validate Driver       driver version + its CUDA capability
//   5 Validate Docker       engine + compose
//   6 Validate Toolkit      nvidia-container-toolkit + Docker runtime
//   7 Validate CUDA         driver CUDA vs miner requirement (≥ 12.0)
//   8 Test GPU in Docker    docker run --gpus all … nvidia-smi
//   9 Install/Fix Missing   remediation dispatcher (one-click / auto-safe)
//  10 Configure Environment write /root/.infranex/env for the deployer
//
// Every step persists a HostCheck row (status/output/duration/remediation)
// so the wizard UI is a resumable checklist. Fixes re-run their step check
// and mark it "fixed" when the re-check passes.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { db } from "@/lib/db";
import type { GpuHost } from "@prisma/client";
import type { Transport, ExecResult } from "./transport";

export interface HostFacts {
  os?: string;
  osId?: string;
  arch?: string;
  gpuName?: string;
  gpuVramMb?: number;
  driverVersion?: string;
  driverCuda?: string;
  dockerVersion?: string;
  composeVersion?: string;
  toolkitVersion?: string;
  dockerNvidiaRuntime?: boolean;
  envFileWritten?: boolean;
}

export type CheckStatus =
  | "pending"
  | "running"
  | "pass"
  | "fail"
  | "fixed"
  | "skipped";

export interface StepResult {
  step: number;
  name: string;
  status: CheckStatus;
  output: string;
  remediation?: string | null;
  durationMs: number;
}

export interface ValidationSummary {
  runId: string;
  results: StepResult[];
  hostInfo: HostFacts;
  overall: "ready" | "needs_fix" | "failed";
  fixableSteps: number[];
}

// --- Commands (shared by real SSH hosts and the mock transport) ------------

const CMD_OS = "cat /etc/os-release 2>/dev/null; uname -m";
const CMD_GPU_PCI = "lspci 2>/dev/null | grep -i nvidia | head -3";
const CMD_GPU_INFO =
  "nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader 2>/dev/null";
const CMD_CUDA_VER =
  "nvidia-smi | sed -n 's/.*CUDA Version: \\([0-9.]*\\).*/\\1/p' | head -1";
const CMD_DOCKER = "docker --version";
const CMD_COMPOSE = "docker compose version";
const CMD_TOOLKIT = "nvidia-container-runtime --version 2>/dev/null | head -1";
const CMD_DOCKER_RUNTIME =
  "docker info 2>/dev/null | grep -i nvidia | head -2";
const CMD_GPU_DOCKER_TEST =
  "docker run --rm --gpus all nvidia/cuda:12.4.1-base-ubuntu22.04 nvidia-smi -L";
const MIN_CUDA_MAJOR = 12;

// --- Helpers ---------------------------------------------------------------

function ok(r: ExecResult): boolean {
  return r.code === 0 && r.stdout.trim().length > 0;
}

function firstLine(s: string): string {
  return s.trim().split("\n")[0] ?? "";
}

function parseOsRelease(stdout: string): { os?: string; osId?: string; arch?: string } {
  const pretty = stdout.match(/PRETTY_NAME="?([^"\n]+)"?/)?.[1];
  const id = stdout.match(/^ID="?([a-zA-Z0-9_-]+)"?/m)?.[1];
  const arch = stdout.trim().split("\n").filter((l) => !l.includes("="))[0];
  return { os: pretty, osId: id, arch: arch?.trim() || undefined };
}

const FIX_DOCKER_CMD = "curl -fsSL https://get.docker.com | sh";
const FIX_TOOLKIT_CMD =
  "curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg && " +
  "curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | " +
  "sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | " +
  "tee /etc/apt/sources.list.d/nvidia-container-toolkit.list && " +
  "apt-get update -qq && apt-get install -y -qq nvidia-container-toolkit && " +
  "nvidia-ctk runtime configure --runtime=docker && systemctl restart docker";

function writeEnvCommand(facts: HostFacts): string {
  const lines = [
    `INFRANEX_HOST_OS=${facts.os ?? "unknown"}`,
    `INFRANEX_GPU=${(facts.gpuName ?? "unknown").replace(/[^A-Za-z0-9 .-]/g, "")}`,
    `INFRANEX_GPU_VRAM_MB=${facts.gpuVramMb ?? 0}`,
    `INFRANEX_DRIVER=${facts.driverVersion ?? "unknown"}`,
    `INFRANEX_CUDA=${facts.driverCuda ?? "unknown"}`,
    `CUDA_VISIBLE_DEVICES=0`,
  ];
  return `mkdir -p /root/.infranex && printf '%s\\n' ${lines
    .map((l) => `'${l}'`)
    .join(" ")} > /root/.infranex/env && echo env-written`;
}

// --- Pipeline --------------------------------------------------------------

type StepDef = {
  step: number;
  name: string;
  /** Run the check; returns status + output + optional remediation. */
  run: (
    t: Transport,
    facts: HostFacts
  ) => Promise<Omit<StepResult, "step" | "name" | "durationMs">>;
  /** Apply the remediation, then the caller re-runs `run` to confirm. */
  fix?: (t: Transport, facts: HostFacts) => Promise<{ output: string }>;
  /** Whether the fix is safe to auto-apply when autoFixSafe is on. */
  safeAutoFix?: boolean;
};

export const PIPELINE: StepDef[] = [
  {
    step: 1,
    name: "Connect to GPU",
    run: async (t) => {
      try {
        await t.connect();
        const r = await t.exec("true", 10_000);
        return {
          status: "pass",
          output: `Handshake OK (${r.durationMs}ms RTT)`,
          remediation: null,
        };
      } catch (e) {
        return {
          status: "fail",
          output: e instanceof Error ? e.message : String(e),
          remediation:
            "Verify host/IP, port 22 reachable, user + credentials, and that the machine is online.",
        };
      }
    },
  },
  {
    step: 2,
    name: "Detect OS",
    run: async (t, facts) => {
      const r = await t.exec(CMD_OS, 15_000);
      if (!ok(r))
        return {
          status: "fail",
          output: r.stderr || "no response",
          remediation: "Ensure the host is a Linux machine with a readable /etc/os-release.",
        };
      const parsed = parseOsRelease(r.stdout);
      facts.os = parsed.os;
      facts.osId = parsed.osId;
      facts.arch = parsed.arch;
      return { status: "pass", output: `${parsed.os ?? "?"} · ${parsed.arch ?? "?"}`, remediation: null };
    },
  },
  {
    step: 3,
    name: "Detect NVIDIA GPU",
    run: async (t, facts) => {
      const pci = await t.exec(CMD_GPU_PCI, 15_000);
      const smi = await t.exec(CMD_GPU_INFO, 20_000);
      if (!ok(pci) && !ok(smi))
        return {
          status: "fail",
          output: pci.stdout || smi.stderr || "No NVIDIA hardware found",
          remediation:
            "No NVIDIA GPU detected. If a GPU is physically present, install the NVIDIA driver (lspci + nvidia-smi must work) — driver-level fixes require manual approval.",
        };
      const csv = firstLine(ok(smi) ? smi.stdout : "");
      const [name, mem] = csv.split(",").map((s) => s.trim());
      facts.gpuName = name || pci.stdout.split("\n")[0]?.split(":").slice(1).join(":").trim() || "NVIDIA GPU";
      const memMb = mem ? parseInt(mem.replace(/[^0-9]/g, ""), 10) : NaN;
      facts.gpuVramMb = Number.isFinite(memMb) ? memMb : undefined;
      return {
        status: "pass",
        output: `${facts.gpuName}${facts.gpuVramMb ? ` · ${facts.gpuVramMb} MiB` : ""}`,
        remediation: null,
      };
    },
  },
  {
    step: 4,
    name: "Validate NVIDIA Driver",
    run: async (t, facts) => {
      const r = await t.exec(CMD_GPU_INFO, 20_000);
      const cuda = await t.exec(CMD_CUDA_VER, 20_000);
      if (!ok(r))
        return {
          status: "fail",
          output: r.stderr || "nvidia-smi not available",
          remediation:
            "Install the NVIDIA driver matching the GPU (e.g. ubuntu-drivers autoinstall). Driver installs touch the kernel — always manual approval.",
        };
      const [name, mem, driver] = r.stdout.split(",").map((s) => s.trim());
      facts.gpuName = name || facts.gpuName;
      facts.driverVersion = driver || undefined;
      facts.driverCuda = ok(cuda) ? firstLine(cuda.stdout) : undefined;
      return {
        status: "pass",
        output: `Driver ${facts.driverVersion ?? "?"} · CUDA capability ${facts.driverCuda ?? "?"}`,
        remediation: null,
      };
    },
  },
  {
    step: 5,
    name: "Validate Docker",
    run: async (t, facts) => {
      const d = await t.exec(CMD_DOCKER, 15_000);
      if (!ok(d))
        return {
          status: "fail",
          output: d.stderr || "docker not found",
          remediation: "Install Docker Engine (official get.docker.com script).",
        };
      facts.dockerVersion = firstLine(d.stdout);
      const c = await t.exec(CMD_COMPOSE, 15_000);
      facts.composeVersion = ok(c) ? firstLine(c.stdout) : undefined;
      return {
        status: "pass",
        output: facts.composeVersion
          ? `${facts.dockerVersion} · ${facts.composeVersion}`
          : (facts.dockerVersion ?? ""),
        remediation: null,
      };
    },
    fix: async (t) => {
      const r = await t.exec(FIX_DOCKER_CMD, 300_000);
      if (r.code !== 0)
        throw new Error(r.stderr.split("\n").slice(-3).join(" ").slice(0, 300) || "docker install failed");
      return { output: firstLine(r.stdout) || "Docker Engine installed" };
    },
    safeAutoFix: true,
  },
  {
    step: 6,
    name: "Validate NVIDIA Container Toolkit",
    run: async (t, facts) => {
      const tk = await t.exec(CMD_TOOLKIT, 15_000);
      const rt = await t.exec(CMD_DOCKER_RUNTIME, 15_000);
      const runtimeOk = /nvidia/i.test(rt.stdout);
      if (!ok(tk) || !runtimeOk)
        return {
          status: "fail",
          output: ok(tk)
            ? `Toolkit present (${firstLine(tk.stdout)}) but Docker runtime not configured`
            : tk.stderr || "nvidia-container-toolkit not found",
          remediation:
            "Install nvidia-container-toolkit and register the runtime: nvidia-ctk runtime configure --runtime=docker && systemctl restart docker.",
        };
      facts.toolkitVersion = firstLine(tk.stdout);
      facts.dockerNvidiaRuntime = true;
      return { status: "pass", output: facts.toolkitVersion ?? "", remediation: null };
    },
    fix: async (t) => {
      const r = await t.exec(FIX_TOOLKIT_CMD, 300_000);
      if (r.code !== 0)
        throw new Error(r.stderr.split("\n").slice(-3).join(" ").slice(0, 300) || "toolkit install failed");
      return { output: "nvidia-container-toolkit installed + Docker runtime configured" };
    },
    safeAutoFix: true,
  },
  {
    step: 7,
    name: "Validate CUDA compatibility",
    run: async (_t, facts) => {
      const cuda = facts.driverCuda;
      if (!cuda)
        return {
          status: "fail",
          output: "Driver CUDA capability unknown (step 4 incomplete)",
          remediation: "Resolve the driver step first — CUDA compatibility is read from nvidia-smi.",
        };
      const major = parseInt(cuda.split(".")[0] ?? "0", 10);
      if (major < MIN_CUDA_MAJOR)
        return {
          status: "fail",
          output: `Driver CUDA ${cuda} < required ${MIN_CUDA_MAJOR}.0`,
          remediation: `Upgrade the NVIDIA driver to one supporting CUDA ${MIN_CUDA_MAJOR}.x+.`,
        };
      return {
        status: "pass",
        output: `Driver CUDA ${cuda} ≥ ${MIN_CUDA_MAJOR}.0 — compatible with current miner images`,
        remediation: null,
      };
    },
  },
  {
    step: 8,
    name: "Test GPU inside Docker",
    run: async (t) => {
      const r = await t.exec(CMD_GPU_DOCKER_TEST, 180_000);
      if (r.code !== 0)
        return {
          status: "fail",
          output:
            (r.stderr || r.stdout || "docker run failed").split("\n").slice(-4).join("\n"),
          remediation: "Ensure steps 5–6 pass (Docker + toolkit + nvidia runtime), then retry.",
        };
      return { status: "pass", output: firstLine(r.stdout) || "GPU visible in container", remediation: null };
    },
  },
  {
    // Dispatcher step: validation reports what is fixable; fixes run per-step.
    step: 9,
    name: "Install/Fix missing components",
    run: async (_t, facts) => {
      const missing: string[] = [];
      if (!facts.dockerVersion) missing.push("Docker (one-click fix available)");
      if (!facts.toolkitVersion || !facts.dockerNvidiaRuntime)
        missing.push("NVIDIA Container Toolkit (one-click fix available)");
      if (!facts.driverVersion) missing.push("NVIDIA driver (manual — kernel level)");
      if (missing.length === 0)
        return { status: "pass", output: "Nothing missing — all components validated", remediation: null };
      return {
        status: "fail",
        output: `Missing: ${missing.join(" · ")}`,
        remediation: "Use the Fix buttons on the failed steps above.",
      };
    },
  },
  {
    step: 10,
    name: "Configure environment",
    run: async (t, facts) => {
      const r = await t.exec(writeEnvCommand(facts), 20_000);
      if (r.code !== 0)
        return {
          status: "fail",
          output: r.stderr || "could not write /root/.infranex/env",
          remediation: "Check write access to /root (or adjust the deploy user).",
        };
      facts.envFileWritten = true;
      return {
        status: "pass",
        output: "/root/.infranex/env written (OS, GPU, driver, CUDA, device id) — host is deploy-ready",
        remediation: null,
      };
    },
  },
];

// --- Orchestration ---------------------------------------------------------

/** Run the full pipeline; persist one HostCheck row per step; update host status. */
export async function runValidation(host: GpuHost, secret: string): Promise<ValidationSummary> {
  const { openTransport } = await import("./transport");
  const transport = openTransport({
    kind: host.transport === "mock" ? "mock" : "ssh",
    hostId: host.id,
    host: host.host,
    port: host.port,
    user: host.user,
    authMethod: host.authMethod as "password" | "key",
    secret,
  });

  const runId = crypto.randomUUID();
  const facts: HostFacts = {};
  const results: StepResult[] = [];
  let connectionDead = false;

  try {
    for (const def of PIPELINE) {
      const started = Date.now();
      let result: StepResult;
      if (connectionDead) {
        result = { step: def.step, name: def.name, status: "skipped", output: "skipped — no connection", remediation: null, durationMs: 0 };
      } else {
        try {
          const r = await def.run(transport, facts);
          result = { step: def.step, name: def.name, durationMs: Date.now() - started, ...r };
          if (def.step === 1 && r.status === "fail") connectionDead = true;
        } catch (e) {
          result = {
            step: def.step,
            name: def.name,
            status: "fail",
            output: e instanceof Error ? e.message : String(e),
            remediation: "Unexpected error — inspect the host and retry.",
            durationMs: Date.now() - started,
          };
        }
      }
      results.push(result);
      await db.hostCheck.create({
        data: {
          hostId: host.id,
          runId,
          step: result.step,
          name: result.name,
          status: result.status,
          output: result.output.slice(0, 2000),
          remediation: result.remediation ?? null,
          durationMs: result.durationMs,
        },
      });
    }
  } finally {
    transport.close();
  }

  const overall: ValidationSummary["overall"] =
    results[0].status === "fail"
      ? "failed"
      : results.some((r) => r.status === "fail")
        ? "needs_fix"
        : "ready";

  await db.gpuHost.update({
    where: { id: host.id },
    data: { status: overall, hostInfo: JSON.stringify(facts) },
  });

  return {
    runId,
    results,
    hostInfo: facts,
    overall,
    fixableSteps: results
      .filter((r) => r.status === "fail" && PIPELINE.find((d) => d.step === r.step)?.fix)
      .map((r) => r.step),
  };
}

/** Apply the fix for one step, re-run that step's check, persist, update host. */
export async function applyStepFix(
  host: GpuHost,
  secret: string,
  step: number
): Promise<StepResult> {
  const def = PIPELINE.find((d) => d.step === step);
  if (!def?.fix) throw new Error(`Step ${step} has no automatic fix`);

  const { openTransport } = await import("./transport");
  const transport = openTransport({
    kind: host.transport === "mock" ? "mock" : "ssh",
    hostId: host.id,
    host: host.host,
    port: host.port,
    user: host.user,
    authMethod: host.authMethod as "password" | "key",
    secret,
  });

  const facts: HostFacts = host.hostInfo ? safeParse(host.hostInfo) : {};
  const started = Date.now();
  let result: StepResult;
  try {
    try {
      await def.fix(transport, facts);
    } catch (e) {
      result = {
        step,
        name: def.name,
        status: "fail",
        output: `Fix failed: ${e instanceof Error ? e.message : String(e)}`,
        remediation: "Try again or fix manually; see output for the installer error.",
        durationMs: Date.now() - started,
      };
      await persist(host.id, result);
      return result;
    }
    // Re-run the step's check to confirm the fix
    const re = await def.run(transport, facts);
    result = {
      step,
      name: def.name,
      status: re.status === "pass" ? "fixed" : "fail",
      output: `Fix applied → ${re.output}`,
      remediation: re.remediation ?? null,
      durationMs: Date.now() - started,
    };
    await persist(host.id, result);

    // Refresh overall status: still failing steps → needs_fix, else ready
    if (result.status === "fixed") {
      const remaining = await db.hostCheck.findMany({
        where: { hostId: host.id },
        orderBy: { createdAt: "desc" },
        take: 10,
      });
      const latestPerStep = new Map<number, string>();
      for (const c of remaining) {
        if (!latestPerStep.has(c.step)) latestPerStep.set(c.step, c.status);
      }
      const stillFailing = [...latestPerStep.entries()].filter(
        ([s, st]) => st !== "pass" && st !== "fixed" && s !== 9
      );
      // Re-run step 9 dispatcher outcome text by patching if clean
      const allGood = stillFailing.length === 0;
      await db.gpuHost.update({
        where: { id: host.id },
        data: {
          status: allGood ? "ready" : "needs_fix",
          hostInfo: JSON.stringify(facts),
        },
      });
    }
    return result;
  } finally {
    transport.close();
  }
}

async function persist(hostId: string, r: StepResult) {
  await db.hostCheck.create({
    data: {
      hostId,
      runId: crypto.randomUUID(),
      step: r.step,
      name: r.name,
      status: r.status,
      output: r.output.slice(0, 2000),
      remediation: r.remediation ?? null,
      durationMs: r.durationMs,
    },
  });
}

function safeParse(json: string): HostFacts {
  try {
    return JSON.parse(json) as HostFacts;
  } catch {
    return {};
  }
}
