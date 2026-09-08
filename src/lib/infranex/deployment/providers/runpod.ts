import type { DeploymentConfig } from "../config";
import type { ProviderAdapter, ProvisionResult } from "./base";

/**
 * RunPod provider — creates REAL GPU pods via RunPod's GraphQL API.
 *
 * Uses the authenticated `podFindAndDeployOnDemand` mutation to spin up
 * an on-demand GPU server with the Bittensor miner docker image. Costs
 * real money — the caller must confirm before invoking provision().
 */

const RUNPOD_GRAPHQL = "https://api.runpod.io/graphql";

async function runpodGraphQL<T>(query: string): Promise<T> {
  const apiKey = process.env.RUNPOD_API_KEY;
  if (!apiKey) throw new Error("RUNPOD_API_KEY not configured");
  const res = await fetch(RUNPOD_GRAPHQL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`RunPod ${res.status} ${res.statusText}`);
  const j = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data as T;
}

// Map our canonical GPU model names to RunPod gpu_type_id values.
const GPU_TYPE_ID_MAP: Record<string, string> = {
  "RTX 4090": "NVIDIA GeForce RTX 4090",
  "RTX 3090": "NVIDIA GeForce RTX 3090",
  "RTX 3090 Ti": "NVIDIA GeForce RTX 3090 Ti",
  "RTX 4080": "NVIDIA GeForce RTX 4080",
  "RTX A6000": "NVIDIA RTX A6000",
  "RTX 6000 Ada": "NVIDIA RTX 6000 Ada",
  "RTX 5000 Ada": "NVIDIA RTX 5000 Ada",
  "A40": "NVIDIA A40",
  "L40S": "NVIDIA L40S",
  "L40": "NVIDIA L40",
  "L4": "NVIDIA L4",
  "A100 40GB": "NVIDIA A100-SXM4-40GB",
  "A100 80GB": "NVIDIA A100-SXM4-80GB",
  "A100 80GB PCIe": "NVIDIA A100 80GB PCIe",
  "H100 80GB": "NVIDIA H100 SXM",
  "H100 NVL": "NVIDIA H100 NVL",
  "H100 PCIe": "NVIDIA H100 PCIe",
  "H200 141GB": "NVIDIA H200 SXM",
  "B200 180GB": "NVIDIA B200",
  "B300 288GB": "NVIDIA B300 SXM6 AC",
  "MI300X 192GB": "AMD Instinct MI300X OAM",
};

export const RunPodProvider: ProviderAdapter = {
  name: "runpod",
  isLive: true,

  async provision(config: DeploymentConfig, deploymentId: string): Promise<ProvisionResult> {
    const gpuTypeId = GPU_TYPE_ID_MAP[config.gpu.model];
    if (!gpuTypeId) {
      throw new Error(`No RunPod GPU type mapping for "${config.gpu.model}"`);
    }

    const name = `infranex-${deploymentId.slice(-8)}`;
    const portsStr = config.docker.ports.join(",");
    const envVarsStr = config.docker.envVars
      .map((e) => `${e.name}=${e.value}`)
      .join("\n");

    const mutation = `mutation {
      podFindAndDeployOnDemand(input: {
        name: "${name}"
        imageName: "${config.docker.imageName}"
        gpuTypeId: "${gpuTypeId}"
        volumeInGb: 100
        volumePath: "/workspace"
        minMemoryInGb: ${config.docker.minMemoryGb}
        minVcpuCount: ${config.docker.minVcpuCount}
        ports: "${portsStr}"
        env: "${envVarsStr}"
        dockerArgs: "${config.docker.command.replace(/"/g, '\\"').replace(/\n/g, " ")}"
        supportPublicIp: true
      }) {
        id
        desiredStatus
        lastStatus
        machineId
      }
    }`;

    interface DeployResult {
      podFindAndDeployOnDemand: {
        id: string;
        desiredStatus: string;
        lastStatus: string;
        machineId?: string;
      } | null;
    }

    const result = await runpodGraphQL<DeployResult>(mutation);
    const pod = result.podFindAndDeployOnDemand;
    if (!pod) {
      throw new Error("RunPod returned null pod — no capacity or insufficient funds");
    }

    return {
      podId: pod.id,
      status: pod.lastStatus === "RUNNING" ? "running" : "pending",
      message: `RunPod pod ${pod.id} created — ${config.gpu.model}, desired ${pod.desiredStatus}, last ${pod.lastStatus}`,
    };
  },

  async getStatus(podId: string) {
    const query = `{
      pod(id: "${podId}") {
        id
        desiredStatus
        lastStatus
        runtime { ports { ip isIpPublic privateIp } }
      }
    }`;
    interface PodResult {
      pod: {
        id: string;
        desiredStatus: string;
        lastStatus: string;
        runtime?: { ports?: Array<{ ip: string; isIpPublic: boolean; privateIp: string }> };
      } | null;
    }
    const result = await runpodGraphQL<PodResult>(query);
    const pod = result.pod;
    if (!pod) return { status: "terminated" };
    const publicIp = pod.runtime?.ports?.find((p) => p.isIpPublic)?.ip;
    return {
      status: pod.lastStatus?.toLowerCase() ?? "pending",
      ipAddress: publicIp,
    };
  },

  async terminate(podId: string) {
    const mutation = `mutation { podTerminate(input: { podId: "${podId}" }) { id lastStatus } }`;
    interface TerminateResult {
      podTerminate: { id: string; lastStatus: string } | null;
    }
    await runpodGraphQL<TerminateResult>(mutation);
    return { success: true, message: `RunPod pod ${podId} terminated` };
  },
};
