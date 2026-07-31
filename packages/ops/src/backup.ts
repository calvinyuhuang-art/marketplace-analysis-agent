import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  ARTIFACT_MANIFEST_VERSION,
  IdPrefix,
  newId,
  type BackupManifest
} from "@maa/contracts";
import { Database } from "@maa/database";
import { checkDatabaseIntegrity } from "./integrity.js";

export type CreateBackupOptions = {
  databasePath: string;
  backupDir: string;
  serviceVersion: string;
  /** Highest applied migration version (e.g. "0009"). */
  databaseSchemaVersion: string;
  includeArtifacts?: boolean;
  artifactRoot?: string;
  notes?: string;
  /** Max schema version this binary understands (defaults to databaseSchemaVersion). */
  maxSupportedDatabaseSchemaVersion?: string;
};

export type BackupResult = {
  backupId: string;
  backupPath: string;
  manifest: BackupManifest;
};

export function createBackup(opts: CreateBackupOptions): BackupResult {
  if (opts.databasePath === ":memory:") {
    throw new Error("Cannot backup an in-memory database");
  }
  const backupId = newId(IdPrefix.artifact).replace(/^art_/, "bak_");
  const backupPath = resolve(opts.backupDir, backupId);
  mkdirSync(backupPath, { recursive: true });

  const db = Database.open({ path: opts.databasePath });
  try {
    db.db.pragma("wal_checkpoint(TRUNCATE)");
    const integrity = checkDatabaseIntegrity(db.db);
    const dbFileName = basename(opts.databasePath);
    copyFileSync(opts.databasePath, join(backupPath, dbFileName));

    let artifactRootIncluded = false;
    if (opts.includeArtifacts && opts.artifactRoot && existsSync(opts.artifactRoot)) {
      copyDirRecursive(opts.artifactRoot, join(backupPath, "artifacts"));
      writeArtifactManifest(opts.artifactRoot, join(backupPath, "artifact-manifest.json"));
      artifactRootIncluded = true;
    }

    const manifest: BackupManifest = {
      schemaVersion: "maa-backup.v1",
      backupId,
      createdAt: new Date().toISOString(),
      serviceVersion: opts.serviceVersion,
      databaseSchemaVersion: opts.databaseSchemaVersion,
      artifactManifestVersion: ARTIFACT_MANIFEST_VERSION,
      databaseFile: dbFileName,
      artifactRootIncluded,
      integrity,
      notes: opts.notes
    };
    writeFileSync(join(backupPath, "manifest.json"), JSON.stringify(manifest, null, 2));
    return { backupId, backupPath, manifest };
  } finally {
    db.close();
  }
}

export type RestoreBackupOptions = {
  backupPath: string;
  databasePath: string;
  restoreArtifacts?: boolean;
  artifactRoot?: string;
  /** Highest migration version the running binary supports. */
  maxSupportedDatabaseSchemaVersion: string;
  /** Known backup envelope versions. */
  supportedEnvelopeVersions?: string[];
};

export function restoreBackup(opts: RestoreBackupOptions): BackupManifest {
  const backupPath = resolve(opts.backupPath);
  const manifestPath = join(backupPath, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Backup manifest not found at ${manifestPath}`);
  }
  const raw = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
  const supported = opts.supportedEnvelopeVersions ?? ["maa-backup.v1"];
  if (!supported.includes(raw.schemaVersion)) {
    throw new Error(`Unsupported backup envelope schema ${raw.schemaVersion}`);
  }
  const dbSchema = raw.databaseSchemaVersion;
  if (!dbSchema) {
    throw new Error("Backup manifest missing databaseSchemaVersion");
  }
  if (compareSchemaVersion(dbSchema, opts.maxSupportedDatabaseSchemaVersion) > 0) {
    throw new Error(
      `Backup databaseSchemaVersion ${dbSchema} is newer than supported ${opts.maxSupportedDatabaseSchemaVersion}`
    );
  }

  const srcDb = join(backupPath, raw.databaseFile);
  if (!existsSync(srcDb)) {
    throw new Error(`Backup database file missing: ${srcDb}`);
  }

  if (raw.artifactRootIncluded) {
    const artManifest = join(backupPath, "artifact-manifest.json");
    if (existsSync(artManifest)) {
      verifyArtifactManifest(join(backupPath, "artifacts"), artManifest);
    }
  }

  mkdirSync(dirname(resolve(opts.databasePath)), { recursive: true });
  for (const suffix of ["-wal", "-shm"]) {
    const p = `${opts.databasePath}${suffix}`;
    if (existsSync(p)) rmSync(p, { force: true });
  }
  copyFileSync(srcDb, opts.databasePath);

  if (opts.restoreArtifacts && raw.artifactRootIncluded && opts.artifactRoot) {
    const srcArt = join(backupPath, "artifacts");
    if (existsSync(srcArt)) {
      mkdirSync(opts.artifactRoot, { recursive: true });
      copyDirRecursive(srcArt, opts.artifactRoot);
    }
  }

  const db = Database.open({ path: opts.databasePath });
  try {
    const integrity = checkDatabaseIntegrity(db.db);
    if (!integrity.ok) {
      throw new Error(`Restored database failed integrity_check: ${integrity.result}`);
    }
  } finally {
    db.close();
  }

  return raw;
}

/** Compare migration versions like "0008" vs "0009". */
export function compareSchemaVersion(a: string, b: string): number {
  const na = Number.parseInt(a.replace(/\D/g, ""), 10) || 0;
  const nb = Number.parseInt(b.replace(/\D/g, ""), 10) || 0;
  return na - nb;
}

export function getDatabaseSchemaVersion(databasePath: string): string {
  const db = Database.open({ path: databasePath });
  try {
    const row = db.db
      .prepare(`SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1`)
      .get() as { version: string } | undefined;
    return row?.version ?? "0000";
  } finally {
    db.close();
  }
}

function writeArtifactManifest(artifactRoot: string, destPath: string): void {
  const root = resolve(artifactRoot);
  const files: Array<{ path: string; sha256: string; sizeBytes: number }> = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) {
        const buf = readFileSync(full);
        files.push({
          path: relative(root, full).replace(/\\/g, "/"),
          sha256: createHash("sha256").update(buf).digest("hex"),
          sizeBytes: buf.byteLength
        });
      }
    }
  }
  if (existsSync(root)) walk(root);
  writeFileSync(
    destPath,
    JSON.stringify(
      {
        schemaVersion: ARTIFACT_MANIFEST_VERSION,
        files
      },
      null,
      2
    )
  );
}

function verifyArtifactManifest(artifactsDir: string, manifestPath: string): void {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    schemaVersion?: string;
    files: Array<{ path: string; sha256: string; sizeBytes: number }>;
  };
  if (manifest.schemaVersion && manifest.schemaVersion !== ARTIFACT_MANIFEST_VERSION) {
    throw new Error(`Unsupported artifact manifest version ${manifest.schemaVersion}`);
  }
  for (const file of manifest.files ?? []) {
    const full = join(artifactsDir, file.path);
    if (!existsSync(full)) {
      throw new Error(`Missing artifact in backup: ${file.path}`);
    }
    const buf = readFileSync(full);
    const hash = createHash("sha256").update(buf).digest("hex");
    if (hash !== file.sha256) {
      throw new Error(`Artifact hash mismatch: ${file.path}`);
    }
  }
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) copyDirRecursive(from, to);
    else if (entry.isFile()) copyFileSync(from, to);
  }
}

export function listBackups(
  backupDir: string
): Array<{ backupId: string; path: string; createdAt?: string }> {
  const root = resolve(backupDir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const path = join(root, d.name);
      let createdAt: string | undefined;
      try {
        const m = JSON.parse(readFileSync(join(path, "manifest.json"), "utf8")) as BackupManifest;
        createdAt = m.createdAt;
      } catch {
        /* ignore */
      }
      return { backupId: d.name, path, createdAt };
    })
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}
