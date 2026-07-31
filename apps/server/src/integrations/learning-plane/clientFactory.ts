import {
  LearningPlaneAgentClient,
  LearningPlaneBootstrapClient
} from "@learning-plane/client";
import type { LearningPlaneAdapterConfig } from "./config.js";

export function createBootstrapClient(
  config: LearningPlaneAdapterConfig,
  operatorToken: string
): LearningPlaneBootstrapClient {
  return new LearningPlaneBootstrapClient({
    baseUrl: config.baseUrl,
    operatorToken,
    timeoutMs: config.requestTimeoutMs
  });
}

export function createAgentClient(
  config: LearningPlaneAdapterConfig,
  agentApiKey: string
): LearningPlaneAgentClient {
  return new LearningPlaneAgentClient({
    baseUrl: config.baseUrl,
    agentApiKey,
    timeoutMs: config.requestTimeoutMs
  });
}

export async function probeLearningPlaneApiCompat(
  baseUrl: string,
  timeoutMs: number
): Promise<{ ok: boolean; apiCompat: string | null; serviceVersion: string | null; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/health`, {
      signal: controller.signal
    });
    if (!response.ok) {
      return { ok: false, apiCompat: null, serviceVersion: null, error: `HTTP ${response.status}` };
    }
    const body = (await response.json()) as {
      apiCompat?: string;
      serviceVersion?: string;
    };
    return {
      ok: true,
      apiCompat: typeof body.apiCompat === "string" ? body.apiCompat : null,
      serviceVersion: typeof body.serviceVersion === "string" ? body.serviceVersion : null
    };
  } catch (error) {
    return {
      ok: false,
      apiCompat: null,
      serviceVersion: null,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    clearTimeout(timer);
  }
}
