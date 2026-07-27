export interface ModelProfileDefinition {
  profileId: string;
  provider: string;
  model: string;
  enabled: boolean;
  temperature: number;
  tokenCap: number | null;
  costCapUsd: number | null;
  timeoutSeconds: number;
  fallbackProfileId: string | null;
  description: string;
}

/**
 * Default model profiles. Only the mock profile is enabled by default; live
 * provider profiles become enabled through configuration (DEEPSEEK feature
 * flag), never automatically.
 */
export const DEFAULT_MODEL_PROFILES: ModelProfileDefinition[] = [
  {
    profileId: "mock-only",
    provider: "fake",
    model: "fake-structured",
    enabled: true,
    temperature: 0,
    tokenCap: 100_000,
    costCapUsd: 0,
    timeoutSeconds: 60,
    fallbackProfileId: null,
    description: "Deterministic fake provider. Used for all tests and default runs."
  },
  {
    profileId: "budget-deepseek",
    provider: "deepseek",
    model: "deepseek-chat",
    enabled: false,
    temperature: 0,
    tokenCap: 60_000,
    costCapUsd: 0.5,
    timeoutSeconds: 180,
    fallbackProfileId: "mock-only",
    description: "Lower-cost DeepSeek profile (disabled until DeepSeek is enabled)."
  },
  {
    profileId: "recommended-deepseek",
    provider: "deepseek",
    model: "deepseek-chat",
    enabled: false,
    temperature: 0,
    tokenCap: 120_000,
    costCapUsd: 2,
    timeoutSeconds: 240,
    fallbackProfileId: "budget-deepseek",
    description: "Recommended DeepSeek profile (disabled until DeepSeek is enabled)."
  }
];
