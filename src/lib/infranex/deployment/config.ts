import type { Subnet, GPUOffer } from "../types";

/**
 * Deployment config builder.
 *
 * Takes a Bittensor subnet + a GPU offer and produces the full deployment
 * configuration: docker image, miner command, ports, env vars, cost
 * projection. This is the exact config you'd run on a real GPU server.
 */

export interface DeploymentConfig {
  subnet: {
    netuid: number;
    name: string;
    symbol: string;
    category: string;
    minVramGb: number;
    recommendedGpu: string;
  };
  gpu: {
    model: string;
    vramGb: number;
    provider: string;
    hourlyPrice: number;
    monthlyPrice: number;
    region: string;
  };
  docker: {
    imageName: string;
    runtime: "nvidia";
    ports: string[];
    volumes: { path: string; sizeGb: number }[];
    envVars: { name: string; value: string; secret: boolean }[];
    command: string;
    minMemoryGb: number;
    minVcpuCount: number;
    diskGb: number;
  };
  miner: {
    network: "finney" | "test";
    netuid: number;
    walletName: string;
    hotkeyName: string;
    axonPort: number;
    prometheusPort: number;
    subtensorNetwork: string;
    extraArgs: string[];
  };
  cost: {
    hourlyUsd: number;
    monthlyUsd: number;
    estimatedMonthlyRevenueUsd: number;
    estimatedRoiPercent: number;
  };
  requirements: {
    minVramGb: number;
    pythonVersion: string;
    cudaVersion: string;
    dockerRequired: boolean;
    nvidiaRuntimeRequired: boolean;
  };
}

// Map subnet categories to docker images + miner commands.
// These are representative configs based on common Bittensor subnet patterns.
const SUBNET_TEMPLATES: Record<
  string,
  { image: string; command: string; extraArgs: string[]; python: string; cuda: string }
> = {
  Inference: {
    image: "bittensor/subnet:latest",
    command: "python neurons/miner.py --no_auto_weights_update",
    extraArgs: ["--neuron.device", "cuda", "--neuron.num_workers", "1"],
    python: "3.10",
    cuda: "12.1",
  },
  Vision: {
    image: "bittensor/vision-subnet:latest",
    command: "python neurons/miner.py --neuron.model_name diffusion",
    extraArgs: ["--neuron.device", "cuda", "--neuron.batch_size", "4"],
    python: "3.10",
    cuda: "12.1",
  },
  Training: {
    image: "bittensor/training-subnet:latest",
    command: "python neurons/miner.py --neuron.compile",
    extraArgs: ["--neuron.device", "cuda", "--neuron.world_size", "1"],
    python: "3.10",
    cuda: "12.2",
  },
  Data: {
    image: "bittensor/data-subnet:latest",
    command: "python neurons/miner.py",
    extraArgs: ["--neuron.device", "cuda"],
    python: "3.10",
    cuda: "12.1",
  },
  default: {
    image: "bittensor/bittensor:latest",
    command: "python neurons/miner.py",
    extraArgs: ["--neuron.device", "cuda"],
    python: "3.10",
    cuda: "12.1",
  },
};

const CATEGORY_REVENUE_ESTIMATE: Record<string, number> = {
  Training: 3200,
  Vision: 2800,
  Multimodal: 3400,
  Inference: 1800,
  Data: 1200,
  Audio: 1400,
  Compute: 900,
  Science: 1600,
  Security: 1500,
  DeFi: 1100,
};

export function buildDeploymentConfig(
  subnet: Subnet,
  offer: GPUOffer,
  options?: { hotkey?: string; walletName?: string; network?: "finney" | "test" }
): DeploymentConfig {
  const template = SUBNET_TEMPLATES[subnet.category] ?? SUBNET_TEMPLATES.default;
  const network = options?.network ?? "finney";
  const walletName = options?.walletName ?? "infranex";
  const hotkeyName = "default";
  const axonPort = 8091;
  const prometheusPort = 8092;

  const hotkey = options?.hotkey ?? "";

  const envVars = [
    { name: "BT_NETWORK", value: network, secret: false },
    { name: "BT_NETUID", value: String(subnet.netuid), secret: false },
    { name: "BT_WALLET_NAME", value: walletName, secret: false },
    { name: "BT_HOTKEY_NAME", value: hotkeyName, secret: false },
    ...(hotkey
      ? [{ name: "BT_HOTKEY_SS58", value: hotkey, secret: true }]
      : []),
    { name: "NVIDIA_VISIBLE_DEVICES", value: "all", secret: false },
    { name: "PYTHONUNBUFFERED", value: "1", secret: false },
  ];

  const command = `${template.command} \
--subtensor.network ${network} \
--netuid ${subnet.netuid} \
--wallet.name ${walletName} \
--wallet.hotkey ${hotkeyName} \
--axon.port ${axonPort} \
--logging.debug \
${template.extraArgs.join(" \\\n  ")}`;

  const monthlyUsd = offer.monthlyPrice || Math.round(offer.hourlyPrice * 730);
  const estimatedRevenue =
    CATEGORY_REVENUE_ESTIMATE[subnet.category] ?? 1500;
  const roi =
    monthlyUsd > 0
      ? Math.round(((estimatedRevenue - monthlyUsd) / monthlyUsd) * 100)
      : 0;

  return {
    subnet: {
      netuid: subnet.netuid,
      name: subnet.name,
      symbol: subnet.symbol,
      category: subnet.category,
      minVramGb: subnet.minVramGb,
      recommendedGpu: subnet.recommendedGpu,
    },
    gpu: {
      model: offer.model,
      vramGb: offer.vramGb,
      provider: offer.provider,
      hourlyPrice: offer.hourlyPrice,
      monthlyPrice: monthlyUsd,
      region: offer.region,
    },
    docker: {
      imageName: template.image,
      runtime: "nvidia",
      ports: [`${axonPort}/http`, `${prometheusPort}/http`],
      volumes: [{ path: "/workspace", sizeGb: 100 }],
      envVars,
      command,
      minMemoryGb: Math.max(64, offer.vramGb),
      minVcpuCount: Math.max(8, Math.ceil(offer.vramGb / 8)),
      diskGb: 200,
    },
    miner: {
      network,
      netuid: subnet.netuid,
      walletName,
      hotkeyName,
      axonPort,
      prometheusPort,
      subtensorNetwork: network,
      extraArgs: template.extraArgs,
    },
    cost: {
      hourlyUsd: offer.hourlyPrice,
      monthlyUsd,
      estimatedMonthlyRevenueUsd: estimatedRevenue,
      estimatedRoiPercent: roi,
    },
    requirements: {
      minVramGb: subnet.minVramGb,
      pythonVersion: template.python,
      cudaVersion: template.cuda,
      dockerRequired: true,
      nvidiaRuntimeRequired: true,
    },
  };
}

/** Serialize for SQLite storage. */
export function serializeConfig(cfg: DeploymentConfig): string {
  return JSON.stringify(cfg);
}

/** Deserialize from SQLite. */
export function deserializeConfig(s: string): DeploymentConfig | null {
  try {
    return JSON.parse(s) as DeploymentConfig;
  } catch {
    return null;
  }
}
