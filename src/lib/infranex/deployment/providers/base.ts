import type { DeploymentConfig } from "../config";

/**
 * GPU Provider interface — each provider (RunPod, Vast.ai, mock) implements
 * this to provision, configure, deploy, and terminate a GPU server.
 */

export interface ProvisionResult {
  podId: string;
  ipAddress?: string;
  status: "running" | "pending" | "failed";
  message: string;
}

export interface ProviderAdapter {
  readonly name: string;
  readonly isLive: boolean;

  /** Create the GPU pod/server. */
  provision(config: DeploymentConfig, deploymentId: string): Promise<ProvisionResult>;

  /** Check the pod's current status. */
  getStatus(podId: string): Promise<{ status: string; ipAddress?: string }>;

  /** Terminate/destroy the pod. */
  terminate(podId: string): Promise<{ success: boolean; message: string }>;
}
