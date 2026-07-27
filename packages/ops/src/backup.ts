import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { IdPrefix, newId, type BackupManifest } from "@maa/contracts";
import { Database } from "@maa/database";
import { checkDatabaseIntegrity } from "./integrity.js";

export type CreateBackupOptions = {
  databasePath: string;
  backupDir: string;
  serviceVersion: string;
  /** When true, also copy the artifact root into the backup folder. */
  includeArtifacts?: boolean;
  artifactRoot?: string;
  notes?: string;
};

export type BackupResult = {
  backupId: string;
  backupPath: string;
  manifest: BackupManifest;
};

/**
 * Local backup: checkpoint WAL, copy SQLite file, write manifest.
 * No cloud upload — operator copies the folder as needed.
 */
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
    const destDb = join(backupPath, dbFileName);
    copyFileSync(opts.databasePath, destDb);

    let artifactRootIncluded = false;
    if (opts.includeArtifacts && opts.artifactRoot && existsSync(opts.artifactRoot)) {
      copyDirRecursive(opts.artifactRoot, join(backupPath, "artifacts"));
      artifactRootIncluded = true;
    }

    const manifest: BackupManifest = {
      schemaVersion: "maa-backup.v1",
      backupId,
      createdAt: new Date().toISOString(),
      serviceVersion: opts.serviceVersion,
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
  /** When true, restore artifacts/ subfolder over artifactRoot. */
  restoreArtifacts?: boolean;
  artifactRoot?: string;
};

export function restoreBackup(opts: RestoreBackupOptions): BackupManifest {
  const backupPath = resolve(opts.backupPath);
  const manifestPath = join(backupPath, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`Backup manifest not found at ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
  if (manifest.schemaVersion !== "maa-backup.v1") {
    throw new Error(`Unsupported backup schema ${manifest.schemaVersion}`);
  }
  const srcDb = join(backupPath, manifest.databaseFile);
  if (!existsSync(srcDb)) {
    throw new Error(`Backup database file missing: ${srcDb}`);
  }
  mkdirSync(dirname(resolve(opts.databasePath)), { recursive: true });
  // Remove WAL/SHM siblings so restore is clean.
  for (const suffix of ["", "-wal", "-shm"]) {
    const p = `${opts.databasePath}${suffix}`;
    if (existsSync(p) && suffix !== "") rmSync(p, { force: true });
  }
  copyFileSync(srcDb, opts.databasePath);

  if (opts.restoreArtifacts && manifest.artifactRootIncluded && opts.artifactRoot) {
    const srcArt = join(backupPath, "artifacts");
    if (existsSync(srcArt)) {
      mkdirSync(opts.artifactRoot, { recursive: true });
      copyDirRecursive(srcArt, opts.artifactRoot);
    }
  }
  return manifest;
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

export function listBackups(backupDir: string): Array<{ backupId: string; path: string; createdAt?: string }> {
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
