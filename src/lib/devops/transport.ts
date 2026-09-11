// ---------------------------------------------------------------------------
// DevOps Engine — command transport.
//
// The control plane (this Next.js server) reaches GPU machines through a
// Transport. Two implementations:
//
//   SshTransport  — real machines (BYO box, colo rig, RunPod pod, Vast…)
//                   via the ssh2 library. Every command has a timeout.
//   MockTransport — a simulated Ubuntu + RTX 4090 host with a scripted
//                   state: docker + toolkit MISSING on first inspect, and
//                   the fix commands actually "install" them so the full
//                   validate → fix → re-validate → READY loop is demoable
//                   with zero hardware and zero risk.
// ---------------------------------------------------------------------------

import type { Client } from "ssh2";

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface Transport {
  readonly kind: "ssh" | "mock";
  connect(): Promise<void>;
  exec(command: string, timeoutMs?: number): Promise<ExecResult>;
  close(): void;
}

// ---------------------------------------------------------------------------
// SSH transport
// ---------------------------------------------------------------------------

interface SshCreds {
  host: string;
  port: number;
  user: string;
  authMethod: "password" | "key";
  secret: string; // decrypted password or PEM key
}

export class SshTransport implements Transport {
  readonly kind = "ssh" as const;
  private client: Client | null = null;

  constructor(private creds: SshCreds) {}

  async connect(): Promise<void> {
    const { Client: SshClient } = await import("ssh2");
    const creds = this.creds;
    return new Promise((resolve, reject) => {
      const c = new SshClient();
      this.client = c;
      const timer = setTimeout(
        () => {
          c.end();
          reject(new Error(`SSH connect timeout to ${creds.host}:${creds.port}`));
        },
        15_000
      );
      c.on("ready", () => {
        clearTimeout(timer);
        resolve();
      })
        .on("error", (err: Error) => {
          clearTimeout(timer);
          reject(new Error(`SSH ${creds.host}:${creds.port} — ${err.message}`));
        })
        .connect({
          host: creds.host,
          port: creds.port,
          username: creds.user,
          readyTimeout: 15_000,
          ...(creds.authMethod === "password"
            ? { password: creds.secret }
            : { privateKey: creds.secret }),
        });
    });
  }

  async exec(command: string, timeoutMs = 30_000): Promise<ExecResult> {
    if (!this.client) throw new Error("SSH not connected");
    const c = this.client;
    const started = Date.now();
    return new Promise<ExecResult>((resolve, reject) => {
      c.exec(command, (err, stream) => {
        if (err) return reject(err);
        let stdout = "";
        let stderr = "";
        const timer = setTimeout(() => {
          stream.close();
          resolve({
            code: -1,
            stdout,
            stderr: `${stderr}\n[timeout after ${timeoutMs}ms]`.trim(),
            durationMs: Date.now() - started,
          });
        }, timeoutMs);
        stream
          .on("close", (code: number) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr, durationMs: Date.now() - started });
          })
          .on("data", (d: Buffer) => {
            stdout += d.toString();
          })
          .stderr.on("data", (d: Buffer) => {
            stderr += d.toString();
          });
      });
    });
  }

  close(): void {
    this.client?.end();
    this.client = null;
  }
}

// ---------------------------------------------------------------------------
// Mock transport — scripted demo host
// ---------------------------------------------------------------------------

/**
 * Simulated host state. On first contact docker + nvidia-container-toolkit
 * are missing (steps 5/6 fail) — running the FIX commands flips the state so
 * re-validation passes, exactly like a real remediation loop.
 *
 * State lives on globalThis: Next.js bundles server modules per route, so
 * module-level Maps would reset between the /validate and /fix routes.
 */
const mockState: Map<string, MockHostState> =
  ((globalThis as Record<string, unknown>).__infranexMockState as Map<string, MockHostState>) ??
  new Map<string, MockHostState>();
(globalThis as Record<string, unknown>).__infranexMockState = mockState;

interface MockHostState {
  connected: boolean;
  dockerInstalled: boolean;
  toolkitInstalled: boolean;
  gpuPresent: boolean;
  // requirement-installer state (subnet deployment simulation)
  aptInstalled: boolean;
  venvCreated: boolean;
  repoCloned: boolean;
  depsInstalled: boolean;
  dockerImageBuilt: boolean;
  minerEnvWritten: boolean;
  walletReady: boolean;
  minerRunning: boolean;
  key: string;
}

function getState(key: string): MockHostState {
  let s = mockState.get(key);
  if (!s) {
    s = {
      connected: false,
      dockerInstalled: false,
      toolkitInstalled: false,
      gpuPresent: true,
      aptInstalled: false,
      venvCreated: false,
      repoCloned: false,
      depsInstalled: false,
      dockerImageBuilt: false,
      minerEnvWritten: false,
      walletReady: false,
      minerRunning: false,
      key,
    };
    mockState.set(key, s);
  }
  return s;
}

export class MockTransport implements Transport {
  readonly kind = "mock" as const;

  constructor(
    private hostId: string,
    private opts?: { noGpu?: boolean; slowFirstConnectMs?: number }
  ) {}

  private get state(): MockHostState {
    return getState(this.hostId);
  }

  async connect(): Promise<void> {
    await new Promise((r) => setTimeout(r, 250));
    this.state.connected = true;
  }

  async exec(command: string, _timeoutMs = 30_000): Promise<ExecResult> {
    const started = Date.now();
    await new Promise((r) => setTimeout(r, 120)); // simulate latency
    const s = this.state;
    const out = (stdout = "", stderr = "", code = 0): ExecResult => ({
      code,
      stdout,
      stderr,
      durationMs: Date.now() - started,
    });

    // Connection / OS
    if (command.includes("/etc/os-release"))
      return out(
        'PRETTY_NAME="Ubuntu 22.04.5 LTS"\nVERSION_ID="22.04"\nID=ubuntu\nID_LIKE=debian\n'
      );
    if (command.startsWith("uname -m") || command === "uname")
      return out("x86_64\n");

    // GPU detection
    if (command.includes("lspci")) {
      if (!s.gpuPresent) return out("", "", 1);
      return out(
        "01:00.0 VGA compatible controller: NVIDIA Corporation AD102 [RTX 4090] (rev a1)\n"
      );
    }
    // nvidia-smi --query-gpu CSV (must come before the banner branch)
    if (command.includes("--query-gpu=name,memory.total,driver_version")) {
      if (!s.gpuPresent) return out("", "NVIDIA-SMI has failed", 1);
      return out("NVIDIA GeForce RTX 4090, 24564 MiB, 550.90.07\n");
    }
    // CUDA version extraction via sed
    if (command.includes("CUDA Version:")) {
      if (!s.gpuPresent) return out("", "failed", 1);
      return out("12.4\n");
    }
    if (command.startsWith("nvidia-smi")) {
      if (!s.gpuPresent) return out("", "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver", 1);
      return out(
        [
          "+-----------------------------------------------------------------------------+",
          "| NVIDIA-SMI 550.90.07    Driver Version: 550.90.07    CUDA Version: 12.4    |",
          "|-------------------------------+----------------------+----------------------+",
          "|   0  NVIDIA RTX 4090    On-Del | 00000000:01:00.0  Off |                  Off |",
          "| 30%   45C    P8              24W / 450W  |  2450MiB / 24564MiB  |      0%      Default |",
          "+-----------------------------------------------------------------------------+",
        ].join("\n") + "\n"
      );
    }

    // Docker
    if (command === "docker --version") {
      if (!s.dockerInstalled) return out("", "/bin/sh: docker: command not found", 127);
      return out("Docker version 27.1.1, build 631a909\n");
    }
    if (command === "docker compose version") {
      if (!s.dockerInstalled) return out("", "/bin/sh: docker: command not found", 127);
      return out("Docker Compose version v2.29.1\n");
    }
    if (command.startsWith("install-docker") || command.includes("get.docker.com")) {
      s.dockerInstalled = true;
      return out("[mock] docker-ce 27.1.1 installed successfully\n");
    }

    // NVIDIA container toolkit — the INSTALL branch must come first: the
    // installer command itself contains "nvidia-ctk" and the repo URLs.
    if (
      command.startsWith("install-nvidia-toolkit") ||
      command.includes("libnvidia-container") ||
      command.includes("nvidia-container-toolkit.list")
    ) {
      s.toolkitInstalled = true;
      return out("[mock] nvidia-container-toolkit 3.14.0 installed + runtime configured\n");
    }
    if (
      command.includes("nvidia-container-runtime") &&
      command.includes("--version") &&
      !command.includes("apt-get")
    ) {
      if (!s.toolkitInstalled) return out("", "command not found", 127);
      return out("nvidia-container-runtime version 3.14.0\n");
    }
    if (command.includes("nvidia-ctk")) {
      if (!s.toolkitInstalled) return out("", "command not found", 127);
      return out("nvidia-ctk version v1.17.0\n");
    }
    if (command.includes("docker info") && command.includes("nvidia")) {
      if (!s.dockerInstalled || !s.toolkitInstalled)
        return out("Runtimes: runc\n", "", 0);
      return out("Runtimes: nvidia runc\n");
    }

    // CUDA compat probe (driver version already implies 12.4)
    if (command.startsWith("cuda-compat-check")) return out("driver-cuda=12.4\n");

    // GPU test inside docker
    if (command.startsWith("docker run --rm --gpus all")) {
      if (!s.dockerInstalled || !s.toolkitInstalled)
        return out("", "docker: Error — could not select device driver \"nvidia\"", 127);
      return out(
        "Mon Sep 10 12:00:00 2026\n+-----------------------------------------------------------------------------+\n| NVIDIA-SMI 550.90.07    Driver Version: 550.90.07    CUDA Version: 12.4    |\n|   0  NVIDIA RTX 4090    ...                                                |\n+-----------------------------------------------------------------------------+\n"
      );
    }

    // --- Requirement installer — Docker path (repo ships a Dockerfile) ---
    if (command.includes("docker build") && command.includes("/opt/infranex/")) {
      if (!s.repoCloned) return out("", "No such file or directory — clone the repo first", 1);
      s.dockerImageBuilt = true;
      return out(
        "[+] Building 3.4s (11/11) FINALLY DONE\n => [internal] load build definition from Dockerfile\n => [4/5] RUN pip install -r requirements.txt\n => exporting layers\n => naming to docker.io/infranex/sn90:miner\n"
      );
    }
    // The installer's LAUNCH is a single chained command:
    //   docker rm -f <unit> 2>/dev/null || true; docker run -d … --name <unit> …
    // Handle it BEFORE the plain rm branch (the rm inside it is not a stop).
    if (
      command.includes("docker rm -f") &&
      command.includes("docker run -d") &&
      command.includes("infranex-miner")
    ) {
      if (!s.dockerImageBuilt)
        return out("", "Unable to find image 'infranex/sn90:miner' locally — build it first", 125);
      if (!s.dockerInstalled || !s.toolkitInstalled)
        return out("", "docker: Error — could not select device driver \"nvidia\"", 127);
      s.minerRunning = true;
      return out("a1b2c3d4e5f6ac1df39c1b47c8e00b1a61916ecb1a4c10f2fbe2f7db90e6bc11\n");
    }
    if (command.includes("docker rm -f") && command.includes("infranex-miner")) {
      const wasRunning = s.minerRunning;
      s.minerRunning = false;
      return out(wasRunning ? "[mock] container removed\n" : "");
    }
    if (command.startsWith("docker run -d") && command.includes("infranex-miner")) {
      if (!s.dockerImageBuilt)
        return out("", "Unable to find image 'infranex/sn90:miner' locally — build it first", 125);
      if (!s.dockerInstalled || !s.toolkitInstalled)
        return out("", "docker: Error — could not select device driver \"nvidia\"", 127);
      s.minerRunning = true;
      return out("a1b2c3d4e5f6ac1df39c1b47c8e00b1a61916ecb1a4c10f2fbe2f7db90e6bc11\n");
    }
    if (command.includes("docker ps") && command.includes("infranex-miner")) {
      if (!s.minerRunning) return out("");
      return out("infranex-miner-sn90 | Up 12 seconds\n");
    }
    if (command.includes("docker logs") && command.includes("infranex-miner")) {
      if (!s.minerRunning) return out("", "Error: no such container", 1);
      return out(
        "2026-09-11 12:00:01 | Loaded wallet default/miner — connecting to finney…\n2026-09-11 12:00:04 | Axon serving on 0.0.0.0:8091\n2026-09-11 12:00:06 | Syncing chain head 9,213,442\n"
      );
    }

    // Environment config
    if (command.startsWith("write-env")) return out("[mock] /root/.infranex/env written\n");
    if (command.includes("mkdir -p /root/.infranex") && command.includes("printf"))
      return out("[mock] /root/.infranex/env written\n");
    if (command.startsWith("mkdir -p /root/.infranex")) return out("");

    // ------------------------------------------------------------------
    // Requirement Installer simulation (subnet deployment on the mock host)
    // ------------------------------------------------------------------

    // 2 — OS packages
    if (command.includes("apt-get install")) {
      const pkgs = command.split("apt-get install -y -qq ")[1]?.trim() ?? "";
      s.aptInstalled = true;
      return out(`[mock] Reading package lists... Done\n[mock] The following NEW packages will be installed:\n  ${pkgs.replace(/ /g, ", ")}\n[mock] Setting up ${pkgs.split(" ").length} packages... Done\n`);
    }
    if (command === "python3 --version") return out("Python 3.10.12\n");

    // 3 — venv (the plan chains a version grep + mkdir + venv + pip --version)
    if (command.includes("python3 -m venv") && command.includes("/opt/infranex/")) {
      s.venvCreated = true;
      return out("pip 24.0 from /opt/infranex/.../venv/lib/python3.10/site-packages/pip (python 3.10)\n");
    }
    if (command.includes("/venv/bin/pip --version")) {
      if (!s.venvCreated) return out("", "No such file or directory", 127);
      return out("pip 24.0 from /opt/infranex/.../venv/lib/python3.10/site-packages/pip (python 3.10)\n");
    }

    // 4 — repo clone
    if (command.includes("git clone") && command.includes("/opt/infranex/")) {
      s.repoCloned = true;
      return out(`Cloning into '/opt/infranex/.../app'...\nremote: Enumerating objects: 128, done.\nReceiving objects: 100% (128/128), done.\n`);
    }

    // 5 — pip dependencies
    if (command.includes("pip3 install") && command.includes("uv")) {
      return out("[mock] Installed 1 package: uv\n");
    }
    if (command.includes("uv sync")) {
      if (!s.repoCloned) return out("", "No such file or directory", 127);
      s.venvCreated = true;
      s.depsInstalled = true;
      return out(
        "Resolved 42 packages in 3.2s\nInstalled 42 packages in 18.9s\n + bittensor==9.10.1\n + torch==2.5.1\n + …\n"
      );
    }
    if (command.includes("pip install") && command.includes("/opt/infranex/")) {
      if (!s.venvCreated) return out("", "No such file or directory", 127);
      s.depsInstalled = true;
      return out(
        "Looking in indexes: https://pypi.org/simple\nSuccessfully installed bittensor-9.10.1 async-substrate-interface-1.3.2 torch-2.5.1 rich-13.9.4 …\n"
      );
    }

    // 6 — miner env file (printf … > /opt/infranex/snX/env, contains BT_NETUID)
    if (command.includes("/opt/infranex/") && command.includes("printf") && command.includes("BT_NETUID")) {
      s.minerEnvWritten = true;
      return out("BT_NETWORK=finney\nBT_NETUID=…\nBT_WALLET_NAME=…\nBT_HOTKEY_NAME=…\nCUDA_VISIBLE_DEVICES=0\n");
    }

    // 7 — wallet files check
    if (command.includes(".bittensor/wallets") && command.includes("test -f")) {
      if (!s.walletReady)
        return out(
          "MISSING: copy your coldkey + hotkey into $HOME/.bittensor/wallets/<wallet>/ on the host (scp from your local machine), then continue\n",
          "",
          1
        );
      return out("wallet default/miner found\n");
    }

    // 8 — systemd unit write + launch
    if (command.includes("/etc/systemd/system/infranex-miner") && command.includes("printf"))
      return out("[mock] unit file written\n");
    if (command.includes("systemctl enable --now infranex-miner")) {
      s.minerRunning = true;
      return out("Synchronizing state of infranex-miner-sn64.service\nCreated symlink /etc/systemd/system/multi-user.target.wants/infranex-miner-sn64.service → /etc/systemd/system/infranex-miner-sn64.service.\n");
    }
    // Post-registration restart (Phase 2) — the miner re-announces its axon.
    if (command.includes("systemctl restart infranex-miner")) {
      s.minerRunning = true;
      return out("(mock) systemd unit restarted — axon re-announced for the registered UID\n");
    }
    if (command.includes("docker restart") && command.includes("infranex-miner")) {
      if (!s.dockerImageBuilt || !s.minerRunning)
        return out("", "Error response from daemon: No such container", 1);
      return out("a1b2c3d4e5f6ac1df39c1b47c8e00b1a61916ecb1a4c10f2fbe2f7db90e6bc11\n");
    }

    // 9 — verify (combined is-active + port + tail) or pieces
    if (command.includes("systemctl is-active infranex-miner")) {
      if (!s.minerRunning) return out("inactive\n", "", 3);
      const logTail =
        "2026-09-10 12:00:01 | Loaded wallet default/miner — connecting to finney…\n2026-09-10 12:00:04 | Axon serving on 0.0.0.0:8091\n2026-09-10 12:00:06 | Syncing chain head 9,213,442\n";
      if (command.includes("ss -tlnp"))
        return out(
          `active\nLISTEN 0 4096 0.0.0.0:8091 0.0.0.0:* users:(("python",pid=18411,fd=19))\n${logTail}`
        );
      return out("active\n");
    }
    if (command.includes("tail -n 5 /var/log/infranex-miner"))
      return out("2026-09-10 12:00:04 | Axon serving on 0.0.0.0:8091\n");
    if (command.includes("systemctl disable --now infranex-miner")) {
      s.minerRunning = false;
      return out("Removed /etc/systemd/system/multi-user.target.wants/infranex-miner-sn64.service.\n");
    }

    return out(`[mock] unrecognised command: ${command}\n`);
  }

  close(): void {
    this.state.connected = false;
  }
}

/** Open the right transport for a host record. */
export function openTransport(opts: {
  kind: "ssh" | "mock";
  hostId: string;
  host?: string;
  port?: number;
  user?: string;
  authMethod?: "password" | "key";
  secret?: string; // already decrypted
}): Transport {
  if (opts.kind === "mock") return new MockTransport(opts.hostId);
  return new SshTransport({
    host: opts.host ?? "",
    port: opts.port ?? 22,
    user: opts.user ?? "root",
    authMethod: opts.authMethod ?? "password",
    secret: opts.secret ?? "",
  });
}
