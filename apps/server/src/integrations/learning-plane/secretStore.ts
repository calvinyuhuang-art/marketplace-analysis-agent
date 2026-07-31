import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { dirname } from "node:path";
import type { LearningPlaneSecretFile } from "./contracts.js";

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
    return value as LearningPlaneSecretFile;
  }

  save(input: Omit<LearningPlaneSecretFile, "schemaVersion" | "createdAt" | "updatedAt"> & {
    createdAt?: string;
  }): LearningPlaneSecretFile {
    const now = new Date().toISOString();
    const existing = this.exists() ? this.load() : null;
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
    return payload;
  }

  static redactForLogs(value: unknown): unknown {
    return redactObject(value);
  }
}
