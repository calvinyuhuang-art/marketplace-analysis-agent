import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SqliteDatabase } from "./connection";

export interface MigrationRecord {
  version: string;
  name: string;
  appliedAt: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

const MIGRATION_FILE = /^(\d+)[-_].*\.sql$/;

function ensureMigrationsTable(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      checksum   TEXT NOT NULL
    );
  `);
}

function discoverMigrations(dir: string): { version: string; name: string; file: string }[] {
  const entries = readdirSync(dir).filter((f) => MIGRATION_FILE.test(f));
  entries.sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  return entries.map((file) => {
    const match = MIGRATION_FILE.exec(file);
    return { version: match![1]!, name: file, file: join(dir, file) };
  });
}

/**
 * Applies pending numbered SQL migrations inside individual transactions and
 * records them in schema_migrations. Re-running is a no-op (idempotent), and
 * an altered already-applied migration throws to prevent silent drift.
 */
export function runMigrations(db: SqliteDatabase, migrationsDir: string): MigrationResult {
  const dir = resolve(migrationsDir);
  ensureMigrationsTable(db);

  const applied = new Map<string, MigrationRecord>();
  for (const row of db.prepare("SELECT version, name, applied_at, checksum FROM schema_migrations").all() as {
    version: string;
    name: string;
    applied_at: string;
    checksum: string;
  }[]) {
    applied.set(row.version, {
      version: row.version,
      name: row.name,
      appliedAt: row.applied_at,
      checksum: row.checksum
    });
  }

  const result: MigrationResult = { applied: [], skipped: [] };

  for (const migration of discoverMigrations(dir)) {
    const sql = readFileSync(migration.file, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const existing = applied.get(migration.version);

    if (existing) {
      if (existing.checksum !== checksum) {
        throw new Error(
          `Migration ${migration.name} (version ${migration.version}) has changed after being applied. ` +
            `Refusing to run to avoid schema drift.`
        );
      }
      result.skipped.push(migration.name);
      continue;
    }

    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)"
      ).run(migration.version, migration.name, new Date().toISOString(), checksum);
    });
    tx();
    result.applied.push(migration.name);
  }

  return result;
}
