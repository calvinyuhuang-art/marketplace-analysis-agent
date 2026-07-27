import type {
  ModelProvider,
  ModelResult,
  ProviderHealth,
  StructuredModelRequest
} from "./provider";

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  /** USD per 1M input tokens — configurable pricing table. */
  inputUsdPer1M?: number;
  outputUsdPer1M?: number;
  fetchImpl?: typeof fetch;
}

/**
 * DeepSeek chat provider for structured JSON generation. Secrets come only from
 * config; disabled entirely when MAA_DEEPSEEK_ENABLED is false.
 */
export class DeepSeekProvider implements ModelProvider {
  readonly providerId = "deepseek";
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultModel: string;
  private readonly inputUsdPer1M: number;
  private readonly outputUsdPer1M: number;
  private readonly fetchImpl: typeof fetch;

  constructor(config: DeepSeekConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? "https://api.deepseek.com").replace(/\/$/, "");
    this.defaultModel = config.defaultModel ?? "deepseek-chat";
    this.inputUsdPer1M = config.inputUsdPer1M ?? 0.14;
    this.outputUsdPer1M = config.outputUsdPer1M ?? 0.28;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async healthCheck(): Promise<ProviderHealth> {
    if (!this.apiKey) {
      return {
        providerId: this.providerId,
        ok: false,
        detail: "API key missing",
        checkedAt: new Date().toISOString()
      };
    }
    return {
      providerId: this.providerId,
      ok: true,
      detail: "configured",
      checkedAt: new Date().toISOString()
    };
  }

  async generateStructured<T = unknown>(request: StructuredModelRequest): Promise<ModelResult<T>> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs);

    try {
      const body = {
        model: request.model || this.defaultModel,
        temperature: request.temperature,
        max_tokens: request.maxOutputTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: request.systemInstructions },
          { role: "user", content: JSON.stringify(request.promptPayload) }
        ]
      };

      const res = await this.fetchImpl(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const rawText = await res.text();
      if (!res.ok) {
        throw new Error(`DeepSeek HTTP ${res.status}: ${rawText.slice(0, 500)}`);
      }

      const json = JSON.parse(rawText) as {
        id?: string;
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };

      const content = json.choices?.[0]?.message?.content ?? "";
      let data: T | undefined;
      let validationErrors: string[] | undefined;
      try {
        data = JSON.parse(content) as T;
      } catch {
        validationErrors = ["Response content is not valid JSON"];
      }

      const inputTokens = json.usage?.prompt_tokens ?? 0;
      const outputTokens = json.usage?.completion_tokens ?? 0;
      const costUsd =
        (inputTokens / 1_000_000) * this.inputUsdPer1M +
        (outputTokens / 1_000_000) * this.outputUsdPer1M;

      return {
        ok: !validationErrors,
        data,
        rawResponse: content || rawText,
        usage: { inputTokens, outputTokens, costUsd },
        finishReason: json.choices?.[0]?.finish_reason ?? "stop",
        providerRequestId: json.id ?? `deepseek_${Date.now()}`,
        latencyMs: Date.now() - started,
        validationErrors
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
