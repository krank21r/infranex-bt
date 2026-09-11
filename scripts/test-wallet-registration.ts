/**
 * Sanity tests for the Wallet & Registration module (bun).
 * Run: bun scripts/test-wallet-registration.ts
 */
import {
  BLOCK_TIME_S,
  blocksToHours,
  cmds,
  isValidSs58,
  normalizeWalletState,
  sanitizeWalletName,
} from "../src/lib/devops/wallet-registration";

let passed = 0;
let failed = 0;

function ok(cond: boolean, label: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.error(`  ✗ ${label}`);
  }
}

function eq(a: unknown, b: unknown, label: string) {
  ok(a === b, `${label} (got: ${JSON.stringify(a)})`);
}

console.log("\n== command builders ==");

const c90 = cmds({ walletName: "infranex", hotkeyName: "default", netuid: 90 });
eq(c90.install, "pip install bittensor", "install command");
eq(
  c90.newColdkey,
  "btcli wallet new_coldkey --wallet_name infranex",
  "coldkey command"
);
eq(
  c90.newHotkey,
  "btcli wallet new_hotkey --wallet_name infranex --hotkey_name default",
  "hotkey command"
);
eq(
  c90.overview,
  "btcli wallet overview --wallet_name infranex",
  "overview command"
);
eq(
  c90.scp,
  "scp -r ~/.bittensor/wallets/infranex root@<HOST_IP>:~/.bittensor/wallets/",
  "scp command"
);
eq(
  c90.register,
  "btcli subnets register --netuid 90 --wallet.name infranex --wallet.hotkey default",
  "register command"
);
eq(
  c90.restart,
  "ssh root@<HOST_IP> sudo systemctl restart infranex-miner-sn90",
  "restart command matches installer UNIT_NAME"
);
eq(c90.metagraph, "btcli subnets metagraph --netuid 90", "metagraph command");

const cNull = cmds({ walletName: "w", hotkeyName: "h", netuid: null });
ok(cNull.register === null, "register is null without a journey subnet");
ok(cNull.restart === null, "restart is null without a journey subnet");

const cCustom = cmds({ walletName: "my miner!", hotkeyName: "hk_1", netuid: 8 });
eq(
  cCustom.register,
  "btcli subnets register --netuid 8 --wallet.name myminer --wallet.hotkey hk_1",
  "wallet name sanitized in commands"
);

console.log("\n== sanitizeWalletName ==");

eq(sanitizeWalletName("infranex"), "infranex", "passthrough clean name");
eq(sanitizeWalletName("My Miner #1"), "MyMiner1", "strips spaces and symbols");
eq(sanitizeWalletName(""), "infranex", "empty falls back to infranex");
eq(sanitizeWalletName("x".repeat(40)), "x".repeat(24), "caps at 24 chars");
eq(sanitizeWalletName("a_b-c9"), "a_b-c9", "keeps dash/underscore/digits");

console.log("\n== SS58 validation ==");

ok(
  isValidSs58("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY"),
  "accepts a well-formed 5… address"
);
ok(!isValidSs58("5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQ"), "rejects too-short");
ok(!isValidSs58("0xabc123"), "rejects hex");
ok(!isValidSs58(""), "rejects empty");
ok(!isValidSs58(null), "rejects null");
ok(!isValidSs58("5IILLO0abc"), "rejects ambiguous chars 0OIL");

console.log("\n== state normalization (junk-proof load) ==");

const junk = normalizeWalletState(undefined);
eq(junk.walletName, "infranex", "undefined → defaults");
eq(junk.netuid, null, "netuid null by default");
eq(junk.verifiedUid, null, "verifiedUid null by default");

const partial = normalizeWalletState({
  walletName: "miner one",
  netuid: 90,
  verifiedUid: 42,
  doneSteps: ["1", "2", 3],
  hotkeySs58: "  5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY  ",
  verifiedAt: 123,
});
eq(partial.walletName, "minerone", "wallet sanitized on load");
eq(partial.netuid, 90, "valid netuid kept");
eq(partial.verifiedUid, 42, "valid uid kept");
eq(JSON.stringify(partial.doneSteps), JSON.stringify(["1", "2"]), "non-string step ids dropped");
eq(partial.hotkeySs58, "  5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY  ", "ss58 kept raw (trimmed at verify)");

const badNetuid = normalizeWalletState({ netuid: 12.5 });
eq(badNetuid.netuid, null, "fractional netuid rejected");

console.log("\n== block math ==");

eq(BLOCK_TIME_S, 12, "Finney block time");
ok(
  Math.abs(blocksToHours(5000) - 16.6667) < 0.001,
  "5000 blocks ≈ 16.7 h (KubeTEE immunity)"
);
ok(Math.abs(blocksToHours(7200) - 24) < 0.001, "7200 blocks = 24 h (max window)");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
