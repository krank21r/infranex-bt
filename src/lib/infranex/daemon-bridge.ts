import crypto from "crypto";
import { db } from "@/lib/db";
import { encryptSecret, decryptSecret } from "@/lib/devops/crypto";

/**
 * Node Daemon bridge — the control-plane side of the tiny agent installed
 * on each GPU host.
 *
 * Security model:
 *   - Every deployment gets a random 32-byte daemon secret (shown ONCE in
 *     the install script, stored AES-256-GCM encrypted).
 *   - Telemetry POSTs and command polls are HMAC-SHA256 signed
 *     (secret over `timestamp + "." + rawBody`); replays beyond ±5 min and
 *     signatures that don't verify are rejected.
 *   - Commands are APPROVED via the Trigger Engine; the daemon only ever
 *     pulls its own queue — we never push into the host.
 *
 * Container-safe launchers: inside a container there is no systemd, and PM2
 * may be missing — the installer detects the environment and falls back
 * systemd → PM2 → bash watchdog.
 */

// ---------------------------------------------------------------------------
// Secrets + HMAC
// ---------------------------------------------------------------------------

export function generateDaemonSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hmacSign(secret: string, timestamp: string, body: string): string {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

export function verifyHmac(
  secret: string,
  timestamp: string,
  body: string,
  signature: string
): { ok: boolean; error?: string } {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, error: "bad timestamp" };
  const skew = Math.abs(Date.now() - ts);
  if (skew > 5 * 60_000) return { ok: false, error: "timestamp outside ±5min window" };
  const expected = hmacSign(secret, timestamp, body);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature ?? "", "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: "signature mismatch" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Daemon registration + lookup
// ---------------------------------------------------------------------------

export async function ensureDaemon(deploymentId: string): Promise<{
  id: string;
  secret: string;
  created: boolean;
}> {
  const existing = await db.daemonState.findUnique({ where: { deploymentId } });
  if (existing) {
    return { id: existing.id, secret: decryptSecret(existing.secretEnc), created: false };
  }
  const secret = generateDaemonSecret();
  const row = await db.daemonState.create({
    data: { deploymentId, secretEnc: encryptSecret(secret), status: "pending" },
  });
  return { id: row.id, secret, created: true };
}

export async function getDaemonForRequest(
  deploymentId: string,
  timestamp: string,
  body: string,
  signature: string
): Promise<{ ok: boolean; error?: string; daemonId?: string }> {
  const row = await db.daemonState.findUnique({ where: { deploymentId } });
  if (!row) return { ok: false, error: "daemon not registered" };
  const secret = decryptSecret(row.secretEnc);
  const v = verifyHmac(secret, timestamp, body, signature);
  if (!v.ok) return v;
  return { ok: true, daemonId: row.id };
}

// ---------------------------------------------------------------------------
// Command queue (daemon pulls; only approved actions enqueue)
// ---------------------------------------------------------------------------

interface DaemonCommand {
  id: string;
  command: "restart_miner" | "status_probe";
  args?: Record<string, unknown>;
  createdAt: string;
  deliveredAt?: string;
  result?: string;
}

export async function enqueueCommand(
  deploymentId: string,
  command: DaemonCommand["command"],
  args?: Record<string, unknown>
): Promise<void> {
  const row = await db.daemonState.findUnique({ where: { deploymentId } });
  if (!row) throw new Error("daemon not registered");
  const cmds = safeCommands(row.commandsJson);
  cmds.push({
    id: crypto.randomUUID(),
    command,
    args,
    createdAt: new Date().toISOString(),
  });
  await db.daemonState.update({
    where: { deploymentId },
    data: { commandsJson: JSON.stringify(cmds.slice(-20)) },
  });
}

export async function pullCommands(
  deploymentId: string
): Promise<DaemonCommand[]> {
  const row = await db.daemonState.findUnique({ where: { deploymentId } });
  if (!row) return [];
  const cmds = safeCommands(row.commandsJson);
  const undelivered = cmds.filter((c) => !c.deliveredAt);
  const now = new Date().toISOString();
  const stamped = cmds.map((c) => (c.deliveredAt ? c : { ...c, deliveredAt: now }));
  await db.daemonState.update({
    where: { deploymentId },
    data: { commandsJson: JSON.stringify(stamped.slice(-20)), lastSeenAt: new Date(), status: "online" },
  });
  return undelivered;
}

export async function recordCommandResult(
  deploymentId: string,
  commandId: string,
  result: string
): Promise<void> {
  const row = await db.daemonState.findUnique({ where: { deploymentId } });
  if (!row) return;
  const cmds = safeCommands(row.commandsJson).map((c) =>
    c.id === commandId ? { ...c, result } : c
  );
  await db.daemonState.update({
    where: { deploymentId },
    data: { commandsJson: JSON.stringify(cmds.slice(-20)) },
  });
}

export async function recordTelemetry(
  deploymentId: string,
  telemetry: Record<string, unknown>
): Promise<void> {
  await db.daemonState.update({
    where: { deploymentId },
    data: {
      telemetryJson: JSON.stringify(telemetry),
      lastSeenAt: new Date(),
      status: "online",
    },
  });
}

export async function getDaemonView(deploymentId: string) {
  const row = await db.daemonState.findUnique({ where: { deploymentId } });
  if (!row) return null;
  const unreachable =
    row.lastSeenAt !== null && Date.now() - row.lastSeenAt.getTime() > 10 * 60_000;
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    status: unreachable ? "unreachable" : row.status,
    version: row.version,
    telemetry: row.telemetryJson ? safeParse(row.telemetryJson) : null,
    pendingCommands: safeCommands(row.commandsJson).filter((c) => !c.deliveredAt).length,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  };
}

function safeCommands(s: string): DaemonCommand[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function safeParse(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// The daemon itself — a small Python script (stdlib only) generated per
// deployment. HMAC-signed telemetry + command polling, zero dependencies.
// ---------------------------------------------------------------------------

export function buildDaemonScript(opts: {
  deploymentId: string;
  secret: string;
  platformUrl: string;
  minerCommand: string;
  minerDir?: string;
}): string {
  const { deploymentId, secret, platformUrl, minerCommand } = opts;
  return `#!/usr/bin/env python3
"""Infranex Node Daemon v1 — telemetry + command pull agent.

Zero dependencies (Python 3.8+ stdlib only). HMAC-SHA256 signed.
Every command was approved by a human through the Trigger Engine.
"""
import hashlib, hmac, json, os, subprocess, sys, time, urllib.request

DEPLOYMENT_ID = "${deploymentId}"
SECRET = "${secret}"
PLATFORM = "${platformUrl}"
MINER_CMD = ${JSON.stringify(minerCommand)}
INTERVAL = 60

def sign(ts, body):
    return hmac.new(SECRET.encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()

def post(path, payload):
    body = json.dumps(payload)
    ts = str(int(time.time() * 1000))
    req = urllib.request.Request(
        PLATFORM + path,
        data=body.encode(),
        headers={
            "Content-Type": "application/json",
            "X-Infranex-Timestamp": ts,
            "X-Infranex-Signature": sign(ts, body),
            "X-Infranex-Deployment": DEPLOYMENT_ID,
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode() or "{}")

def gpu_stats():
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10)
        gpus = []
        for line in out.stdout.strip().splitlines():
            p = [x.strip() for x in line.split(",")]
            if len(p) == 4:
                gpus.append({"utilPct": float(p[0]), "memUsedMb": float(p[1]),
                             "memTotalMb": float(p[2]), "tempC": float(p[3])})
        return gpus
    except Exception:
        return []

def process_alive():
    try:
        out = subprocess.run(["pgrep", "-f", ${JSON.stringify(minerCommand.split(" ")[0] + " " + (minerCommand.split(" ")[1] ?? ""))}],
                             capture_output=True, text=True, timeout=5)
        return out.returncode == 0
    except Exception:
        return None

def telemetry():
    return {
        "ts": int(time.time()),
        "hostname": os.uname().nodename,
        "uptimeS": int(time.time() - os.stat("/proc/1").st_ctime),
        "gpus": gpu_stats(),
        "minerProcessAlive": process_alive(),
        "loadavg": [round(x, 2) for x in os.getloadavg()],
    }

def restart_miner():
    # Container-safe restart: try systemctl, then pm2, then plain pkill+relaunch.
    for cmd in (
        ["systemctl", "restart", "infranex-miner"],
        ["pm2", "restart", "infranex-miner"],
    ):
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
            if r.returncode == 0:
                return f"restarted via {cmd[0]}"
        except Exception:
            continue
    subprocess.run(["pkill", "-f", ${JSON.stringify(minerCommand.split(" ")[0])}], capture_output=True)
    subprocess.Popen(MINER_CMD, shell=True, cwd="${opts.minerDir ?? "/root"}",
                     stdout=open("/var/log/infranex-miner.log", "ab"), stderr=subprocess.STDOUT)
    return "restarted via pkill+relaunch"

def main():
    print(f"[infranex-daemon] up — deployment {DEPLOYMENT_ID}", flush=True)
    while True:
        try:
            post("/api/daemon/telemetry", telemetry())
            resp = post("/api/daemon/commands", {"pull": True})
            for cmd in resp.get("commands", []):
                name = cmd.get("command")
                if name == "restart_miner":
                    result = restart_miner()
                elif name == "status_probe":
                    result = json.dumps(telemetry())
                else:
                    result = f"unknown command {name}"
                post("/api/daemon/commands", {"result": {"id": cmd.get("id"), "result": result}})
        except Exception as e:
            print(f"[infranex-daemon] loop error: {e}", flush=True)
        time.sleep(INTERVAL)

if __name__ == "__main__":
    main()
`;
}

// ---------------------------------------------------------------------------
// Container-safe launchers — install scripts per environment
// ---------------------------------------------------------------------------

export function buildLauncherScript(opts: {
  minerCommand: string;
  workDir: string;
}): { flavor: "systemd" | "pm2" | "watchdog"; script: string } {
  return {
    flavor: "systemd",
    script: `#!/usr/bin/env bash
# Infranex container-safe miner launcher — systemd → PM2 → bash watchdog.
set -u
MINER_CMD=${JSON.stringify(opts.minerCommand)}
WORK_DIR=${JSON.stringify(opts.workDir)}
cd "$WORK_DIR"

if [ -d /run/systemd/system ]; then
  cat > /etc/systemd/system/infranex-miner.service <<UNIT
[Unit]
Description=Infranex managed miner
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$WORK_DIR
ExecStart=$MINER_CMD
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
  systemctl enable --now infranex-miner
  echo "launcher=systemd"
elif command -v pm2 >/dev/null 2>&1; then
  pm2 delete infranex-miner >/dev/null 2>&1 || true
  pm2 start "$MINER_CMD" --name infranex-miner --cwd "$WORK_DIR"
  echo "launcher=pm2"
else
  nohup bash -c 'while true; do '"$MINER_CMD"'; echo "[watchdog] exited rc=$? — restarting in 10s" >&2; sleep 10; done' \\
    >> /var/log/infranex-miner.log 2>&1 &
  echo $! > /var/run/infranex-miner.pid
  echo "launcher=watchdog"
fi
`,
  };
}

// ---------------------------------------------------------------------------
// Bridge — used by the Trigger Engine's approved actions
// ---------------------------------------------------------------------------

/** Restart the miner behind a deployment via its daemon (if reachable). */
export async function restartViaDaemon(deploymentId: string): Promise<string> {
  const view = await getDaemonView(deploymentId);
  if (!view) {
    throw new Error("No daemon installed for this deployment");
  }
  if (view.status === "unreachable") {
    throw new Error("Daemon unreachable (no telemetry for 10+ minutes)");
  }
  await enqueueCommand(deploymentId, "restart_miner");
  return `restart_miner queued — daemon (${view.status}) will pick it up within 60s`;
}
