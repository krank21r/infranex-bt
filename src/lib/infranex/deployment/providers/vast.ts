import type { DeploymentConfig } from "../config";
import type { ProviderAdapter, ProvisionResult, ProvisionContext } from "./base";
import { assertHotkeyOnly } from "../ssh-keys";
import { getProviderKey } from "@/lib/infranex/providers";

/**
 * TIER4 — Vast.ai rental adapter. Completes the provider story: Vast already
 * supplied live offers to the catalog; this adapter lets the wizard actually
 * RENT them (mode "vast").
 *
 * Mechanics (console.vast.ai API v0):
 *   - provision: PUT /instances/?client_id=me with the chosen bundle id,
 *     the deployment's docker image + env contract, and an onstart script
 *     that installs our ephemeral ed25519 public key into /root/.ssh so the
 *     real-setup runner (and the Node Daemon bridge) can SSH in — the same
 *     contract RunPod gets natively via its `publicKey` argument.
 *   - getStatus: GET /instances/{id}/ → cur_state mapping; SSH port comes
 *     from the instance's port map (container 22 → host port).
 *   - terminate: DELETE /instances/{id}/.
 *
 * HARD GATE: provision() refuses configs violating the hotkey-only policy
 * (no coldkeys / mnemonics / private keys on machines), identical to RunPod.
 * Spot/interruptible bundles are refused at provision time too — long-running
 * miners need interruptible-resistant capacity.
 */

const VAST_API = "https://console.vast.ai/api/v0";

type VastFetch = (url: string, init: RequestInit) => Promise<Response>;

async function vastFetchImpl(path: string, init: RequestInit): Promise<Response> {
  const resolved = await getProviderKey("vast");
  if (!resolved) {
    throw new Error("Vast.ai API key not configured — add it in GPU catalog → Provider API keys");
  }
  return fetch(`${VAST_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${resolved.key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

/** "vast-12345" (catalog offer id) → 12345. Null when not a vast offer id. */
export function parseVastBundleId(offerId: string): number | null {
  const m = /^vast-(\d+)$/.exec(offerId);
  return m ? Number(m[1]) : null;
}

/**
 * Pure builder for the onstart script — installs the SSH public key and
 * makes sure an sshd is listening on 22. Unit-tested (key must appear,
 * no shell-quoting surprises).
 */
export function buildOnstartScript(publicKey?: string): string {
  const base = [
    "set -x",
    "mkdir -p /root/.ssh",
    "chmod 700 /root/.ssh",
    "touch /root/.ssh/authorized_keys",
    "chmod 600 /root/.ssh/authorized_keys",
  ];
  if (publicKey) {
    base.push(`echo '${publicKey.replace(/'/g, "")}' >> /root/.ssh/authorized_keys`);
  }
  base.push(
    "if ! command -v sshd >/dev/null 2>&1; then (apt-get update -qq && apt-get install -y -qq openssh-server) || true; fi",
    "(service ssh start || /etc/init.d/ssh start || /usr/sbin/sshd) 2>/dev/null || true",
    "echo onstart-done"
  );
  return base.join("\n");
}

/** Pure builder for the PUT /instances/ ask body. Unit-tested. */
export function buildInstanceAsk(input: {
  bundleId: number;
  imageName: string;
  diskGb: number;
  env: Record<string, string>;
  onstart: string;
  label: string;
}): Record<string, unknown> {
  return {
    client_id: "me",
    id: input.bundleId,
    image: input.imageName,
    disk: Math.max(10, Math.round(input.diskGb || 20)),
    env: input.env,
    onstart: input.onstart,
    label: input.label.slice(0, 64),
    // On-demand only — a long-running miner must not land on interruptible capacity.
    interruptible: false,
  };
}

interface VastInstance {
  id?: number;
  cur_state?: string;
  public_ipaddr?: string | null;
  ports?: Record<string, { host?: number } | number> | null;
  ssh_port?: number | null;
  net?: { ssh_port?: number | null };
}

function mapInstanceState(cur: string | undefined): string {
  switch (cur) {
    case "running":
      return "running";
    case "exited":
    case "stopped":
    case "destroyed":
      return "terminated";
    default:
      // "created", "provisioning", unknown — still coming up.
      return "pending";
  }
}

function extractSshPort(inst: VastInstance): number | undefined {
  const portMap = inst.ports?.["22"];
  const mapped = typeof portMap === "object" && portMap !== null ? portMap.host : undefined;
  return mapped ?? inst.ssh_port ?? inst.net?.ssh_port ?? undefined;
}

interface ProvisionDeps {
  fetchImpl?: VastFetch;
}

export function createVastProvider(deps?: ProvisionDeps): ProviderAdapter {
  const doFetch = deps?.fetchImpl ?? vastFetchImpl;

  async function call<T>(path: string, init: RequestInit): Promise<T> {
    const res = await doFetch(path.startsWith("http") ? path : `${VAST_API}${path}`, init);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Vast.ai ${res.status} ${res.statusText}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }
    return (await res.json()) as T;
  }

  return {
    name: "vast",
    isLive: true,

    async provision(
      config: DeploymentConfig,
      deploymentId: string,
      ctx?: ProvisionContext
    ): Promise<ProvisionResult> {
      // ---- Security + preflight gates -----------------------------------
      const violations = assertHotkeyOnly(config);
      if (violations.length) {
        throw new Error(
          `Hotkey-only policy violation: ${violations.map((v) => `${v.label} in ${v.where}`).join(", ")}`
        );
      }
      const bundleId = parseVastBundleId(config.gpu.offerId ?? "");
      if (bundleId === null) {
        throw new Error(
          `Vast provisioning needs a Vast bundle offer (got "${config.gpu.offerId ?? "none"}") — pick a Vast.ai offer in the deploy wizard`
        );
      }

      const env: Record<string, string> = {};
      for (const e of config.docker.envVars) {
        if (!e.secret) env[e.name] = e.value;
      }

      const ask = buildInstanceAsk({
        bundleId,
        imageName: config.docker.imageName,
        diskGb: config.docker.diskGb,
        env,
        onstart: buildOnstartScript(ctx?.sshPublicKey),
        label: `infranex-${deploymentId.slice(-8)}`,
      });

      // PUT /instances/?client_id=me — create from bundle.
      const j = await call<{ success?: boolean; new_instance?: VastInstance; id?: number }>(
        `/instances/?client_id=me`,
        { method: "PUT", body: JSON.stringify(ask) }
      );
      const newId = j.new_instance?.id ?? j.id;
      if (!newId) {
        throw new Error("Vast.ai did not return an instance id — check the bundle and try again");
      }
      return {
        podId: String(newId),
        status: "pending",
        message: `Vast.ai instance ${newId} created from bundle ${bundleId} (${config.gpu.model}) — polling until RUNNING`,
      };
    },

    async getStatus(podId: string) {
      const j = await call<{ instances?: VastInstance[] }>(`/instances/${podId}/`, { method: "GET" });
      const inst = j.instances?.[0];
      if (!inst) throw new Error(`Vast.ai instance ${podId} not found`);
      return {
        status: mapInstanceState(inst.cur_state),
        ipAddress: inst.public_ipaddr ?? undefined,
        sshPort: extractSshPort(inst),
      };
    },

    async terminate(podId: string) {
      try {
        await call(`/instances/${podId}/`, { method: "DELETE" });
        return { success: true, message: `Vast.ai instance ${podId} destroyed (billing stopped)` };
      } catch (e) {
        return {
          success: false,
          message: `Vast.ai termination failed: ${e instanceof Error ? e.message : "unknown error"}`,
        };
      }
    },
  };
}

export const VastProvider: ProviderAdapter = createVastProvider();
