import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  AppError,
  type Config,
  ConfigSchema,
  isApiAuthEnabled,
  mergeConfigEnv
} from "@maa/contracts";
import { findRepoRoot, resolveFromRoot } from "./paths";

export interface ResolvedConfig {
  raw: Config;
  repoRoot: string;
  databasePath: string;
  artifactRoot: string;
  logRoot: string;
  backupDir: string;
  migrationsDir: string;
}

/**
 * Loads .env (if present) from the repo root, applies config profile defaults,
 * validates with the canonical Zod schema, and resolves runtime paths.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ResolvedConfig {
  const repoRoot = findRepoRoot();
  loadDotenv({ path: resolve(repoRoot, ".env") });

  const merged = mergeConfigEnv({ ...env } as Record<string, string | undefined>);
  const parsed = ConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new AppError({
      code: "CONFIG_INVALID",
      message: `Invalid configuration: ${details.join("; ")}`,
      details: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }))
    });
  }

  const raw = parsed.data;

  if (raw.MAA_DEEPSEEK_ENABLED && raw.DEEPSEEK_API_KEY.trim().length === 0) {
    throw new AppError({
      code: "CONFIG_INVALID",
      message: "MAA_DEEPSEEK_ENABLED is true but DEEPSEEK_API_KEY is empty."
    });
  }

  if (raw.MAA_REQUIRE_API_KEY && raw.MAA_API_KEY.trim().length === 0) {
    throw new AppError({
      code: "CONFIG_INVALID",
      message: "MAA_REQUIRE_API_KEY is true but MAA_API_KEY is empty."
    });
  }

  if (raw.NODE_ENV === "production" && !isApiAuthEnabled(raw)) {
    throw new AppError({
      code: "CONFIG_INVALID",
      message:
        "Production requires local API authentication. Set MAA_API_KEY or MAA_CONFIG_PROFILE=local-hardened."
    });
  }

  return {
    raw,
    repoRoot,
    databasePath: resolveFromRoot(repoRoot, raw.MAA_DATABASE_PATH),
    artifactRoot: resolveFromRoot(repoRoot, raw.MAA_ARTIFACT_ROOT),
    logRoot: resolveFromRoot(repoRoot, raw.MAA_LOG_ROOT),
    backupDir: resolveFromRoot(repoRoot, raw.MAA_BACKUP_DIR),
    migrationsDir: resolveFromRoot(repoRoot, "migrations")
  };
}
