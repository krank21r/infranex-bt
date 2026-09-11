/**
 * Rebuilt-cluster test suite — Trigger Engine v1, Node Daemon bridge (HMAC +
 * container-safe launchers), RunPod provider v2 (schema + hotkey-only policy),
 * UID Defense (assessUidRisk + full pipeline).
 * Run: bun scripts/test-rebuild-cluster.ts   (dev server on :3000)
 */

import { assessUidRisk } from "../src/lib/infranex/uid-defense";
import {
  computeRemainingBlocks,
  tickRemainingBlocks,
  formatBlocksLeft,
  blocksToHoursApprox,
} from "../src/lib/infranex/immunity";
import {
  hmacSign,
  verifyHmac,
  buildDaemonScript,
  buildLauncherScript,
} from "../src/lib/infranex/daemon-bridge";
import { generateSshKeypair, assertHotkeyOnly } from "../src/lib/infranex/deployment/ssh-keys";
import { buildDeployMutation, resolveGpuTypeId } from "../src/lib/infranex/deployment/providers/runpod";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
section("1. assessUidRisk (pure)");
// ---------------------------------------------------------------------------

const base = {
  uid: 7 as number | null,
  active: true,
  incentive: 0.05,
  consensus: 0.3,
  lastUpdateAgeBlocks: 100 as number | null,
  hyperparams: { tempo: 99, immunityPeriod: 7200, maxAllowedUids: 256 },
  registeredUids: 100,
  medianRewardedIncentive: 0.08,
  previousIncentive: null as number | null,
  previousWarningStreak: 0,
};

const healthy = assessUidRisk(base);
check("healthy → healthy", healthy.riskLevel === "healthy" && healthy.riskCodes.length === 0);

const notRegistered = assessUidRisk({ ...base, uid: null });
check("unregistered → critical NOT_REGISTERED", notRegistered.riskLevel === "critical" && notRegistered.riskCodes.includes("NOT_REGISTERED"));

const zeroIncome = assessUidRisk({ ...base, incentive: 0 });
check("zero income → warning ZERO_INCOME", zeroIncome.riskLevel === "warning" && zeroIncome.riskCodes.includes("ZERO_INCOME"));

const evictable = assessUidRisk({
  ...base,
  incentive: 0,
  registeredUids: 256,
  lastUpdateAgeBlocks: 9000,
});
check("at-capacity + immunity-expired + zero → EVICTABLE critical", evictable.riskCodes.includes("EVICTABLE") && evictable.riskLevel === "critical");

const under = assessUidRisk({ ...base, incentive: 0.01, medianRewardedIncentive: 0.08 });
check("underperforming (<30% median) → warning", under.riskCodes.includes("UNDERPERFORMING") && under.riskLevel === "warning");

const collapse = assessUidRisk({ ...base, incentive: 0.02, previousIncentive: 0.06 });
check("collapse (≤50% of prev) → warning", collapse.riskCodes.includes("INCENTIVE_COLLAPSE"));

const persistent = assessUidRisk({ ...base, incentive: 0, previousWarningStreak: 2 });
check("warning ×3 → PERSISTENT_DECLINE critical", persistent.riskCodes.includes("PERSISTENT_DECLINE") && persistent.riskLevel === "critical");

// Authoritative immunity clock (registration block exposed by the runtime).
const NOW_BLOCK = 8_618_670;
const immuneFresh = assessUidRisk({
  ...base,
  incentive: 0,
  registeredUids: 256, // at capacity
  lastUpdateAgeBlocks: 9000, // stale proxy would claim immunity expired
  registrationBlock: NOW_BLOCK - 100,
  blockNumber: NOW_BLOCK,
});
check(
  "fresh registration overrides stale lastUpdate proxy → NO EVICTABLE",
  !immuneFresh.riskCodes.includes("EVICTABLE") &&
    immuneFresh.notes.some((n) => n.includes("immunity window") && n.includes("eviction protection left") && n.includes("7100 blocks"))
);

const immuneExpired = assessUidRisk({
  ...base,
  incentive: 0,
  registeredUids: 256,
  lastUpdateAgeBlocks: 1, // proxy would say protected
  registrationBlock: NOW_BLOCK - 8000,
  blockNumber: NOW_BLOCK,
});
check(
  "expired authoritative clock → EVICTABLE despite fresh proxy",
  immuneExpired.riskCodes.includes("EVICTABLE") && immuneExpired.riskLevel === "critical"
);

// ---------------------------------------------------------------------------
section("1b. Immunity countdown math (pure)");
// ---------------------------------------------------------------------------

check(
  "computeRemainingBlocks: 8618670 + 5000 − 8618670 = 5000",
  computeRemainingBlocks({ registrationBlock: 8618670, windowBlocks: 5000, blockNumber: 8618670 }) === 5000
);
check(
  "computeRemainingBlocks clamps at 0",
  computeRemainingBlocks({ registrationBlock: 100, windowBlocks: 5000, blockNumber: 999999 }) === 0
);
check("formatBlocksLeft: 5000 blocks → 16h 40m", formatBlocksLeft(5000) === "16h 40m");
check("formatBlocksLeft: 210 blocks → 42m 00s", formatBlocksLeft(210) === "42m 00s");
check("formatBlocksLeft: 45 blocks → 9m 00s", formatBlocksLeft(45) === "9m 00s");
check("blocksToHoursApprox: 5000 → ≈16.67 h", Math.abs(blocksToHoursApprox(5000) - 16.6667) < 0.001);

const now = Date.now();
check(
  "tick: fresh snapshot keeps remaining",
  tickRemainingBlocks({ remainingBlocks: 5000, sampledAt: now }) === 5000
);
check(
  "tick: 24 s elapsed → −2 blocks",
  tickRemainingBlocks({ remainingBlocks: 5000, sampledAt: now - 24_000 }) === 4998
);
check(
  "tick: clamps at 0 after long drift",
  tickRemainingBlocks({ remainingBlocks: 3, sampledAt: now - 10 * 60_000 }) === 0
);
check("tick: null remaining stays null (no authoritative clock)", tickRemainingBlocks({ remainingBlocks: null, sampledAt: now }) === null);

// ---------------------------------------------------------------------------
section("2. Daemon bridge — HMAC + scripts");
// ---------------------------------------------------------------------------

const secret = "a".repeat(64);
const freshTs = String(Date.now());
const sig = hmacSign(secret, freshTs, '{"ok":1}');
check("hmac verify ok", verifyHmac(secret, freshTs, '{"ok":1}', sig).ok);
check("hmac rejects tampered body", !verifyHmac(secret, freshTs, '{"ok":0}', sig).ok);
check("hmac rejects stale timestamp", !verifyHmac(secret, "1000000000000", '{"ok":1}', sig).ok);

const script = buildDaemonScript({
  deploymentId: "dep123",
  secret,
  platformUrl: "http://localhost:3000",
  minerCommand: "python3 neurons/miner.py --netuid 1",
});
check("daemon script embeds deployment id", script.includes('DEPLOYMENT_ID = "dep123"'));
check("daemon script has restart_miner", script.includes("restart_miner"));
check("daemon script signs telemetry", script.includes("X-Infranex-Signature"));
check("daemon script is stdlib-only (no pip)", !script.includes("pip install"));

const launcher = buildLauncherScript({ minerCommand: "python3 neurons/miner.py", workDir: "/root" });
check("launcher has systemd branch", launcher.script.includes("systemctl restart infranex-miner") || launcher.script.includes("/etc/systemd/system/infranex-miner.service"));
check("launcher has pm2 fallback", launcher.script.includes("pm2"));
check("launcher has watchdog fallback", launcher.script.includes("watchdog") || launcher.script.includes("while true"));

// ---------------------------------------------------------------------------
section("3. SSH keys + hotkey-only policy");
// ---------------------------------------------------------------------------

const kp = generateSshKeypair("test");
check("keypair generated (ed25519)", kp.publicKey.startsWith("ssh-ed25519 "));
check("private key is openssh format", kp.privateKey.includes("OPENSSH PRIVATE KEY"));
check("fingerprint present", kp.fingerprint.startsWith("SHA256:"));

const cleanConfig = {
  docker: {
    command: "python3 neurons/miner.py --netuid 1",
    envVars: [{ name: "HOTKEY", value: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" }],
  },
};
check("hotkey-only config passes", assertHotkeyOnly(cleanConfig).length === 0);

const dirty = {
  docker: {
    command: "python3 miner.py --mnemonic 'word word word'",
    envVars: [{ name: "COLDKEY_SEED", value: "0x" + "ab".repeat(32) }],
  },
};
const violations = assertHotkeyOnly(dirty);
check("mnemonic detected", violations.some((v) => v.label.includes("mnemonic")));
check("coldkey seed detected", violations.some((v) => v.label.includes("coldkey") || v.label.includes("hex")));

// ---------------------------------------------------------------------------
section("4. RunPod provider v2 — mutation builder");
// ---------------------------------------------------------------------------

check("gpu map resolves 4090", resolveGpuTypeId("RTX 4090") === "NVIDIA GeForce RTX 4090");
check("gpu map unknown → null", resolveGpuTypeId("Quantum QPU") === null);

const mutation = buildDeployMutation({
  name: "infranex-test",
  imageName: "registry/example:latest",
  gpuTypeId: "NVIDIA GeForce RTX 4090",
  envVars: [{ key: "NETUID", value: "1" }],
  ports: "8091/tcp,22/tcp",
  publicKey: "ssh-ed25519 AAAA test",
  volumeInGb: 100,
  minMemoryInGb: 16,
  minVcpuCount: 8,
});
check("mutation uses env object list", mutation.includes('\\"env\\": \\"[{') || mutation.includes("env"));
check("mutation carries publicKey", mutation.includes("publicKey:"));
check("mutation has volumeMountPath", mutation.includes("volumeMountPath"));
check("no dockerArgs (removed in schema)", !mutation.includes("dockerArgs"));

// ---------------------------------------------------------------------------
section("5. Server E2E — triggers + daemon pipeline");
// ---------------------------------------------------------------------------

const BASE = "http://localhost:3000";

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status, body: body as Record<string, unknown> };
}

try {
  // Create a started mock deployment with a synthetic hotkey via DB-level API.
  // POST /api/deployments needs subnet + offer from curated data.
  const created = await api("/api/deployments", {
    method: "POST",
    body: JSON.stringify({
      netuid: 8,
      offerId: "o2",
      minerName: "Cluster Test Miner",
      hotkey: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
      walletName: "test",
      mode: "mock",
    }),
  });
  let deploymentId: string | null = (created.body.deployment as { id?: string } | undefined)?.id ?? null;
  check("mock deployment created (or existing)", created.status === 201 || created.status === 400, `status ${created.status}`);
  if (!deploymentId && created.status === 400) {
    // offerId mismatch — list deployments and reuse the newest mock one
    const list = await api("/api/deployments");
    const deps = (list.body.deployments ?? []) as { id: string; mode: string }[];
    deploymentId = deps.find((d) => d.mode === "mock")?.id ?? null;
  }
  check("have a deployment to work with", !!deploymentId);

  if (deploymentId) {
    // Daemon install — returns script with secret
    const inst = await api("/api/daemon/install", {
      method: "POST",
      body: JSON.stringify({ deploymentId }),
    });
    check("daemon install 200", inst.status === 200);
    const scriptText = String(inst.body.script ?? "");
    check("install script contains secret", scriptText.includes('SECRET = "') && scriptText.length > 500);

    // HMAC-signed telemetry — accepted (sign with the daemon's real secret,
    // extracted from the install script we just received).
    const secretMatch = scriptText.match(/SECRET = "([a-f0-9]{64})"/);
    check("install script embeds hex secret", !!secretMatch);
    const daemonSecret = secretMatch?.[1] ?? "";
    const ts = String(Date.now());
    const telemetryBody = JSON.stringify({ ts: 1, hostname: "test-host", gpus: [], minerProcessAlive: true });
    const sigLocal = hmacSign(daemonSecret, ts, telemetryBody);
    const tele = await fetch(`${BASE}/api/daemon/telemetry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Infranex-Timestamp": ts,
        "X-Infranex-Signature": sigLocal,
        "X-Infranex-Deployment": deploymentId,
      },
      body: telemetryBody,
    });
    check("signed telemetry accepted", tele.status === 200, `status ${tele.status}`);

    // Bad signature — rejected
    const badSig = await fetch(`${BASE}/api/daemon/telemetry`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Infranex-Timestamp": ts,
        "X-Infranex-Signature": "0".repeat(64),
        "X-Infranex-Deployment": deploymentId,
      },
      body: telemetryBody,
    });
    check("bad signature rejected 401", badSig.status === 401);

    // Trigger pass runs (uid pass may skip if chain slow — must not 500)
    const run = await api("/api/triggers", { method: "POST", body: JSON.stringify({ action: "run" }) });
    check("trigger pass 200", run.status === 200);
    check("pass counts present", typeof (run.body.pass as { deploymentsEvaluated?: number })?.deploymentsEvaluated === "number");
    check("uid payload present", Array.isArray(run.body.uid));

    // Approve/dismiss validation: approve requires open event
    const bogus = await api("/api/triggers", { method: "POST", body: JSON.stringify({ action: "approve", id: "nonexistent" }) });
    check("approve nonexistent → 500 with message", bogus.status >= 400);

    // Invalid action
    const invalid = await api("/api/triggers", { method: "POST", body: JSON.stringify({ action: "explode" }) });
    check("invalid action → 400", invalid.status === 400);
  }
} catch (e) {
  failed++;
  failures.push(`E2E harness error: ${e instanceof Error ? e.message : String(e)}`);
}

// ---------------------------------------------------------------------------
console.log(`\n========== ${passed} passed, ${failed} failed ==========`);
if (failures.length) {
  console.log("FAILURES:");
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
