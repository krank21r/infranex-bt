import type {
  Subnet,
  Opportunity,
  OpportunityFactor,
  UserMiner,
  GPUModel,
  GPUOffer,
  Deployment,
  RevenuePoint,
  EmissionShare,
  WorkerStatus,
} from "./types";

// ---------------------------------------------------------------------------
// Subnets — modelled on the live Bittensor network (names approximate, figures
// are representative for demo purposes).
// ---------------------------------------------------------------------------

export const subnets: Subnet[] = [
  {
    netuid: 1,
    name: "Cortex",
    symbol: "α1",
    description: "Decentralized text generation & prompt response network.",
    category: "Inference",
    owner: "5FK…9aQ",
    tempo: 99,
    emission: 0.42,
    taoInReserve: 184000,
    price: 0.00041,
    marketCap: 9_120_000,
    volume24h: 412_000,
    change24h: 3.2,
    minersCount: 1024,
    validatorsCount: 64,
    maxNeurons: 4096,
    status: "active",
    registrationOpen: true,
    createdAt: "2023-05-01",
    tags: ["LLM", "text", "inference"],
    minVramGb: 24,
    recommendedGpu: "NVIDIA A100 80GB",
    githubUrl: "https://github.com/opentensor/text-prompting",
  },
  {
    netuid: 2,
    name: "Omron",
    symbol: "α2",
    description: "On-chain sentiment & market signal extraction.",
    category: "Data",
    owner: "5Gm…2Lp",
    tempo: 99,
    emission: 0.31,
    taoInReserve: 121000,
    price: 0.00033,
    marketCap: 6_540_000,
    volume24h: 289_000,
    change24h: -1.1,
    minersCount: 768,
    validatorsCount: 48,
    maxNeurons: 4096,
    status: "active",
    registrationOpen: true,
    createdAt: "2023-06-14",
    tags: ["data", "finance", "signal"],
    minVramGb: 16,
    recommendedGpu: "NVIDIA A100 40GB",
  },
  {
    netuid: 3,
    name: "Vision Labs",
    symbol: "α3",
    description: "Distributed image generation & diffusion serving.",
    category: "Vision",
    owner: "5Hp…7rT",
    tempo: 99,
    emission: 0.55,
    taoInReserve: 240000,
    price: 0.00062,
    marketCap: 13_800_000,
    volume24h: 624_000,
    change24h: 5.8,
    minersCount: 880,
    validatorsCount: 56,
    maxNeurons: 4096,
    status: "active",
    registrationOpen: true,
    createdAt: "2023-08-02",
    tags: ["image", "diffusion", "vision"],
    minVramGb: 40,
    recommendedGpu: "NVIDIA H100 80GB",
    githubUrl: "https://github.com/omegalabsinc/omegalabs-bittensor-subnet",
  },
  {
    netuid: 4,
    name: "TaoStaking",
    symbol: "α4",
    description: "Liquid staking & delegation yield routing.",
    category: "DeFi",
    owner: "5Cd…4uY",
    tempo: 360,
    emission: 0.18,
    taoInReserve: 96000,
    price: 0.00021,
    marketCap: 4_200_000,
    volume24h: 154_000,
    change24h: 0.4,
    minersCount: 512,
    validatorsCount: 128,
    maxNeurons: 4096,
    status: "active",
    registrationOpen: false,
    createdAt: "2023-09-22",
    tags: ["defi", "staking", "yield"],
    minVramGb: 8,
    recommendedGpu: "NVIDIA RTX A5000",
  },
  {
    netuid: 5,
    name: "Synapse",
    symbol: "α5",
    description: "Embedding generation & vector retrieval subnet.",
    category: "Inference",
    owner: "5Fx…8wE",
    tempo: 99,
    emission: 0.27,
    taoInReserve: 110000,
    price: 0.00028,
    marketCap: 5_100_000,
    volume24h: 201_000,
    change24h: 2.1,
    minersCount: 640,
    validatorsCount: 40,
    maxNeurons: 4096,
    status: "active",
    registrationOpen: true,
    createdAt: "2023-11-09",
    tags: ["embedding", "retrieval", "search"],
    minVramGb: 24,
    recommendedGpu: "NVIDIA A100 40GB",
  },
  {
    netuid: 7,
    name: "Apex",
    symbol: "α7",
    description: "Decentralized training of small language models.",
    category: "Training",
    owner: "5Dj…1kZ",
    tempo: 99,
    emission: 0.49,
    taoInReserve: 205000,
    price: 0.00055,
    marketCap: 11_400_000,
    volume24h: 498_000,
    change24h: 4.6,
    minersCount: 412,
    validatorsCount: 36,
    maxNeurons: 2048,
    status: "active",
    registrationOpen: true,
    createdAt: "2024-01-18",
    tags: ["training", "LLM", "fine-tune"],
    minVramGb: 80,
    recommendedGpu: "NVIDIA H100 80GB",
    githubUrl: "https://github.com/macrocosm-os/apex",
  },
  {
    netuid: 8,
    name: "Precise",
    symbol: "α8",
    description: "Time-series forecasting & oracle signals.",
    category: "Data",
    owner: "5Eq…3vB",
    tempo: 360,
    emission: 0.22,
    taoInReserve: 88000,
    price: 0.00024,
    marketCap: 4_700_000,
    volume24h: 176_000,
    change24h: -0.8,
    minersCount: 560,
    validatorsCount: 44,
    maxNeurons: 4096,
    status: "active",
    registrationOpen: true,
    createdAt: "2024-02-27",
    tags: ["forecast", "oracle", "data"],
    minVramGb: 16,
    recommendedGpu: "NVIDIA A100 40GB",
  },
  {
    netuid: 9,
    name: "Gradients",
    symbol: "α9",
    description: "Federated gradient aggregation for fine-tuning.",
    category: "Training",
    owner: "5Ho…6mN",
    tempo: 99,
    emission: 0.38,
    taoInReserve: 158000,
    price: 0.00043,
    marketCap: 8_900_000,
    volume24h: 367_000,
    change24h: 6.2,
    minersCount: 348,
    validatorsCount: 32,
    maxNeurons: 2048,
    status: "active",
    registrationOpen: true,
    createdAt: "2024-03-15",
    tags: ["training", "federated", "fine-tune"],
    minVramGb: 80,
    recommendedGpu: "NVIDIA H100 80GB",
    githubUrl: "https://github.com/macrocosm-os/pretraining",
  },
  {
    netuid: 11,
    name: "BitAudio",
    symbol: "α11",
    description: "Speech-to-text & audio understanding inference.",
    category: "Audio",
    owner: "5Jk…9pR",
    tempo: 99,
    emission: 0.19,
    taoInReserve: 74000,
    price: 0.00019,
    marketCap: 3_600_000,
    volume24h: 128_000,
    change24h: 1.7,
    minersCount: 420,
    validatorsCount: 28,
    maxNeurons: 4096,
    status: "active",
    registrationOpen: true,
    createdAt: "2024-04-30",
    tags: ["audio", "ASR", "speech"],
    minVramGb: 24,
    recommendedGpu: "NVIDIA A100 40GB",
    githubUrl: "https://github.com/UncleTensor/BittAudio",
  },
  {
    netuid: 12,
    name: "Compute",
    symbol: "α12",
    description: "General-purpose GPU compute marketplace.",
    category: "Compute",
    owner: "5Lm…2sK",
    tempo: 360,
    emission: 0.16,
    taoInReserve: 62000,
    price: 0.00017,
    marketCap: 3_100_000,
    volume24h: 102_000,
    change24h: -2.3,
    minersCount: 980,
    validatorsCount: 52,
    maxNeurons: 4096,
    status: "active",
    registrationOpen: false,
    createdAt: "2024-05-19",
    tags: ["compute", "marketplace", "gpu"],
    minVramGb: 8,
    recommendedGpu: "NVIDIA RTX 4090",
  },
  {
    netuid: 14,
    name: "NeuronLink",
    symbol: "α14",
    description: "Knowledge-graph embedding & reasoning.",
    category: "Data",
    owner: "5Np…7tW",
    tempo: 99,
    emission: 0.24,
    taoInReserve: 95000,
    price: 0.00026,
    marketCap: 4_900_000,
    volume24h: 188_000,
    change24h: 3.9,
    minersCount: 384,
    validatorsCount: 30,
    maxNeurons: 2048,
    status: "active",
    registrationOpen: true,
    createdAt: "2024-06-22",
    tags: ["knowledge", "graph", "reasoning"],
    minVramGb: 40,
    recommendedGpu: "NVIDIA A100 80GB",
  },
  {
    netuid: 17,
    name: "Sentinel",
    symbol: "α17",
    description: "Security auditing & smart-contract analysis.",
    category: "Security",
    owner: "5Qr…4vD",
    tempo: 360,
    emission: 0.21,
    taoInReserve: 83000,
    price: 0.00022,
    marketCap: 4_400_000,
    volume24h: 142_000,
    change24h: 2.8,
    minersCount: 296,
    validatorsCount: 26,
    maxNeurons: 2048,
    status: "active",
    registrationOpen: true,
    createdAt: "2024-07-11",
    tags: ["security", "audit", "smart-contract"],
    minVramGb: 24,
    recommendedGpu: "NVIDIA A100 40GB",
  },
  {
    netuid: 19,
    name: "Flux",
    symbol: "α19",
    description: "Real-time video understanding & summarization.",
    category: "Vision",
    owner: "5St…8yG",
    tempo: 99,
    emission: 0.33,
    taoInReserve: 132000,
    price: 0.00037,
    marketCap: 7_200_000,
    volume24h: 281_000,
    change24h: 7.4,
    minersCount: 312,
    validatorsCount: 28,
    maxNeurons: 2048,
    status: "active",
    registrationOpen: true,
    createdAt: "2024-08-05",
    tags: ["video", "vision", "streaming"],
    minVramGb: 80,
    recommendedGpu: "NVIDIA H100 80GB",
    githubUrl: "https://github.com/omegalabsinc/omegalabs-bittensor-subnet",
  },
  {
    netuid: 21,
    name: "Quorum",
    symbol: "α21",
    description: "Decentralized governance & proposal analysis.",
    category: "Data",
    owner: "5Uv…1bF",
    tempo: 360,
    emission: 0.14,
    taoInReserve: 58000,
    price: 0.00015,
    marketCap: 2_800_000,
    volume24h: 94000,
    change24h: -0.5,
    minersCount: 220,
    validatorsCount: 24,
    maxNeurons: 1024,
    status: "active",
    registrationOpen: true,
    createdAt: "2024-09-02",
    tags: ["governance", "data", "analysis"],
    minVramGb: 16,
    recommendedGpu: "NVIDIA RTX A5000",
  },
  {
    netuid: 23,
    name: "Mosaic",
    symbol: "α23",
    description: "Multimodal fusion of text, image, and audio.",
    category: "Multimodal",
    owner: "5Wx…6cH",
    tempo: 99,
    emission: 0.41,
    taoInReserve: 168000,
    price: 0.00046,
    marketCap: 9_600_000,
    volume24h: 402_000,
    change24h: 8.9,
    minersCount: 268,
    validatorsCount: 30,
    maxNeurons: 2048,
    status: "active",
    registrationOpen: true,
    createdAt: "2024-09-28",
    tags: ["multimodal", "fusion", "LLM"],
    minVramGb: 80,
    recommendedGpu: "NVIDIA H100 80GB",
    githubUrl: "https://github.com/omegalabsinc/omegalabs-bittensor-subnet",
  },
  {
    netuid: 25,
    name: "Helix",
    symbol: "α25",
    description: "Genomic & protein structure prediction.",
    category: "Science",
    owner: "5Yz…9dJ",
    tempo: 99,
    emission: 0.29,
    taoInReserve: 118000,
    price: 0.00031,
    marketCap: 6_100_000,
    volume24h: 219_000,
    change24h: 4.1,
    minersCount: 188,
    validatorsCount: 22,
    maxNeurons: 1024,
    status: "active",
    registrationOpen: true,
    createdAt: "2024-10-19",
    tags: ["science", "bio", "protein"],
    minVramGb: 40,
    recommendedGpu: "NVIDIA A100 80GB",
    githubUrl: "https://github.com/macrocosm-os/mainframe",
  },
];

// ---------------------------------------------------------------------------
// Mining requirements — per-category technical specs
// ---------------------------------------------------------------------------

import type { MiningRequirements } from "./types";

const CATEGORY_REQUIREMENTS: Record<
  string,
  { dockerImage: string; command: string; extraArgs: string[]; keyDeps: string[]; python: string; cuda: string }
> = {
  Inference: {
    dockerImage: "bittensor/subnet:latest",
    command: "python neurons/miner.py --no_auto_weights_update",
    extraArgs: ["--neuron.device cuda", "--neuron.num_workers 1"],
    keyDeps: ["torch>=2.1", "transformers>=4.36", "bittensor>=6.9", "accelerate>=0.25"],
    python: "3.10",
    cuda: "12.1",
  },
  Vision: {
    dockerImage: "bittensor/vision-subnet:latest",
    command: "python neurons/miner.py --neuron.model_name diffusion",
    extraArgs: ["--neuron.device cuda", "--neuron.batch_size 4"],
    keyDeps: ["torch>=2.1", "diffusers>=0.25", "transformers>=4.36", "bittensor>=6.9", "accelerate>=0.25"],
    python: "3.10",
    cuda: "12.1",
  },
  Training: {
    dockerImage: "bittensor/training-subnet:latest",
    command: "python neurons/miner.py --neuron.compile",
    extraArgs: ["--neuron.device cuda", "--neuron.world_size 1"],
    keyDeps: ["torch>=2.2", "transformers>=4.36", "deepspeed>=0.13", "bittensor>=6.9", "flash-attn>=2.5"],
    python: "3.10",
    cuda: "12.2",
  },
  Data: {
    dockerImage: "bittensor/data-subnet:latest",
    command: "python neurons/miner.py",
    extraArgs: ["--neuron.device cuda"],
    keyDeps: ["torch>=2.1", "pandas>=2.0", "scikit-learn>=1.3", "bittensor>=6.9"],
    python: "3.10",
    cuda: "12.1",
  },
  Audio: {
    dockerImage: "bittensor/audio-subnet:latest",
    command: "python neurons/miner.py",
    extraArgs: ["--neuron.device cuda"],
    keyDeps: ["torch>=2.1", "torchaudio>=2.1", "transformers>=4.36", "bittensor>=6.9", "librosa>=0.10"],
    python: "3.10",
    cuda: "12.1",
  },
  Compute: {
    dockerImage: "bittensor/compute-subnet:latest",
    command: "python neurons/miner.py",
    extraArgs: ["--neuron.device cuda"],
    keyDeps: ["torch>=2.1", "bittensor>=6.9", "docker>=6.0"],
    python: "3.10",
    cuda: "12.1",
  },
  Science: {
    dockerImage: "bittensor/science-subnet:latest",
    command: "python neurons/miner.py",
    extraArgs: ["--neuron.device cuda"],
    keyDeps: ["torch>=2.1", "biopython>=1.83", "transformers>=4.36", "bittensor>=6.9", "fair-esm>=2.0"],
    python: "3.10",
    cuda: "12.1",
  },
  Security: {
    dockerImage: "bittensor/security-subnet:latest",
    command: "python neurons/miner.py",
    extraArgs: ["--neuron.device cuda"],
    keyDeps: ["torch>=2.1", "slither-analyzer>=0.9", "bittensor>=6.9", "solc-select>=2.0"],
    python: "3.10",
    cuda: "12.1",
  },
  DeFi: {
    dockerImage: "bittensor/defi-subnet:latest",
    command: "python neurons/miner.py",
    extraArgs: ["--neuron.device cuda"],
    keyDeps: ["torch>=2.1", "web3>=6.0", "bittensor>=6.9", "pandas>=2.0"],
    python: "3.10",
    cuda: "12.1",
  },
  Multimodal: {
    dockerImage: "bittensor/multimodal-subnet:latest",
    command: "python neurons/miner.py",
    extraArgs: ["--neuron.device cuda", "--neuron.batch_size 2"],
    keyDeps: ["torch>=2.2", "transformers>=4.36", "diffusers>=0.25", "bittensor>=6.9", "accelerate>=0.25", "flash-attn>=2.5"],
    python: "3.10",
    cuda: "12.2",
  },
};

function buildMiningRequirements(s: typeof subnets[number]): MiningRequirements {
  const cat = CATEGORY_REQUIREMENTS[s.category] ?? CATEGORY_REQUIREMENTS.Data;
  const axonPort = 8091;
  const prometheusPort = 8092;

  const alternativeGpus: string[] = [];
  if (s.minVramGb <= 24) alternativeGpus.push("RTX 4090 (24GB)", "RTX A5000 (24GB)", "RTX 3090 (24GB)");
  if (s.minVramGb <= 40) alternativeGpus.push("A100 40GB", "RTX A6000 (48GB)", "L40S (48GB)");
  if (s.minVramGb <= 80) alternativeGpus.push("A100 80GB", "H100 80GB", "H100 NVL (94GB)");
  if (s.minVramGb > 80) alternativeGpus.push("H200 141GB", "B200 180GB");

  const minCudaCompute = s.minVramGb >= 80 ? "8.0+ (Ampere/Hopper)" : "7.5+ (Turing+)";
  const minCpuCores = Math.max(8, Math.ceil(s.minVramGb / 8));
  const minRamGb = Math.max(64, s.minVramGb);
  const recommendedRamGb = Math.max(128, s.minVramGb * 2);

  const command = `${cat.command} \\
  --subtensor.network finney \\
  --netuid ${s.netuid} \\
  --wallet.name infranex \\
  --wallet.hotkey default \\
  --axon.port ${axonPort} \\
  --logging.debug \\
  ${cat.extraArgs.join(" \\\n  ")}`;

  return {
    gpu: {
      minVramGb: s.minVramGb,
      recommendedGpu: s.recommendedGpu,
      alternativeGpus: alternativeGpus.slice(0, 5),
      minCudaComputeCapability: minCudaCompute,
      gpuCount: 1,
    },
    runtime: {
      pythonVersion: cat.python,
      cudaVersion: cat.cuda,
      dockerRequired: true,
      nvidiaRuntimeRequired: true,
      dockerImage: cat.dockerImage,
    },
    hardware: {
      minCpuCores,
      minRamGb,
      minDiskGb: 200,
      recommendedRamGb,
    },
    network: {
      subtensorNetwork: "finney",
      subtensorEndpoint: "wss://entrypoint-finney.opentensor.ai:443",
      axonPort,
      prometheusPort,
      openPorts: [`${axonPort}/tcp`, `${prometheusPort}/tcp`],
    },
    miner: {
      command,
      walletName: "infranex",
      hotkeyName: "default",
      extraArgs: cat.extraArgs,
      keyDependencies: cat.keyDeps,
    },
    registration: {
      minStakeTao: Math.max(0.01, Math.round((s.taoInReserve / Math.max(s.minersCount, 1) * 0.001) * 100) / 100),
      registrationCostTao: 1.0,
      tempo: s.tempo,
      maxRegistrationsPerBlock: 1,
    },
    docker: {
      imageName: cat.dockerImage,
      ports: [`${axonPort}/tcp`, `${prometheusPort}/tcp`],
      volumes: [{ path: "/workspace", sizeGb: 100 }],
      envVars: [
        { name: "BT_NETWORK", description: "Bittensor network (finney/test)", required: true },
        { name: "BT_NETUID", description: "Subnet netuid to mine on", required: true },
        { name: "BT_WALLET_NAME", description: "Wallet name for the miner", required: true },
        { name: "BT_HOTKEY_NAME", description: "Hotkey name for the miner", required: true },
        { name: "NVIDIA_VISIBLE_DEVICES", description: "GPU device visibility", required: true },
        { name: "PYTHONUNBUFFERED", description: "Unbuffered Python output", required: false },
      ],
    },
  };
}

// Populate mining requirements for all subnets
subnets.forEach((s) => {
  s.miningRequirements = buildMiningRequirements(s);
});

// ---------------------------------------------------------------------------
// Scoring — Miner's Ledger v2 (5 pillars: Net ROI, Seat Safety, Alpha
// Economics, Earning Reality, Fit & Feasibility). The engine lives in
// miner-score.ts and is shared by the live pipeline; re-exported here for
// compatibility with existing imports.
// ---------------------------------------------------------------------------

export {
  type ScoreComponents,
  SCORE_WEIGHTS,
  deriveFactors,
  totalScore,
  riskLevel,
  classifySubnetHardware,
  scoreMinersLedger,
  type SubnetHardwareProfile,
  type MinerLedger,
  type MinerLedgerDiagnostics,
  GPU_TIERS,
  estimateGpuTierFromRevenue,
} from "./miner-score";

import { classifySubnetHardware, scoreMinersLedger, totalScore, riskLevel } from "./miner-score";
import type { LiveSubnetMetrics } from "./chain";

const TAO_USD = 412; // representative TAO/USD price (offline fallback only)

// required stake estimate: reserve spread across miners
function stakeFor(s: Subnet): number {
  return Math.round((s.taoInReserve / Math.max(s.minersCount, 1)) * 10) / 10;
}

// Offline fallback ranking — used ONLY when the live chain snapshot is
// unavailable. Scores flow through the SAME Miner's Ledger engine as the
// live path (synthesized chain metrics from the curated catalog) so the
// two pipelines stay consistent.
export const opportunities: Opportunity[] = (() => {
  const opps = subnets.map((s) => {
    const live: LiveSubnetMetrics = {
      netuid: s.netuid,
      name: s.name,
      minersCount: s.minersCount,
      validatorsCount: s.validatorsCount,
      subnetTao: s.taoInReserve,
      alphaIn: s.price > 0 ? s.taoInReserve / s.price : 0,
      alphaOut: 0,
      tempo: s.tempo,
      emissionEnabled: s.status === "active",
      movingPrice: s.price,
      emission: s.emission,
      emissionTaoPerDay: s.emission * 720,
      minerEmissionTaoPerDay: s.emission * 720 * 0.41, // docs: miners get 41%
      rewardedMiners: Math.max(1, Math.round(s.minersCount * 0.7)),
      top10IncentiveShare: null,
      incentiveMedianShare: null,
      burnCostTao: null,
      immunityBlocks: null,
      alphaPriceChange24h: s.change24h,
      maxUids: s.maxNeurons,
      owner: s.owner,
      registeredAt: null,
      identityGithub: s.githubUrl ?? null,
      identityDescription: s.description,
    };
    const hardware = classifySubnetHardware(s.name, s.description, {
      fallbackCategory: s.category,
      fallbackVramGb: s.minVramGb,
      fallbackGpu: s.recommendedGpu,
    });
    const { components, factors, diag } = scoreMinersLedger({
      live,
      taoUsd: TAO_USD,
      hardware,
    });
    const score = totalScore(components);
    const reqStake = stakeFor(s);
    const apy =
      reqStake > 0
        ? Math.round(((diag.perEarningDailyTao * 365) / reqStake) * 10) / 10
        : 0;
    return {
      id: `opp-${s.netuid}`,
      netuid: s.netuid,
      subnetName: s.name,
      subnetSymbol: s.symbol,
      category: s.category,
      type: "mining" as const,
      score,
      rank: 0,
      estimatedDailyReward: diag.expectedDailyTao,
      estimatedMonthlyRewardUsd: diag.grossMonthlyUsd,
      estimatedApy: apy,
      requiredStake: reqStake,
      utilization: diag.rewardedRatio ?? Math.min(0.95, s.minersCount / s.maxNeurons),
      riskLevel: riskLevel(score),
      confidence: Math.round(score) / 100,
      factors,
      status: "active" as const,
      updatedAt: new Date().toISOString(),
      minVramGb: hardware.minVramGb,
      recommendedGpu: hardware.recommendedGpu,
      workType: hardware.category,
      grossMonthlyUsd: diag.grossMonthlyUsd,
      netMonthlyUsd: diag.netMonthlyUsd,
      gpuCostMonthlyUsd: diag.gpuCostMonthlyUsd,
      infraCostMonthlyUsd: diag.infraCostMonthlyUsd,
      netDailyTao: diag.netDailyTao,
      alphaPriceUsd: diag.alphaPriceUsd,
      alphaChange24h: diag.alphaChange24h,
      liquidityTao: diag.liquidityTao,
      slippagePct: diag.slippagePct,
      burnCostTao: diag.burnCostTao,
      top10IncentiveShare: diag.top10IncentiveShare,
      rewardMedianShare: diag.rewardMedianShare,
      perEarningMeanDailyTao: diag.perEarningDailyTao,
      rewardedRatio: diag.rewardedRatio,
      rampWeeks: diag.rampWeeks,
      freeSlots: diag.freeSlots,
      totalSlots: diag.totalSlots,
      immunityBlocks: diag.immunityBlocks,
    };
  });
  opps.sort((a, b) => b.score - a.score);
  opps.forEach((o, i) => (o.rank = i + 1));
  return opps;
})();

// ---------------------------------------------------------------------------
// GPU catalog
// ---------------------------------------------------------------------------

export const gpuModels: GPUModel[] = [
  { id: "rtx4090", name: "RTX 4090", manufacturer: "NVIDIA", vramGb: 24, cudaCores: 16384, fp16Tflops: 330, tdpWatts: 450, generation: "Ada", tierLabel: "High" },
  { id: "rtxa5000", name: "RTX A5000", manufacturer: "NVIDIA", vramGb: 24, cudaCores: 8192, fp16Tflops: 108, tdpWatts: 230, generation: "Ampere", tierLabel: "Mid" },
  { id: "rtxa6000", name: "RTX A6000", manufacturer: "NVIDIA", vramGb: 48, cudaCores: 10752, fp16Tflops: 155, tdpWatts: 300, generation: "Ampere", tierLabel: "High" },
  { id: "a100-40", name: "A100 40GB", manufacturer: "NVIDIA", vramGb: 40, cudaCores: 6912, fp16Tflops: 312, tdpWatts: 250, generation: "Ampere", tierLabel: "High" },
  { id: "a100-80", name: "A100 80GB", manufacturer: "NVIDIA", vramGb: 80, cudaCores: 6912, fp16Tflops: 312, tdpWatts: 400, generation: "Ampere", tierLabel: "Flagship" },
  { id: "h100-80", name: "H100 80GB", manufacturer: "NVIDIA", vramGb: 80, cudaCores: 16896, fp16Tflops: 989, tdpWatts: 700, generation: "Hopper", tierLabel: "Flagship" },
  { id: "h200", name: "H200 141GB", manufacturer: "NVIDIA", vramGb: 141, cudaCores: 16896, fp16Tflops: 989, tdpWatts: 700, generation: "Hopper", tierLabel: "Flagship" },
  { id: "l40s", name: "L40S", manufacturer: "NVIDIA", vramGb: 48, cudaCores: 18176, fp16Tflops: 362, tdpWatts: 350, generation: "Ada", tierLabel: "High" },
];

export const gpuProviders = ["RunPod", "Vast.ai", "TensorDock", "E2E Cloud", "Lambda"];

export const gpuOffers: GPUOffer[] = [
  { id: "o1", model: "RTX 4090", vramGb: 24, provider: "Vast.ai", region: "US-East", hourlyPrice: 0.34, monthlyPrice: 245, availability: "available", isSpot: true, ramGb: 64, cpuCores: 8 },
  { id: "o2", model: "RTX 4090", vramGb: 24, provider: "RunPod", region: "EU-West", hourlyPrice: 0.39, monthlyPrice: 281, availability: "limited", isSpot: false, ramGb: 64, cpuCores: 10 },
  { id: "o3", model: "RTX A5000", vramGb: 24, provider: "TensorDock", region: "US-West", hourlyPrice: 0.22, monthlyPrice: 158, availability: "available", isSpot: true, ramGb: 48, cpuCores: 8 },
  { id: "o4", model: "RTX A6000", vramGb: 48, provider: "RunPod", region: "US-East", hourlyPrice: 0.45, monthlyPrice: 324, availability: "available", isSpot: false, ramGb: 96, cpuCores: 12 },
  { id: "o5", model: "A100 40GB", vramGb: 40, provider: "Vast.ai", region: "EU-Central", hourlyPrice: 0.64, monthlyPrice: 461, availability: "limited", isSpot: true, ramGb: 128, cpuCores: 16 },
  { id: "o6", model: "A100 40GB", vramGb: 40, provider: "Lambda", region: "US-West", hourlyPrice: 0.75, monthlyPrice: 540, availability: "available", isSpot: false, ramGb: 128, cpuCores: 16 },
  { id: "o7", model: "A100 80GB", vramGb: 80, provider: "RunPod", region: "US-East", hourlyPrice: 1.1, monthlyPrice: 792, availability: "scarce", isSpot: false, ramGb: 192, cpuCores: 24 },
  { id: "o8", model: "A100 80GB", vramGb: 80, provider: "TensorDock", region: "EU-West", hourlyPrice: 0.98, monthlyPrice: 706, availability: "limited", isSpot: true, ramGb: 192, cpuCores: 24 },
  { id: "o9", model: "H100 80GB", vramGb: 80, provider: "RunPod", region: "US-East", hourlyPrice: 2.49, monthlyPrice: 1793, availability: "scarce", isSpot: false, ramGb: 256, cpuCores: 32 },
  { id: "o10", model: "H100 80GB", vramGb: 80, provider: "Lambda", region: "US-West", hourlyPrice: 2.19, monthlyPrice: 1577, availability: "limited", isSpot: true, ramGb: 256, cpuCores: 32 },
  { id: "o11", model: "H100 80GB", vramGb: 80, provider: "Vast.ai", region: "EU-Central", hourlyPrice: 2.39, monthlyPrice: 1721, availability: "scarce", isSpot: false, ramGb: 256, cpuCores: 32 },
  { id: "o12", model: "H200 141GB", vramGb: 141, provider: "Lambda", region: "US-West", hourlyPrice: 3.49, monthlyPrice: 2513, availability: "scarce", isSpot: false, ramGb: 384, cpuCores: 48 },
  { id: "o13", model: "L40S", vramGb: 48, provider: "E2E Cloud", region: "AP-South", hourlyPrice: 0.82, monthlyPrice: 590, availability: "available", isSpot: false, ramGb: 128, cpuCores: 16 },
  { id: "o14", model: "RTX A6000", vramGb: 48, provider: "TensorDock", region: "AP-South", hourlyPrice: 0.41, monthlyPrice: 295, availability: "available", isSpot: true, ramGb: 96, cpuCores: 12 },
];

// ---------------------------------------------------------------------------
// User miners (portfolio)
// ---------------------------------------------------------------------------

export const userMiners: UserMiner[] = [
  {
    id: "m1",
    name: "apex-prod-01",
    hotkey: "5FKtj8nP3qW7vR2sN6mB1cD4eF8gH9iJ0kL",
    netuid: 7,
    subnetName: "Apex",
    status: "active",
    createdAt: "2024-11-02",
    totalEarnings: 184.32,
    uptimePercent: 99.2,
    rank: 47,
    incentive: 0.71,
    trust: 0.88,
    emission: 0.0142,
    gpu: "H100 80GB",
    region: "US-East",
  },
  {
    id: "m2",
    name: "vision-edge-02",
    hotkey: "5GmN4qR8sT2uV6wX0yZ3aB5cD7eF9gH1iJ",
    netuid: 3,
    subnetName: "Vision Labs",
    status: "active",
    createdAt: "2024-12-18",
    totalEarnings: 142.07,
    uptimePercent: 98.4,
    rank: 112,
    incentive: 0.64,
    trust: 0.81,
    emission: 0.0118,
    gpu: "A100 80GB",
    region: "EU-West",
  },
  {
    id: "m3",
    name: "mosaic-fusion-03",
    hotkey: "5Hp7tW2xY9zA4bC6dE8fG0hI2jK4lM6nO",
    netuid: 23,
    subnetName: "Mosaic",
    status: "active",
    createdAt: "2025-01-09",
    totalEarnings: 96.51,
    uptimePercent: 97.8,
    rank: 38,
    incentive: 0.76,
    trust: 0.84,
    emission: 0.0131,
    gpu: "H100 80GB",
    region: "US-West",
  },
  {
    id: "m4",
    name: "cortex-text-04",
    hotkey: "5Cd4uY8vR1sT3wX6yZ0aB2cD4eF6gH8iJ",
    netuid: 1,
    subnetName: "Cortex",
    status: "inactive",
    createdAt: "2024-10-22",
    totalEarnings: 211.88,
    uptimePercent: 94.1,
    rank: 203,
    incentive: 0.42,
    trust: 0.69,
    emission: 0.0,
    gpu: "A100 40GB",
    region: "US-East",
  },
  {
    id: "m5",
    name: "flux-stream-05",
    hotkey: "5Fx8wE2mN4qR6sT8uV0yZ2aB4cD6eF8g",
    netuid: 19,
    subnetName: "Flux",
    status: "pending",
    createdAt: "2025-02-14",
    totalEarnings: 0,
    uptimePercent: 0,
    rank: 0,
    incentive: 0,
    trust: 0,
    emission: 0,
    gpu: "H100 80GB",
    region: "AP-South",
  },
];

// ---------------------------------------------------------------------------
// Deployments
// ---------------------------------------------------------------------------

export const deployments: Deployment[] = [
  {
    id: "d1",
    minerName: "apex-prod-01",
    netuid: 7,
    subnetName: "Apex",
    gpu: "H100 80GB",
    provider: "RunPod",
    status: "started",
    progress: 100,
    estimatedMonthlyCost: 1793,
    estimatedMonthlyRevenue: 3120,
    startedAt: "2025-02-01",
    steps: [
      { name: "request", label: "Request", status: "done" },
      { name: "approve", label: "Approve", status: "done" },
      { name: "provision", label: "Provision GPU", status: "done" },
      { name: "setup", label: "Environment Setup", status: "done" },
      { name: "deploy", label: "Deploy Miner", status: "done" },
      { name: "health", label: "Health Check", status: "done" },
    ],
  },
  {
    id: "d2",
    minerName: "mosaic-fusion-03",
    netuid: 23,
    subnetName: "Mosaic",
    gpu: "H100 80GB",
    provider: "Lambda",
    status: "deploying",
    progress: 68,
    estimatedMonthlyCost: 1577,
    estimatedMonthlyRevenue: 3380,
    startedAt: "2025-02-18",
    steps: [
      { name: "request", label: "Request", status: "done" },
      { name: "approve", label: "Approve", status: "done" },
      { name: "provision", label: "Provision GPU", status: "done" },
      { name: "setup", label: "Environment Setup", status: "done" },
      { name: "deploy", label: "Deploy Miner", status: "running" },
      { name: "health", label: "Health Check", status: "pending" },
    ],
  },
  {
    id: "d3",
    minerName: "flux-stream-05",
    netuid: 19,
    subnetName: "Flux",
    gpu: "H100 80GB",
    provider: "Vast.ai",
    status: "provisioning",
    progress: 34,
    estimatedMonthlyCost: 1721,
    estimatedMonthlyRevenue: 3260,
    startedAt: "2025-02-20",
    steps: [
      { name: "request", label: "Request", status: "done" },
      { name: "approve", label: "Approve", status: "done" },
      { name: "provision", label: "Provision GPU", status: "running" },
      { name: "setup", label: "Environment Setup", status: "pending" },
      { name: "deploy", label: "Deploy Miner", status: "pending" },
      { name: "health", label: "Health Check", status: "pending" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------

export const revenueSeries: RevenuePoint[] = (() => {
  const days = 30;
  const out: RevenuePoint[] = [];
  let tao = 1.2;
  for (let i = days; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    tao = Math.max(0.6, tao + (Math.random() - 0.45) * 0.18);
    const usd = Math.round(tao * TAO_USD * 100) / 100;
    out.push({
      day: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      tao: Math.round(tao * 100) / 100,
      usd,
    });
  }
  return out;
})();

const EMISSION_COLORS = [
  "hsl(84 90% 60%)",
  "hsl(142 70% 50%)",
  "hsl(45 93% 60%)",
  "hsl(200 80% 60%)",
  "hsl(280 70% 65%)",
  "hsl(15 85% 60%)",
  "hsl(170 70% 50%)",
  "hsl(330 75% 62%)",
];

export const emissionShares: EmissionShare[] = subnets
  .slice(0, 8)
  .map((s, i) => ({
    name: s.name,
    symbol: s.symbol,
    netuid: s.netuid,
    emission: s.emission,
    color: EMISSION_COLORS[i % EMISSION_COLORS.length],
  }));

// ---------------------------------------------------------------------------
// Workers
// ---------------------------------------------------------------------------

export const workers: WorkerStatus[] = [
  { name: "Subnet Scanner", status: "healthy", lastRun: "2m ago", latencyMs: 412, tasksProcessed: 16483 },
  { name: "Opportunity Scorer", status: "healthy", lastRun: "5m ago", latencyMs: 1280, tasksProcessed: 4210 },
  { name: "GPU Catalog Sync", status: "degraded", lastRun: "18m ago", latencyMs: 3120, tasksProcessed: 892 },
  { name: "Monitoring Engine", status: "healthy", lastRun: "1m ago", latencyMs: 240, tasksProcessed: 98214 },
  { name: "Change Detector", status: "healthy", lastRun: "7m ago", latencyMs: 680, tasksProcessed: 3120 },
];

// ---------------------------------------------------------------------------
// Aggregated metrics
// ---------------------------------------------------------------------------

export function getDashboardMetrics() {
  const trackedSubnets = subnets.length;
  const activeSubnets = subnets.filter((s) => s.status === "active").length;
  const totalMiners = subnets.reduce((a, s) => a + s.minersCount, 0);
  const totalValidators = subnets.reduce((a, s) => a + s.validatorsCount, 0);
  const totalMarketCap = subnets.reduce((a, s) => a + s.marketCap, 0);
  const totalEmission = subnets.reduce((a, s) => a + s.emission, 0);
  const avgScore =
    opportunities.reduce((a, o) => a + o.score, 0) / opportunities.length;
  const runCount = opportunities.filter((o) => o.score >= 60).length;
  const watchCount = opportunities.filter(
    (o) => o.score >= 40 && o.score < 60
  ).length;
  const avoidCount = opportunities.filter((o) => o.score < 40).length;
  const portfolioEarnings = userMiners.reduce((a, m) => a + m.totalEarnings, 0);
  const portfolioDailyEmission = userMiners.reduce((a, m) => a + m.emission, 0);
  const activeMiners = userMiners.filter((m) => m.status === "active").length;

  return {
    trackedSubnets,
    activeSubnets,
    totalMiners,
    totalValidators,
    totalMarketCap,
    totalEmission,
    avgScore: Math.round(avgScore * 10) / 10,
    runCount,
    watchCount,
    avoidCount,
    portfolioEarnings,
    portfolioDailyEmission,
    activeMiners,
    taoUsd: TAO_USD,
  };
}
