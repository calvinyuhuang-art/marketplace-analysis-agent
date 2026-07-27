import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "@maa/database";
import {
  checkDatabaseIntegrity,
  createBackup,
  restoreBackup,
  purgeExpiredArtifacts
} from "./index.js";

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
        serviceVersion: "0.10.0",
        notes: "unit"
      });
      expect(backup.manifest.schemaVersion).toBe("maa-backup.v1");
      expect(backup.manifest.integrity?.ok).toBe(true);

      // wipe and restore
      rmSync(dbPath, { force: true });
      restoreBackup({ backupPath: backup.backupPath, databasePath: dbPath });
      const restored = Database.open({ path: dbPath });
      const row = restored.db.prepare("SELECT id FROM t").get() as { id: number };
      expect(row.id).toBe(1);
      restored.close();
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
});
