import type { DeploymentConfig } from "../config";

/**
 * GPU Provider interface — each provider (RunPod, Vast.ai, mock) implements
 * this to provision, configure, deploy, and terminate a GPU server.
 */

export interface ProvisionResult {
  podId: string;
  ipAddress?: string;
  /** SSH port when the provider exposes one (RunPod runtime.sshPort). */
  sshPort?: number;
  status: "running" | "pending" | "failed";
  message: string;
}

/** Optional context handed to provision() — e.g. the ephemeral SSH public key. */
export interface ProvisionContext {
  sshPublicKey?: string;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly isLive: boolean;

  /** Create the GPU pod/server. */
  provision(
    config: DeploymentConfig,
    deploymentId: string,
    ctx?: ProvisionContext
  ): Promise<ProvisionResult>;

  /** Check the pod's current status. */
  getStatus(
    podId: string
  ): Promise<{ status: string; ipAddress?: string; sshPort?: number }>;

  /** Terminate/destroy the pod. */
  terminate(podId: string): Promise<{ success: boolean; message: string }>;
}
