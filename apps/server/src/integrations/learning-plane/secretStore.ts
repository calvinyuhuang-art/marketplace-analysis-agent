import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";
import type { LearningPlaneSecretFile, RotationStatus } from "./contracts.js";

const SECRET_SCHEMA = "maa.learning-plane-adapter.secrets.v1" as const;

function redactObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (
        /token|secret|api[_-]?key|password|authorization|signature/i.test(key)
      ) {
        out[key] = "[REDACTED]";
      } else {
        out[key] = redactObject(child);
      }
    }
    return out;
  }
  return value;
}

export class LearningPlaneSecretStore {
  constructor(private readonly secretFilePath: string) {}

  path(): string {
    return this.secretFilePath;
  }

  exists(): boolean {
    return existsSync(this.secretFilePath);
  }

  load(): LearningPlaneSecretFile | null {
    if (!this.exists()) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(this.secretFilePath, "utf8"));
    } catch {
      throw new Error("Learning Plane adapter secret file is malformed JSON.");
    }
    const value = parsed as Partial<LearningPlaneSecretFile>;
    if (
      value.schemaVersion !== SECRET_SCHEMA ||
      typeof value.agentId !== "string" ||
      typeof value.agentApiKey !== "string" ||
      typeof value.callbackVerificationSecret !== "string" ||
      typeof value.credentialId !== "string" ||
      typeof value.callbackKeyId !== "string"
    ) {
      throw new Error("Learning Plane adapter secret file failed schema validation.");
    }
    if (value.agentApiKey.length < 32 || value.callbackVerificationSecret.length < 32) {
      throw new Error("Learning Plane adapter secret material is incomplete.");
    }
    return {
      ...(value as LearningPlaneSecretFile),
      rotationStatus: (value.rotationStatus as RotationStatus | undefined) ?? undefined
    };
  }

  private buildPayload(
    input: Omit<LearningPlaneSecretFile, "schemaVersion" | "createdAt" | "updatedAt"> & {
      createdAt?: string;
    },
    existing: LearningPlaneSecretFile | null,
    now: string
  ): LearningPlaneSecretFile {
    const payload: LearningPlaneSecretFile = {
      schemaVersion: SECRET_SCHEMA,
      agentId: input.agentId,
      learningPlaneBaseUrl: input.learningPlaneBaseUrl,
      credentialId: input.credentialId,
      callbackKeyId: input.callbackKeyId,
      agentApiKey: input.agentApiKey,
      callbackVerificationSecret: input.callbackVerificationSecret,
      createdAt: input.createdAt ?? existing?.createdAt ?? now,
      updatedAt: now
    };
    if (input.previousCredentialId !== undefined) {
      payload.previousCredentialId = input.previousCredentialId;
    } else if (existing?.previousCredentialId !== undefined) {
      payload.previousCredentialId = existing.previousCredentialId;
    }
    if (input.previousAgentApiKey !== undefined) {
      payload.previousAgentApiKey = input.previousAgentApiKey;
    } else if (existing?.previousAgentApiKey !== undefined) {
      payload.previousAgentApiKey = existing.previousAgentApiKey;
    }
    if (input.previousCallbackKeyId !== undefined) {
      payload.previousCallbackKeyId = input.previousCallbackKeyId;
    } else if (existing?.previousCallbackKeyId !== undefined) {
      payload.previousCallbackKeyId = existing.previousCallbackKeyId;
    }
    if (input.previousCallbackVerificationSecret !== undefined) {
      payload.previousCallbackVerificationSecret = input.previousCallbackVerificationSecret;
    } else if (existing?.previousCallbackVerificationSecret !== undefined) {
      payload.previousCallbackVerificationSecret = existing.previousCallbackVerificationSecret;
    }
    if (input.acceptedCallbackKeyIds !== undefined) {
      payload.acceptedCallbackKeyIds = input.acceptedCallbackKeyIds;
    } else if (existing?.acceptedCallbackKeyIds !== undefined) {
      payload.acceptedCallbackKeyIds = existing.acceptedCallbackKeyIds;
    }
    if (input.rotationStatus !== undefined) {
      payload.rotationStatus = input.rotationStatus;
    } else if (existing?.rotationStatus !== undefined) {
      payload.rotationStatus = existing.rotationStatus;
    }
    if (input.rotationOverlapExpiresAt !== undefined) {
      payload.rotationOverlapExpiresAt = input.rotationOverlapExpiresAt;
    } else if (existing?.rotationOverlapExpiresAt !== undefined) {
      payload.rotationOverlapExpiresAt = existing.rotationOverlapExpiresAt;
    }
    return payload;
  }

  save(input: Omit<LearningPlaneSecretFile, "schemaVersion" | "createdAt" | "updatedAt"> & {
    createdAt?: string;
  }): LearningPlaneSecretFile {
    const now = new Date().toISOString();
    const existing = this.exists() ? this.load() : null;
    const payload = this.buildPayload(input, existing, now);
    this.writePayload(payload);
    return payload;
  }

  applyRotationUpdate(
    update: Partial<
      Pick<
        LearningPlaneSecretFile,
        | "credentialId"
        | "agentApiKey"
        | "callbackKeyId"
        | "callbackVerificationSecret"
        | "previousCredentialId"
        | "previousAgentApiKey"
        | "previousCallbackKeyId"
        | "previousCallbackVerificationSecret"
        | "acceptedCallbackKeyIds"
        | "rotationStatus"
        | "rotationOverlapExpiresAt"
      >
    > & {
      clearPreviousCredential?: boolean;
      clearPreviousCallback?: boolean;
    }
  ): LearningPlaneSecretFile {
    const existing = this.load();
    if (!existing) {
      throw new Error("Learning Plane adapter secret file is missing.");
    }
    const now = new Date().toISOString();
    const merged: Omit<LearningPlaneSecretFile, "schemaVersion" | "createdAt" | "updatedAt"> = {
      agentId: existing.agentId,
      learningPlaneBaseUrl: existing.learningPlaneBaseUrl,
      credentialId: update.credentialId ?? existing.credentialId,
      callbackKeyId: update.callbackKeyId ?? existing.callbackKeyId,
      agentApiKey: update.agentApiKey ?? existing.agentApiKey,
      callbackVerificationSecret:
        update.callbackVerificationSecret ?? existing.callbackVerificationSecret,
      previousCredentialId: update.clearPreviousCredential
        ? undefined
        : update.previousCredentialId !== undefined
          ? update.previousCredentialId
          : existing.previousCredentialId,
      previousAgentApiKey: update.clearPreviousCredential
        ? undefined
        : update.previousAgentApiKey !== undefined
          ? update.previousAgentApiKey
          : existing.previousAgentApiKey,
      previousCallbackKeyId: update.clearPreviousCallback
        ? undefined
        : update.previousCallbackKeyId !== undefined
          ? update.previousCallbackKeyId
          : existing.previousCallbackKeyId,
      previousCallbackVerificationSecret: update.clearPreviousCallback
        ? undefined
        : update.previousCallbackVerificationSecret !== undefined
          ? update.previousCallbackVerificationSecret
          : existing.previousCallbackVerificationSecret,
      acceptedCallbackKeyIds: update.clearPreviousCallback
        ? undefined
        : update.acceptedCallbackKeyIds !== undefined
          ? update.acceptedCallbackKeyIds
          : existing.acceptedCallbackKeyIds,
      rotationStatus: update.rotationStatus ?? existing.rotationStatus,
      rotationOverlapExpiresAt:
        update.rotationOverlapExpiresAt !== undefined
          ? update.rotationOverlapExpiresAt
          : existing.rotationOverlapExpiresAt
    };
    const payload = this.buildPayload(merged, null, now);
    payload.createdAt = existing.createdAt;
    this.writePayload(payload);
    return payload;
  }

  private writePayload(payload: LearningPlaneSecretFile): void {
    mkdirSync(dirname(this.secretFilePath), { recursive: true });
    writeFileSync(this.secretFilePath, JSON.stringify(payload, null, 2), {
      encoding: "utf8",
      mode: 0o600
    });
    try {
      chmodSync(this.secretFilePath, 0o600);
    } catch {
      // Windows may ignore POSIX mode; best-effort only.
    }
  }

  static redactForLogs(value: unknown): unknown {
    return redactObject(value);
  }
}
