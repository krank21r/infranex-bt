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
}

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
  | "analytics"
  | "system";
