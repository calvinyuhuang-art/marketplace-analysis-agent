import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { IdPrefix, newId } from "@maa/contracts";
import { resolveSafePath } from "./safe-path";

export interface ArtifactMetadata {
  artifactId: string;
  relativePath: string;
  contentHash: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  redactionStatus: "none" | "redacted" | "unknown";
  accessClass: "internal" | "sensitive" | "public";
}

export interface WriteArtifactOptions {
  extension?: string;
  mimeType?: string;
  subdir?: string;
  redactionStatus?: ArtifactMetadata["redactionStatus"];
  accessClass?: ArtifactMetadata["accessClass"];
}

export function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

function datePartition(now: Date): string {
  const yyyy = now.getUTCFullYear().toString();
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = now.getUTCDate().toString().padStart(2, "0");
  return `${yyyy}/${mm}/${dd}`;
}

/**
 * Stores artifacts under a single configured root with generated filenames,
 * atomic writes (temp file + rename), and SHA-256 content hashing. User input
 * never determines the path, and all reads are validated as in-root.
 */
export class ArtifactStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    mkdirSync(this.root, { recursive: true });
  }

  get rootPath(): string {
    return this.root;
  }

  write(content: Buffer | string, options: WriteArtifactOptions = {}): ArtifactMetadata {
    const buffer = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    const artifactId = newId(IdPrefix.artifact);
    const ext = normalizeExtension(options.extension);
    const now = new Date();
    const partition = options.subdir ? sanitizeSubdir(options.subdir) : datePartition(now);
    const relativePath = `${partition}/${artifactId}${ext}`;

    const full = resolveSafePath(this.root, relativePath);
    mkdirSync(dirname(full), { recursive: true });

    const tmp = `${full}.tmp-${randomBytes(6).toString("hex")}`;
    writeFileSync(tmp, buffer);
    renameSync(tmp, full);

    return {
      artifactId,
      relativePath,
      contentHash: sha256(buffer),
      mimeType: options.mimeType ?? "application/octet-stream",
      sizeBytes: buffer.byteLength,
      createdAt: now.toISOString(),
      redactionStatus: options.redactionStatus ?? "none",
      accessClass: options.accessClass ?? "internal"
    };
  }

  writeJson(value: unknown, options: Omit<WriteArtifactOptions, "extension" | "mimeType"> = {}): ArtifactMetadata {
    return this.write(JSON.stringify(value, null, 2), {
      ...options,
      extension: ".json",
      mimeType: "application/json"
    });
  }

  read(relativePath: string): Buffer {
    const full = resolveSafePath(this.root, relativePath);
    return readFileSync(full);
  }

  readJson<T = unknown>(relativePath: string): T {
    return JSON.parse(this.read(relativePath).toString("utf8")) as T;
  }
}

function normalizeExtension(ext?: string): string {
  if (!ext) return "";
  const cleaned = ext.replace(/[^a-zA-Z0-9.]/g, "");
  if (!cleaned) return "";
  return cleaned.startsWith(".") ? cleaned : `.${cleaned}`;
}

function sanitizeSubdir(subdir: string): string {
  return subdir
    .replace(/\\/g, "/")
    .split("/")
    .map((s) => s.replace(/[^a-zA-Z0-9._-]/g, "_"))
    .filter((s) => s.length > 0 && s !== "." && s !== "..")
    .join("/");
}
