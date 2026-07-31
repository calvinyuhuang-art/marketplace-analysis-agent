import { z } from "zod";

const booleanFromEnv = z
  .union([z.boolean(), z.string()])
  .transform((v) =>
    typeof v === "boolean" ? v : ["1", "true", "yes", "on"].includes(v.toLowerCase())
  );

/**
 * Named configuration profiles apply opinionated defaults before env overlay.
 * External/cloud multi-tenancy is intentionally out of scope.
 */
export const ConfigProfile = z.enum(["development", "test", "local-hardened"]);
export type ConfigProfile = z.infer<typeof ConfigProfile>;

export const CONFIG_PROFILE_DEFAULTS: Record<
  ConfigProfile,
  Partial<Record<string, string>>
> = {
  development: {
    MAA_LOG_LEVEL: "info",
    MAA_DEFAULT_MODEL_PROFILE: "mock-only"
  },
  test: {
    MAA_LOG_LEVEL: "warn",
    MAA_WORKER_POLL_MS: "20",
    MAA_HEARTBEAT_MS: "50",
    MAA_FAKE_PHASE_DELAY_MS: "5",
    MAA_STALE_EXECUTION_MS: "200",
    MAA_DEFAULT_MODEL_PROFILE: "mock-only",
    MAA_DEEPSEEK_ENABLED: "false"
  },
  "local-hardened": {
    MAA_LOG_LEVEL: "warn",
    MAA_HOST: "127.0.0.1",
    MAA_ARTIFACT_RETENTION_DAYS: "30",
    MAA_REQUIRE_API_KEY: "true",
    MAA_DEFAULT_MODEL_PROFILE: "mock-only",
    MAA_LEARNING_PLANE_ENABLED: "false",
    MAA_LEARNING_PLANE_PUBLISH_ENABLED: "false",
    MAA_LEARNING_PLANE_RECEIVE_ENABLED: "false",
    MAA_LEARNING_PLANE_GOVERNANCE_BRIDGE_ENABLED: "false",
    MAA_LEARNING_PLANE_GOVERNANCE_PUBLISH_ENABLED: "false",
    MAA_LEARNING_PLANE_GOVERNANCE_RECEIVE_ENABLED: "false",
    MAA_LEARNING_PLANE_VALIDATION_RECEIPT_ENABLED: "false",
    MAA_LEARNING_PLANE_ACTIVATION_RECEIPT_ENABLED: "false",
    MAA_LEARNING_PLANE_REPLAY_BRIDGE_ENABLED: "false",
    MAA_LEARNING_PLANE_REPLAY_EXECUTE_ENABLED: "false",
    MAA_LEARNING_PLANE_REPLAY_REPORT_ENABLED: "false",
    MAA_LEARNING_PLANE_GRANDFATHER_REGISTER_ENABLED: "false",
    MAA_LEARNING_PLANE_PUBLICATION_BRIDGE_ENABLED: "false",
    MAA_LEARNING_PLANE_PUBLICATION_SUBMIT_ENABLED: "false",
    MAA_LEARNING_PLANE_PUBLICATION_RECONCILE_ENABLED: "false",
    MAA_LEARNING_PLANE_DISCOVERY_ENABLED: "false",
    MAA_LEARNING_PLANE_PACKAGE_FETCH_ENABLED: "false",
    MAA_LEARNING_PLANE_LOCAL_REFERENCE_ENABLED: "false",
    MAA_LEARNING_PLANE_LOCAL_REFERENCE_REVIEW_ENABLED: "false",
    MAA_LEARNING_PLANE_EXTERNAL_RETRIEVAL_ENABLED: "false",
    MAA_LEARNING_PLANE_REFERENCE_RECEIPT_ENABLED: "false",
    MAA_LEARNING_PLANE_USE_RECEIPT_ENABLED: "false",
    MAA_LEARNING_PLANE_INFLUENCE_RECEIPT_ENABLED: "false",
    MAA_LEARNING_PLANE_CHALLENGE_ENABLED: "false",
    MAA_LEARNING_PLANE_PK_LIFECYCLE_RECONCILE_ENABLED: "false"
  }
};

/**
 * Canonical environment/config schema. All configuration is validated at
 * startup; invalid required config must fail fast with a clear, redacted error.
 */
export const ConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MAA_CONFIG_PROFILE: ConfigProfile.default("development"),
  MAA_HOST: z.string().min(1).default("127.0.0.1"),
  MAA_PORT: z.coerce.number().int().positive().default(4320),
  MAA_DATABASE_PATH: z.string().min(1).default("./data/maa.sqlite"),
  MAA_ARTIFACT_ROOT: z.string().min(1).default("./artifacts"),
  MAA_LOG_ROOT: z.string().min(1).default("./log"),
  MAA_BACKUP_DIR: z.string().min(1).default("./backups"),
  MAA_LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  MAA_WORKER_POLL_MS: z.coerce.number().int().positive().default(1000),
  MAA_HEARTBEAT_MS: z.coerce.number().int().positive().default(5000),
  MAA_STALE_EXECUTION_MS: z.coerce.number().int().positive().default(300000),
  MAA_DEFAULT_TIMEOUT_SECONDS: z.coerce.number().int().positive().default(300),
  MAA_MAX_REQUEST_BYTES: z.coerce.number().int().positive().default(5_242_880),
  MAA_MAX_EVIDENCE_ITEMS: z.coerce.number().int().positive().default(5000),
  MAA_DEFAULT_MODEL_PROFILE: z.string().min(1).default("mock-only"),
  MAA_DEEPSEEK_ENABLED: booleanFromEnv.default(false),
  DEEPSEEK_API_KEY: z.string().optional().default(""),
  MAA_CONSOLE_ORIGIN: z.string().min(1).default("http://127.0.0.1:5173"),
  /** Delay between fake workflow phases in M1. Keep short in tests. */
  MAA_FAKE_PHASE_DELAY_MS: z.coerce.number().int().nonnegative().default(50),
  /**
   * Local API bearer/token. When set (or MAA_REQUIRE_API_KEY), mutating and
   * diagnostic endpoints require Authorization: Bearer or x-api-key.
   */
  MAA_API_KEY: z.string().optional().default(""),
  /** Fail startup / reject requests when no API key is configured. */
  MAA_REQUIRE_API_KEY: booleanFromEnv.default(false),
  /**
   * Delete artifact files older than N days (0 = retention disabled).
   * Runs on demand via admin/CLI — not a background cloud sweeper.
   */
  MAA_ARTIFACT_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(0),
  /** Distinct runs with same gap fingerprint in one project before project warning. */
  MAA_GAP_PROJECT_WARNING_THRESHOLD: z.coerce.number().int().positive().default(2),
  /** Distinct projects with same fingerprint before broader promotion eligibility. */
  MAA_GAP_CROSS_PROJECT_PROMOTION_THRESHOLD: z.coerce.number().int().positive().default(2),

  /** Learning Plane adapter (LP8-I1). All flags default off. */
  MAA_LEARNING_PLANE_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_PUBLISH_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_RECEIVE_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_BASE_URL: z.string().default("http://127.0.0.1:4330"),
  MAA_LEARNING_PLANE_AGENT_ID: z.string().min(1).default("marketplace-analysis-agent"),
  MAA_LEARNING_PLANE_CALLBACK_HOST: z.string().min(1).default("127.0.0.1"),
  MAA_LEARNING_PLANE_CALLBACK_PATH: z
    .string()
    .regex(/^\//, "callback path must start with /")
    .default("/v1/learning-plane/deliveries"),
  MAA_LEARNING_PLANE_HEALTH_REPORT_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  MAA_LEARNING_PLANE_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  MAA_LEARNING_PLANE_SECRET_FILE: z
    .string()
    .min(1)
    .default("./data/secrets/learning-plane-adapter.json"),

  /** LP8-I4c governance/replay bridge. All default off. */
  MAA_LEARNING_PLANE_GOVERNANCE_BRIDGE_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_GOVERNANCE_PUBLISH_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_GOVERNANCE_RECEIVE_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_VALIDATION_RECEIPT_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_ACTIVATION_RECEIPT_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_REPLAY_BRIDGE_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_REPLAY_EXECUTE_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_REPLAY_REPORT_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_GRANDFATHER_REGISTER_ENABLED: booleanFromEnv.default(false),

  /** LP8-I5c published-knowledge bridge. All default off. */
  MAA_LEARNING_PLANE_PUBLICATION_BRIDGE_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_PUBLICATION_SUBMIT_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_PUBLICATION_RECONCILE_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_DISCOVERY_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_PACKAGE_FETCH_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_LOCAL_REFERENCE_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_LOCAL_REFERENCE_REVIEW_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_EXTERNAL_RETRIEVAL_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_REFERENCE_RECEIPT_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_USE_RECEIPT_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_INFLUENCE_RECEIPT_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_CHALLENGE_ENABLED: booleanFromEnv.default(false),
  MAA_LEARNING_PLANE_PK_LIFECYCLE_RECONCILE_ENABLED: booleanFromEnv.default(false),
  /** Bounded offline grace for previously eligible references when LP is unavailable. */
  MAA_LEARNING_PLANE_OFFLINE_GRACE_HOURS: z.coerce.number().int().nonnegative().default(24)
});

export type Config = z.infer<typeof ConfigSchema>;

/** Keys whose values must never be logged. */
export const SECRET_CONFIG_KEYS: ReadonlySet<string> = new Set([
  "DEEPSEEK_API_KEY",
  "MAA_API_KEY",
  "MAA_LEARNING_PLANE_OPERATOR_TOKEN"
]);

/** Apply profile defaults then env (env wins). */
export function mergeConfigEnv(
  env: Record<string, string | undefined>
): Record<string, string | undefined> {
  const profileRaw = (env.MAA_CONFIG_PROFILE ?? "development").trim();
  const profileParsed = ConfigProfile.safeParse(profileRaw);
  const profile = profileParsed.success ? profileParsed.data : "development";
  const defaults = CONFIG_PROFILE_DEFAULTS[profile];
  return {
    ...defaults,
    ...env,
    MAA_CONFIG_PROFILE: profile
  };
}

export function isApiAuthEnabled(config: Config): boolean {
  return config.MAA_REQUIRE_API_KEY || config.MAA_API_KEY.trim().length > 0;
}
