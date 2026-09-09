// Infranex BT — domain types (adapted for the single-page intelligence platform)

export interface Subnet {
  netuid: number;
  name: string;
  symbol: string;
  description: string;
  category: string;
  owner: string;
  tempo: number;
  emission: number; // TAO per block
  taoInReserve: number;
  price: number; // TAO price of alpha
  marketCap: number;
  volume24h: number;
  change24h: number;
  minersCount: number;
  validatorsCount: number;
  maxNeurons: number;
  status: "active" | "inactive" | "pending";
  registrationOpen: boolean;
  createdAt: string;
  tags: string[];
  minVramGb: number;
  recommendedGpu: string;
  githubUrl?: string | null;
  website?: string | null;
  miningRequirements?: MiningRequirements;
}

/** Complete technical requirements to mine a subnet. */
export interface MiningRequirements {
  gpu: {
    minVramGb: number;
    recommendedGpu: string;
    alternativeGpus: string[];
    minCudaComputeCapability: string;
    gpuCount: number;
  };
  runtime: {
    pythonVersion: string;
    cudaVersion: string;
    dockerRequired: boolean;
    nvidiaRuntimeRequired: boolean;
    dockerImage: string;
  };
  hardware: {
    minCpuCores: number;
    minRamGb: number;
    minDiskGb: number;
    recommendedRamGb: number;
  };
  network: {
    subtensorNetwork: "finney" | "test";
    subtensorEndpoint: string;
    axonPort: number;
    prometheusPort: number;
    openPorts: string[];
  };
  miner: {
    command: string;
    walletName: string;
    hotkeyName: string;
    extraArgs: string[];
    keyDependencies: string[];
  };
  registration: {
    minStakeTao: number;
    registrationCostTao: number;
    tempo: number;
    maxRegistrationsPerBlock: number;
  };
  docker: {
    imageName: string;
    ports: string[];
    volumes: { path: string; sizeGb: number }[];
    envVars: { name: string; description: string; required: boolean }[];
  };
}

/** Fields that can be sourced from the live chain. */
export type LiveField =
  | "minersCount"
  | "taoInReserve"
  | "price"
  | "tempo"
  | "emission"
  | "status"
  | "marketCap";

export interface OpportunityFactor {
  name: string;
  value: number; // weighted contribution
  weight: number;
  raw: number; // raw component score 0-100
  impact: "positive" | "negative" | "neutral";
  description: string;
}

export interface Opportunity {
  id: string;
  netuid: number;
  subnetName: string;
  subnetSymbol: string;
  category: string;
  type: "mining" | "validating" | "staking";
  score: number; // 0-100
  rank: number;
  estimatedDailyReward: number; // TAO
  estimatedMonthlyRewardUsd: number;
  estimatedApy: number;
  requiredStake: number;
  utilization: number; // 0-1
  riskLevel: "low" | "medium" | "high";
  confidence: number; // 0-1
  factors: OpportunityFactor[];
  status: "active" | "pending" | "expired";
  updatedAt: string;
  // GPU requirements (copied from the subnet for quick reference)
  minVramGb: number;
  recommendedGpu: string;
  // --- Miner's Ledger v2 (all optional so legacy rows stay valid) ---
  /** Work type the classifier detected (drives the GPU requirement). */
  workType?: string;
  /** Gross per-EARNING-miner monthly USD (before GPU + infra costs). */
  grossMonthlyUsd?: number;
  /** Net monthly USD after GPU rental + infra — the miner's bottom line. */
  netMonthlyUsd?: number;
  gpuCostMonthlyUsd?: number;
  infraCostMonthlyUsd?: number;
  netDailyTao?: number;
  /** Alpha token price in USD (pool ratio × TAO spot). */
  alphaPriceUsd?: number;
  /** Alpha/TAO price change vs ~24h ago (server-side ring buffer). */
  alphaChange24h?: number | null;
  /** TAO-side pool depth — exit liquidity for mined alpha. */
  liquidityTao?: number;
  /** Daily earnings ÷ alpha pool, in % — sell-pressure price impact. */
  slippagePct?: number | null;
  /** Registration burn cost (TAO) — demand signal for the seat. */
  burnCostTao?: number | null;
  /** Share of last-epoch incentive captured by the top 10% of UIDs (0-1). */
  top10IncentiveShare?: number | null;
  /** Median earning UID's share vs the mean — ≪1 means a whale takes most rewards. */
  rewardMedianShare?: number | null;
  /** Mean daily TAO over rewarded UIDs (the median-earner figure is estimatedDailyReward). */
  perEarningMeanDailyTao?: number;
  /** Share of registered miners that earned reward last epoch (0-1). */
  rewardedRatio?: number | null;
  /** Estimated weeks until a newcomer's bonds mature (ramp penalty). */
  rampWeeks?: number | null;
  freeSlots?: number | null;
  totalSlots?: number | null;
  immunityBlocks?: number | null;
}

export interface UserMiner {
  id: string;
  name: string;
  hotkey: string;
  netuid: number;
  subnetName: string;
  status: "active" | "inactive" | "pending" | "error";
  createdAt: string;
  totalEarnings: number; // TAO
  uptimePercent: number;
  rank: number;
  incentive: number;
  trust: number;
  emission: number;
  gpu: string;
  region: string;
}

export interface GPUModel {
  id: string;
  name: string;
  manufacturer: "NVIDIA" | "AMD";
  vramGb: number;
  cudaCores: number;
  fp16Tflops: number;
  tdpWatts: number;
  generation: string;
  tierLabel: "Entry" | "Mid" | "High" | "Flagship";
}

export interface GPUOffer {
  id: string;
  model: string;
  vramGb: number;
  provider: string;
  region: string;
  hourlyPrice: number;
  monthlyPrice: number;
  availability: "available" | "limited" | "scarce";
  isSpot: boolean;
  ramGb: number;
  cpuCores: number;
}

export interface Deployment {
  id: string;
  minerName: string;
  netuid: number;
  subnetName: string;
  gpu: string;
  provider: string;
  status:
    | "requested"
    | "approved"
    | "provisioning"
    | "deploying"
    | "started"
    | "stopped"
    | "failed";
  progress: number; // 0-100
  estimatedMonthlyCost: number;
  estimatedMonthlyRevenue: number;
  startedAt: string;
  steps: { name: string; label: string; status: "done" | "running" | "pending" | "failed" }[];
}

export interface RevenuePoint {
  day: string;
  tao: number;
  usd: number;
}

export interface EmissionShare {
  name: string;
  symbol: string;
  netuid: number;
  emission: number;
  color: string;
}

export interface WorkerStatus {
  name: string;
  status: "healthy" | "degraded" | "down";
  lastRun: string;
  latencyMs: number;
  tasksProcessed: number;
}

export type ViewKey =
  | "dashboard"
  | "opportunities"
  | "subnets"
  | "gpus"
  | "miners"
  | "deployments"
  | "monitoring"
  | "optimization"
  | "analytics"
  | "system";
