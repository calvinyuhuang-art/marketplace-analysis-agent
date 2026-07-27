export interface ProviderHealth {
  providerId: string;
  ok: boolean;
  detail?: string;
  checkedAt: string;
}

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface StructuredModelRequest {
  model: string;
  systemInstructions: string;
  promptPayload: unknown;
  schemaVersion: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  correlationId?: string;
  /** Fixture key used by the fake provider to select a deterministic response. */
  fixtureKey?: string;
}

export interface ModelResult<T = unknown> {
  ok: boolean;
  data?: T;
  rawResponse: string;
  usage: ModelUsage;
  finishReason: string;
  providerRequestId: string;
  latencyMs: number;
  validationErrors?: string[];
}

/**
 * Model-independent provider interface. The runtime depends only on this, so
 * the underlying model is a replaceable component. Structured generation is
 * introduced in later milestones; M0 only exercises health checks.
 */
export interface ModelProvider {
  readonly providerId: string;
  healthCheck(): Promise<ProviderHealth>;
  generateStructured<T = unknown>(request: StructuredModelRequest): Promise<ModelResult<T>>;
}
