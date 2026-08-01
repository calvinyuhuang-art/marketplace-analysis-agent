import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { API_COMPAT_LABEL } from "@maa/contracts";

export type CoordinatedServiceBackupEntry = {
  serviceName: "marketplace-analysis-agent";
  serviceVersion: string;
  apiCompatibility: string;
  schemaVersion: string;
  commit: string | null;
  databaseFilename: string;
  databaseSha256: string;
  artifactManifestFilename?: string | null;
  artifactManifestSha256?: string | null;
  featureFlagsSafe: Record<string, boolean | string | number | null>;
  activeCredentialId: string | null;
  activeCallbackKeyId: string | null;
  outboxPending: number;
  outboxPermanentFailure: number;
  integrityOk: boolean;
  createdAt: string;
};

export function buildMaaRecoveryEntry(input: {
  serviceVersion: string;
  apiCompatibility?: string;
  schemaVersion: string;
  commit?: string | null;
  backupPath: string;
  databaseFilename: string;
  includeArtifacts?: boolean;
  integrityOk: boolean;
  featureFlagsSafe: Record<string, boolean | string | number | null>;
  activeCredentialId: string | null;
  activeCallbackKeyId: string | null;
  outboxPending: number;
  outboxPermanentFailure: number;
  createdAt?: string;
}): CoordinatedServiceBackupEntry {
  const dbPath = join(input.backupPath, input.databaseFilename);
  const databaseSha256 = createHash("sha256")
    .update(readFileSync(dbPath))
    .digest("hex");

  let artifactManifestFilename: string | null = null;
  let artifactManifestSha256: string | null = null;
  if (input.includeArtifacts) {
    const artPath = join(input.backupPath, "artifact-manifest.json");
    if (existsSync(artPath)) {
      artifactManifestFilename = "artifact-manifest.json";
      artifactManifestSha256 = createHash("sha256")
        .update(readFileSync(artPath))
        .digest("hex");
    }
  }

  return {
    serviceName: "marketplace-analysis-agent",
    serviceVersion: input.serviceVersion,
    apiCompatibility: input.apiCompatibility ?? API_COMPAT_LABEL,
    schemaVersion: input.schemaVersion,
    commit: input.commit ?? null,
    databaseFilename: input.databaseFilename,
    databaseSha256,
    artifactManifestFilename,
    artifactManifestSha256,
    featureFlagsSafe: input.featureFlagsSafe,
    activeCredentialId: input.activeCredentialId,
    activeCallbackKeyId: input.activeCallbackKeyId,
    outboxPending: input.outboxPending,
    outboxPermanentFailure: input.outboxPermanentFailure,
    integrityOk: input.integrityOk,
    createdAt: input.createdAt ?? new Date().toISOString()
  };
}
