import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Database, runMigrations } from "@maa/database";
import {
  checkDatabaseIntegrity,
  createBackup,
  restoreBackup,
  purgeExpiredArtifacts
} from "./index.js";

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../migrations"
);

describe("M10 ops: integrity, backup, retention", () => {
  it("reports integrity ok for a fresh db", () => {
    const db = Database.open({ path: ":memory:" });
    const result = checkDatabaseIntegrity(db.db);
    expect(result.ok).toBe(true);
    expect(result.result).toBe("ok");
    db.close();
  });

  it("backs up and restores a sqlite file", () => {
    const root = mkdtempSync(join(tmpdir(), "maa-ops-"));
    try {
      const dbPath = join(root, "maa.sqlite");
      const backupDir = join(root, "backups");
      const db = Database.open({ path: dbPath });
      db.db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY); INSERT INTO t VALUES (1);");
      db.close();

      const backup = createBackup({
        databasePath: dbPath,
        backupDir,
        serviceVersion: "0.11.0",
        databaseSchemaVersion: "0000",
        notes: "unit"
      });
      expect(backup.manifest.schemaVersion).toBe("maa-backup.v1");
      expect(backup.manifest.databaseSchemaVersion).toBe("0000");
      expect(backup.manifest.artifactManifestVersion).toBeDefined();
      expect(backup.manifest.integrity?.ok).toBe(true);

      rmSync(dbPath, { force: true });
      restoreBackup({
        backupPath: backup.backupPath,
        databasePath: dbPath,
        maxSupportedDatabaseSchemaVersion: "0009"
      });
      const restored = Database.open({ path: dbPath });
      const row = restored.db.prepare("SELECT id FROM t").get() as { id: number };
      expect(row.id).toBe(1);
      restored.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("backup/restore preserves N1–N6 tables through schema 0017", () => {
    const root = mkdtempSync(join(tmpdir(), "maa-ops-n7-"));
    try {
      const dbPath = join(root, "maa.sqlite");
      const backupDir = join(root, "backups");
      const db = Database.open({ path: dbPath });
      const migrated = runMigrations(db.db, MIGRATIONS_DIR);
      expect(migrated.applied.length).toBeGreaterThan(0);
      db.close();

      const backup = createBackup({
        databasePath: dbPath,
        backupDir,
        serviceVersion: "0.19.0",
        databaseSchemaVersion: "0017",
        notes: "lp8-i1-coverage"
      });
      expect(backup.manifest.schemaVersion).toBe("maa-backup.v1");
      expect(backup.manifest.databaseSchemaVersion).toBe("0017");

      const restoredPath = join(root, "restored.sqlite");
      restoreBackup({
        backupPath: backup.backupPath,
        databasePath: restoredPath,
        maxSupportedDatabaseSchemaVersion: "0017"
      });

      const restored = Database.open({ path: restoredPath });
      const tables = (
        restored.db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
          .all() as { name: string }[]
      ).map((t) => t.name);

      for (const name of [
        "agent_experiences",
        "agent_evaluations",
        "evidence_plans",
        "evidence_plan_reviews",
        "gap_fingerprints",
        "workflow_feedback_events",
        "procedural_rule_definitions",
        "procedural_rule_versions",
        "procedural_rule_activations",
        "outcome_events",
        "outcome_reassessments",
        "lp_adapter_settings",
        "lp_adapter_outbox",
        "lp_adapter_inbox",
        "lp_adapter_acknowledgements",
        "lp_adapter_processing_events"
      ]) {
        expect(tables).toContain(name);
      }

      const cols = (
        restored.db.prepare("PRAGMA table_info(analysis_requests)").all() as {
          name: string;
        }[]
      ).map((c) => c.name);
      expect(cols).toContain("baseline_evidence_package_ids_json");

      const versions = (
        restored.db
          .prepare("SELECT version FROM schema_migrations ORDER BY version")
          .all() as { version: string }[]
      ).map((v) => v.version);
      expect(versions).toContain("0009");
      expect(versions).toContain("0014");
      expect(versions).toContain("0017");
      restored.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects restore when databaseSchemaVersion is newer than binary", () => {
    const root = mkdtempSync(join(tmpdir(), "maa-ops-future-"));
    try {
      const dbPath = join(root, "maa.sqlite");
      const backupDir = join(root, "backups");
      const db = Database.open({ path: dbPath });
      db.db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY); INSERT INTO t VALUES (1);");
      db.close();

      const backup = createBackup({
        databasePath: dbPath,
        backupDir,
        serviceVersion: "0.11.0",
        databaseSchemaVersion: "0099",
        notes: "future"
      });

      expect(() =>
        restoreBackup({
          backupPath: backup.backupPath,
          databasePath: join(root, "restored.sqlite"),
          maxSupportedDatabaseSchemaVersion: "0009"
        })
      ).toThrow(/newer than supported/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("purges artifacts older than retention window", () => {
    const root = mkdtempSync(join(tmpdir(), "maa-ret-"));
    try {
      const oldDir = join(root, "2020/01/01");
      mkdirSync(oldDir, { recursive: true });
      const oldFile = join(oldDir, "old.bin");
      writeFileSync(oldFile, "old");
      const oldTime = new Date("2020-01-01T00:00:00Z");
      utimesSync(oldFile, oldTime, oldTime);

      const newFile = join(root, "fresh.bin");
      writeFileSync(newFile, "new");

      const dry = purgeExpiredArtifacts({
        artifactRoot: root,
        retentionDays: 30,
        dryRun: true,
        now: new Date("2026-07-27T00:00:00Z")
      });
      expect(dry.deletedFiles).toBe(1);
      expect(dry.dryRun).toBe(true);

      const live = purgeExpiredArtifacts({
        artifactRoot: root,
        retentionDays: 30,
        dryRun: false,
        now: new Date("2026-07-27T00:00:00Z")
      });
      expect(live.deletedFiles).toBe(1);
      expect(live.scannedFiles).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("dry-run retention only scans inside resolved artifactRoot", () => {
    const root = mkdtempSync(join(tmpdir(), "maa-ret-escape-"));
    try {
      const artifactRoot = join(root, "artifacts");
      mkdirSync(artifactRoot, { recursive: true });
      const oldTime = new Date("2020-01-01T00:00:00Z");

      const outsideFile = join(root, "outside-old.bin");
      writeFileSync(outsideFile, "outside");
      utimesSync(outsideFile, oldTime, oldTime);

      const insideFile = join(artifactRoot, "inside-old.bin");
      writeFileSync(insideFile, "inside");
      utimesSync(insideFile, oldTime, oldTime);

      const result = purgeExpiredArtifacts({
        artifactRoot,
        retentionDays: 30,
        dryRun: true,
        now: new Date("2026-07-27T00:00:00Z")
      });
      expect(result.deletedFiles).toBe(1);
      expect(result.scannedFiles).toBe(1);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("dry-run retention ignores symlink escapes outside artifactRoot", () => {
    const root = mkdtempSync(join(tmpdir(), "maa-ret-escape-"));
    const outsideRoot = mkdtempSync(join(tmpdir(), "maa-ret-outside-"));
    try {
      const artifactRoot = join(root, "artifacts");
      mkdirSync(artifactRoot, { recursive: true });
      const outsideFile = join(outsideRoot, "secret.bin");
      writeFileSync(outsideFile, "outside");
      const oldTime = new Date("2020-01-01T00:00:00Z");
      utimesSync(outsideFile, oldTime, oldTime);

      const linkPath = join(artifactRoot, "escape-link");
      try {
        symlinkSync(outsideFile, linkPath);
      } catch {
        return;
      }

      const result = purgeExpiredArtifacts({
        artifactRoot,
        retentionDays: 30,
        dryRun: true,
        now: new Date("2026-07-27T00:00:00Z")
      });
      expect(result.deletedFiles).toBe(0);
      expect(result.scannedFiles).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outsideRoot, { recursive: true, force: true });
    }
  });
});
