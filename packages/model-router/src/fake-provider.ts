import type {
  ModelProvider,
  ModelResult,
  ProviderHealth,
  StructuredModelRequest
} from "./provider";

export interface FakeFixture {
  data?: unknown;
  rawResponse?: string;
  finishReason?: string;
  validationErrors?: string[];
  latencyMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  /** When set, generateStructured rejects with this error message. */
  throws?: string;
  /** Dynamic builder from the request payload (used by analysis.v1.from-evidence). */
  build?: (request: StructuredModelRequest) => unknown;
}

/**
 * Deterministic provider used for all tests before any live model call. It
 * selects responses by explicit fixtureKey rather than inspecting prompt text.
 */
export class FakeProvider implements ModelProvider {
  readonly providerId = "fake";
  private readonly fixtures = new Map<string, FakeFixture>();
  generateCallCount = 0;

  register(key: string, fixture: FakeFixture): this {
    this.fixtures.set(key, fixture);
    return this;
  }

  resetCallCount(): void {
    this.generateCallCount = 0;
  }

  async healthCheck(): Promise<ProviderHealth> {
    return {
      providerId: this.providerId,
      ok: true,
      detail: "fake provider always available",
      checkedAt: new Date().toISOString()
    };
  }

  async generateStructured<T = unknown>(request: StructuredModelRequest): Promise<ModelResult<T>> {
    this.generateCallCount += 1;
    const key = request.fixtureKey ?? "";
    const fixture = this.fixtures.get(key);
    if (!fixture) {
      throw new Error(`FakeProvider: no fixture registered for key "${key}"`);
    }
    if (fixture.throws) {
      throw new Error(fixture.throws);
    }

    const data = fixture.build ? fixture.build(request) : fixture.data;
    const rawResponse =
      fixture.rawResponse ?? (typeof data === "string" ? data : JSON.stringify(data ?? null));

    return {
      ok: (fixture.validationErrors?.length ?? 0) === 0,
      data: data as T,
      rawResponse,
      usage: {
        inputTokens: fixture.inputTokens ?? 100,
        outputTokens: fixture.outputTokens ?? 200,
        costUsd: fixture.costUsd ?? 0
      },
      finishReason: fixture.finishReason ?? "stop",
      providerRequestId: `fake_${key || "default"}_${this.generateCallCount}`,
      latencyMs: fixture.latencyMs ?? 5,
      validationErrors: fixture.validationErrors
    };
  }
}
