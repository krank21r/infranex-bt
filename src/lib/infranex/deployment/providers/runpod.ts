import type { DeploymentConfig } from "../config";
import type { ProviderAdapter, ProvisionResult, ProvisionContext } from "./base";
import { assertHotkeyOnly, HOTKEY_ONLY_POLICY_TEXT } from "../ssh-keys";


/**
 * RunPod provider v2 — adapted to the CURRENT RunPod GraphQL schema:
 *   - `env` is a list of {key, value} objects (was a newline-joined string)
 *   - `dockerArgs` no longer exists — runtime command is carried by the
 *     image + env contract
 *   - `publicKey` injects our ephemeral ed25519 SSH key into the pod
 *   - `supportPrivateIp` requested for SSH-over-private-fabric
 *
 * HARD GATE: provision() refuses to ship configs that violate the
 * hotkey-only policy (no coldkeys / mnemonics / private keys on machines).
 */

const RUNPOD_GRAPHQL = "https://api.runpod.io/graphql";

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

export function resolveGpuTypeId(model: string): string | null {
  return GPU_TYPE_ID_MAP[model] ?? null;
}

export interface DeployInput {
  name: string;
  imageName: string;
  gpuTypeId: string;
  envVars: { key: string; value: string }[];
  ports: string;
  publicKey?: string;
  volumeInGb: number;
  minMemoryInGb: number;
  minVcpuCount: number;
}

/** Pure builder — unit-testable against the current RunPod schema. */
export function buildDeployMutation(input: DeployInput): string {
  const envJson = JSON.stringify(
    input.envVars.map((e) => ({ key: e.key, value: e.value }))
  ).replace(/"/g, '\\"');
  const publicKeyArg = input.publicKey
    ? `, publicKey: "${input.publicKey.replace(/"/g, '\\"')}"`
    : "";
  return `mutation Deploy {
  podFindAndDeployOnDemand(input: {
    name: "${input.name}"
    imageName: "${input.imageName}"
    gpuTypeId: "${input.gpuTypeId}"
    volumeInGb: ${input.volumeInGb}
    volumeMountPath: "/workspace"
    minMemoryInGb: ${input.minMemoryInGb}
    minVcpuCount: ${input.minVcpuCount}
    ports: "${input.ports}"
    env: "${envJson}"
    supportPublicIp: true
    supportPrivateIp: false${publicKeyArg}
  }) {
    id
    desiredStatus
    lastStatus
    machineId
    costPerHr
  }
}`;
}

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
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RunPod ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  const j = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };
  if (j.errors?.length) throw new Error(j.errors[0].message);
  return j.data as T;
}

export const RunPodProvider: ProviderAdapter = {
  name: "runpod",
  isLive: true,

  async provision(
    config: DeploymentConfig,
    deploymentId: string,
    ctx?: ProvisionContext
  ): Promise<ProvisionResult> {
    // ---- Security gate --------------------------------------------------
    const violations = assertHotkeyOnly(config);
    if (violations.length) {
      throw new Error(
        `Hotkey-only policy violation: ${violations
          .map((v) => `${v.label} in ${v.where}`)
          .join("; ")}. ${HOTKEY_ONLY_POLICY_TEXT}`
      );
    }

    const gpuTypeId = resolveGpuTypeId(config.gpu.model);
    if (!gpuTypeId) {
      throw new Error(`No RunPod GPU type mapping for "${config.gpu.model}"`);
    }

    // The engine generates an ephemeral ed25519 keypair per deployment and
    // passes the public key through ctx — the pod trusts ONLY this key.
    const publicKey = ctx?.sshPublicKey;

    const mutation = buildDeployMutation({
      name: `infranex-${deploymentId.slice(-8)}`,
      imageName: config.docker.imageName,
      gpuTypeId,
      envVars: [
        ...config.docker.envVars.map((e) => ({ key: e.name, value: e.value })),
        // Network contract — hotkey (public) only, per policy.
        { key: "NETUID", value: String(config.miner.netuid) },
        { key: "NETWORK", value: config.miner.network },
        { key: "HOTKEY", value: config.miner.hotkeyName },
        { key: "AXON_PORT", value: String(config.miner.axonPort) },
      ],
      ports: config.docker.ports.join(","),
      publicKey,
      volumeInGb: 100,
      minMemoryInGb: config.docker.minMemoryGb,
      minVcpuCount: config.docker.minVcpuCount,
    });

    interface DeployResult {
      podFindAndDeployOnDemand: {
        id: string;
        desiredStatus: string;
        lastStatus: string;
        machineId?: string;
        costPerHr?: number;
      } | null;
    }

    const result = await runpodGraphQL<DeployResult>(mutation);
    const pod = result.podFindAndDeployOnDemand;
    if (!pod) {
      throw new Error(
        "RunPod returned null pod — no capacity, insufficient funds, or invalid request"
      );
    }

    return {
      podId: pod.id,
      status: pod.lastStatus === "RUNNING" ? "running" : "pending",
      message: `RunPod pod ${pod.id} created — ${config.gpu.model}, desired ${pod.desiredStatus}, last ${pod.lastStatus}${pod.costPerHr ? `, $${pod.costPerHr.toFixed(3)}/hr` : ""}`,
    };
  },

  async getStatus(podId: string) {
    const query = `{
      pod(id: "${podId}") {
        id
        desiredStatus
        lastStatus
        runtime {
          ports { ip isIpPublic privateIp }
          sshPort
        }
      }
    }`;
    interface PodResult {
      pod: {
        id: string;
        desiredStatus: string;
        lastStatus: string;
        runtime?: {
          ports?: Array<{ ip: string; isIpPublic: boolean; privateIp: string }>;
          sshPort?: number;
        };
      } | null;
    }
    const result = await runpodGraphQL<PodResult>(query);
    const pod = result.pod;
    if (!pod) return { status: "terminated" as const };
    const publicEntry = pod.runtime?.ports?.find((p) => p.isIpPublic);
    return {
      status: (pod.lastStatus?.toLowerCase() ?? "pending") as ProvisionResult["status"],
      ipAddress: publicEntry?.ip,
      sshPort: pod.runtime?.sshPort ?? undefined,
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
