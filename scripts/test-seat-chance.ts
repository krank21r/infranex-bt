// Quick sanity checks for assessSeatChance
import { assessSeatChance, formatBurnTao } from "../src/lib/infranex/miner-score";

function check(name: string, cond: boolean, extra?: string) {
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? ` (${extra})` : ""}`);
  if (!cond) process.exitCode = 1;
}

// 1. Open subnet — free slots
const open = assessSeatChance({
  minersCount: 233, maxUids: 256, burnCostTao: 1.02, immunityBlocks: 4096, rewardedMiners: 180,
});
check("open verdict when slots free", open.verdict === "open", open.headline);
check("open headline has count", open.headline.includes("23 of 256"), open.headline);
check("immunity hours computed", open.immunityHours != null && Math.abs((open.immunityHours ?? 0) - 13.7) < 0.1, String(open.immunityHours));
check("replaceable share = 1 - 180/233", Math.abs((open.replaceableShare ?? 0) - (1 - 180 / 233)) < 0.01, String(open.replaceableShare));

// 2. Full subnet with burn — the "can I still get in?" case
const full = assessSeatChance({
  minersCount: 256, maxUids: 256, burnCostTao: 0.857, immunityBlocks: 7200, rewardedMiners: 96,
});
check("burn-entry verdict when full + burn", full.verdict === "burn-entry", full.headline);
check("canRegister true when full", full.canRegister === true);
check("burn headline mentions cost", full.headline.includes("0.857 TAO"), full.headline);
check("detail explains displacement", full.detail.includes("replaces the WORST"), "");
check("deep replaceable bottom noted", full.detail.includes("replaceable bottom"), "");

// 3. Full, no burn quote — competitive/waitlist
const wl = assessSeatChance({ minersCount: 256, maxUids: 256, burnCostTao: null, immunityBlocks: null, rewardedMiners: null });
check("waitlist verdict when full, no burn", wl.verdict === "waitlist", wl.headline);
check("waitlist canRegister true (PoW path)", wl.canRegister === true);

// 4. Strong cohort — almost everyone earned
const tough = assessSeatChance({
  minersCount: 1024, maxUids: 1024, burnCostTao: 2.1, immunityBlocks: 4096, rewardedMiners: 1010,
});
check("tough cohort flagged in detail", tough.detail.includes("displacement targets are scarce"), "");

// 5. Unknown capacity
const unk = assessSeatChance({ minersCount: 50, maxUids: null, burnCostTao: null, immunityBlocks: null, rewardedMiners: null });
check("unknown verdict without capacity", unk.verdict === "unknown");

// 6. rewardedRatio input path
const viaRatio = assessSeatChance({
  minersCount: 256, maxUids: 256, burnCostTao: 1.0, immunityBlocks: 4096, rewardedRatio: 0.4,
});
check("rewardedRatio path works", Math.abs((viaRatio.replaceableShare ?? 0) - 0.6) < 0.001, String(viaRatio.replaceableShare));

// 7. Burn-quote display precision — floor burns must not be rounded 2x up
//    (Chutes lived at 0.0005 TAO; toFixed(3) showed "0.001")
const floor = assessSeatChance({
  minersCount: 256, maxUids: 256, burnCostTao: 0.0005, immunityBlocks: 5000, rewardedMiners: 16,
});
check("floor burn shows 4 decimals", floor.headline.includes("0.0005 TAO"), floor.headline);
check("floor burn not misquoted as 0.001", !floor.headline.includes("0.001 TAO"), floor.headline);
check("floor detail quotes exact burn", floor.detail.includes("~0.0005 TAO"), "");
check("formatBurnTao sub-0.01", formatBurnTao(0.0005) === "0.0005" && formatBurnTao(0.005) === "0.0050");
check("formatBurnTao sub-1", formatBurnTao(0.857) === "0.857");
check("formatBurnTao whole+large", formatBurnTao(5) === "5.00" && formatBurnTao(2.1) === "2.10");

console.log("done");
