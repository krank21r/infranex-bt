/**
 * Phase 2 — registration-aware deployment lifecycle tests.
 *
 * Sections:
 *   A  pure transition logic (decideRegistrationTransition + SS58 gate)
 *   B  MockTransport post-registration restart branches (offline)
 *   C  DB + LIVE chain E2E (run with --live): attach a real registered
 *      hotkey → registered(uid, block) → downgrade on a junk hotkey →
 *      restart guard. Uses a temp deployment row, cleaned up afterwards.
 *
 * Run:  bun scripts/test-registration-lifecycle.ts [--live]
 *       (with DATABASE_URL inline when running outside Next)
 */
import { db } from "../src/lib/db";
import {
  decideRegistrationTransition,
  isValidSs58,
  checkRegistration,
  attachHotkey,
  restartAfterRegistration,
} from "../src/lib/infranex/deployment/registration";
import { MockTransport } from "../src/lib/devops/transport";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// A. Pure transition logic
// ---------------------------------------------------------------------------
console.log("\nA. decideRegistrationTransition (pure)");

{
  const r = decideRegistrationTransition({ currentState: null, uid: 5, metagraphSize: 256, chainError: false });
  check("null → registered when the hotkey is found", r.to === "registered" && r.reason.includes("uid 5"));
}
{
  const r = decideRegistrationTransition({ currentState: "unregistered", uid: 12, metagraphSize: 256, chainError: false });
  check("unregistered → registered on discovery", r.to === "registered");
}
{
  const r = decideRegistrationTransition({ currentState: "registered", uid: null, metagraphSize: 0, chainError: false });
  check("empty metagraph read is INCONCLUSIVE (no downgrade)", r.to === "unknown", r.reason);
}
{
  const r = decideRegistrationTransition({ currentState: "registered", uid: null, metagraphSize: 128, chainError: false });
  check("registered → unregistered on a definitive miss", r.to === "unregistered" && r.reason.includes("128"));
}
{
  const r = decideRegistrationTransition({ currentState: "unregistered", uid: null, metagraphSize: 128, chainError: false });
  check("unregistered stays unregistered", r.to === "unregistered");
}
{
  const r = decideRegistrationTransition({ currentState: "registered", uid: 3, metagraphSize: 256, chainError: true });
  check("chain error NEVER flips the state", r.to === "unknown");
}
{
  const r = decideRegistrationTransition({ currentState: "unregistered", uid: null, metagraphSize: 0, chainError: true });
  check("chain error wins over everything", r.to === "unknown");
}

console.log("\nA2. isValidSs58 gate");
{
  check("accepts a 48-char SS58", isValidSs58("5DfhGyQdFobKM8NsWvELEAK6gT9iSaXPADjFUesajnVjWYth"));
  check("rejects short strings", !isValidSs58("5Short"));
  check("rejects non-5 prefix", !isValidSs58("1DfhGyQdFobKM8NsWvELEAK6gT9iSaXPADjFUesajnVjWYth"));
  check("rejects null/empty", !isValidSs58(null) && !isValidSs58(""));
}

// ---------------------------------------------------------------------------
// B. MockTransport restart branches
// ---------------------------------------------------------------------------
console.log("\nB. MockTransport post-registration restart branches");

{
  const t = new MockTransport(`test-reg-${Date.now()}-systemd`);
  await t.connect();
  // Fresh mock host: miner not running yet.
  const before = await t.exec("systemctl is-active infranex-miner-sn8");
  check("venv verify before restart: inactive", before.stdout.trim() === "inactive" && before.code === 3);
  const r = await t.exec("systemctl restart infranex-miner-sn8");
  check("systemctl restart succeeds (exit 0)", r.code === 0 && r.stdout.includes("restarted"), `exit=${r.code}`);
  const after = await t.exec("systemctl is-active infranex-miner-sn8");
  check("miner is active after the restart", after.code === 0 && after.stdout.trim() === "active");
  t.close();
}
{
  const t = new MockTransport(`test-reg-${Date.now()}-docker`);
  await t.connect();
  const early = await t.exec("docker restart infranex-miner-sn90");
  check("docker restart BEFORE the image exists fails", early.code !== 0, `exit=${early.code}`);
  // Remediate exactly like the installer's fix commands would on a bare host.
  await t.exec("curl -fsSL https://get.docker.com | sh");
  await t.exec("install-nvidia-toolkit nvidia-container-toolkit");
  await t.exec("git clone https://github.com/example/subnet /opt/infranex/sn90/app");
  await t.exec("cd /opt/infranex/sn90/app && docker build -t infranex/sn90:miner .");
  await t.exec(
    "docker rm -f infranex-miner-sn90 2>/dev/null || true; docker run -d --restart unless-stopped --name infranex-miner-sn90 --gpus all --env-file /opt/infranex/sn90/env -p 8091:8091 infranex/sn90:miner"
  );
  const r = await t.exec("docker restart infranex-miner-sn90");
  check("docker restart succeeds on a running container", r.code === 0 && r.stdout.trim().length === 64, `exit=${r.code}`);
  const ps = await t.exec("docker ps --filter name=infranex-miner-sn90 --format '{{.Names}} {{.Status}}'");
  check("container still up after restart", ps.code === 0 && ps.stdout.includes("Up"), ps.stdout.trim());
  t.close();
}

// ---------------------------------------------------------------------------
// C. DB + live chain E2E (opt-in)
// ---------------------------------------------------------------------------
if (process.argv.includes("--live")) {
  console.log("\nC. Live-chain E2E (temp deployment, α90 uid0 fixture)");

  // Fixture hotkey: whatever UID 0 of α90 actually holds right now.
  const { getChainApi } = await import("../src/lib/infranex/chain");
  const { encodeAddress } = await import("@polkadot/util-crypto");
  const api = await getChainApi();
  const keys = await (api.query.subtensorModule as any).keys.multi([[90, 0]]);
  const kb = keys[0]?.value ?? keys[0]?.inner ?? keys[0];
  const bytes = kb?.toU8a ? kb.toU8a() : kb;
  const realHotkey = encodeAddress(new Uint8Array(bytes), 42);
  console.log(`  fixture: α90 uid0 → ${realHotkey}`);

  const dep = await db.deployment.create({
    data: {
      minerName: "phase2-e2e-temp",
      netuid: 90,
      subnetName: "KubeTEE",
      gpuModel: "RTX 4090",
      provider: "test",
      status: "requested",
      mode: "mock",
      hourlyCost: 0.1,
      monthlyCost: 72,
      config: "{}",
      steps: "[]",
      hotkey: null,
    },
  });

  try {
    // 1. Not started → no chain call, honest note.
    const r1 = await checkRegistration(dep.id);
    check("not-started deployment → unknown + note", r1.state === "unknown" && (r1.note ?? "").includes("not started"));

    // 2. Started with no hotkey → attach note.
    await db.deployment.update({ where: { id: dep.id }, data: { status: "started" } });
    const r2 = await checkRegistration(dep.id);
    check("started without hotkey → unknown + wizard hint", r2.state === "unknown" && (r2.note ?? "").includes("hotkey"));

    // 3. Attach the REAL registered hotkey → registered(uid 0, block set).
    const r3 = await attachHotkey(dep.id, realHotkey);
    check(
      "attach real hotkey → registered",
      r3.state === "registered" && r3.uid === 0 && r3.changed,
      JSON.stringify({ state: r3.state, uid: r3.uid, note: r3.note })
    );
    check("registrationBlock captured (> 0)", (r3.registrationBlock ?? 0) > 0, String(r3.registrationBlock));

    // 4. Forced re-check → no transition (already registered).
    const r4 = await checkRegistration(dep.id, { force: true });
    check("re-check is stable (changed=false)", r4.state === "registered" && !r4.changed);

    // 5. Restart guard: registered → restart works over the mock transport.
    const rr = await restartAfterRegistration(dep.id);
    check("approval restart succeeds (mock)", rr.ok && rr.output.some((l) => l.includes("re-announces")));

    // 6. VALID but unregistered hotkey (keyring-derived, never on chain) →
    //    definitive downgrade to unregistered.
    const { Keyring } = await import("@polkadot/keyring");
    const junkHotkey = new Keyring({ type: "sr25519" })
      .addFromUri("//infranex/phase2-e2e-junk").address;
    const r6 = await attachHotkey(dep.id, junkHotkey);
    check(
      "valid-but-unregistered hotkey → unregistered (downgrade)",
      r6.state === "unregistered" && r6.changed,
      JSON.stringify({ state: r6.state, note: r6.note })
    );

    // 6b. Checksum-invalid SS58 must be refused at the attach boundary.
    let threwChecksum = false;
    try {
      await attachHotkey(dep.id, "5DfhGyQdFobKM8NsWvELEAK6gT9iSaXPADjFUesajnVjWYth");
    } catch {
      threwChecksum = true;
    }
    check("checksum-invalid SS58 refused by attachHotkey", threwChecksum);

    // 7. Restart guard on an unregistered deployment → throws.
    let threw = false;
    try {
      await restartAfterRegistration(dep.id);
    } catch (e) {
      threw = e instanceof Error && e.message.includes("not marked registered");
    }
    check("restart before registration is refused", threw);
  } finally {
    await db.uidSnapshot.deleteMany({ where: { deploymentId: dep.id } });
    await db.deployment.delete({ where: { id: dep.id } }).catch(() => {});
  }
} else {
  console.log("\nC. skipped (pass --live to run the chain E2E)");
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
