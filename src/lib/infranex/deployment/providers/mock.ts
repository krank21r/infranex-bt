import type { DeploymentConfig } from "../config";
import type { ProviderAdapter, ProvisionResult } from "./base";

/**
 * Mock provider — simulates the full provisioning lifecycle without
 * touching any real API or spending money. Returns realistic-looking
 * pod IDs and statuses so the deployment engine can demonstrate the
 * complete state machine.
 */

function randomPodId(): string {
  return `mock-${Math.random().toString(36).slice(2, 12)}`;
}

function randomIp(): string {
  return `${Math.floor(Math.random() * 200 + 20)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 254 + 1)}`;
}

export const MockProvider: ProviderAdapter = {
  name: "mock",
  isLive: false,

  async provision(config: DeploymentConfig, _deploymentId: string): Promise<ProvisionResult> {
    // Simulate the time to create a pod (~1-2s)
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));
    return {
      podId: randomPodId(),
      ipAddress: randomIp(),
      status: "running",
      message: `Mock pod created — ${config.gpu.model} on ${config.gpu.provider}, ${config.gpu.vramGb}GB VRAM, region ${config.gpu.region}`,
    };
  },

  async getStatus(podId: string) {
    return { status: "running", ipAddress: "0.0.0.0" };
  },

  async terminate(podId: string) {
    await new Promise((r) => setTimeout(r, 300));
    return { success: true, message: `Mock pod ${podId} terminated` };
  },
};
