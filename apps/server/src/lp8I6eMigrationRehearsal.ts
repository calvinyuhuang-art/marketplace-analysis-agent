/**
 * LP8-I6e MAA migration rehearsal: fresh → 0018 and 0014→0018 upgrade on isolated DBs.
 * Never opens canonical MAA DB/WAL/SHM.
 *
 * Run from repo root: pnpm exec tsx apps/server/src/lp8I6eMigrationRehearsal.ts
 */
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";

const REPORT =
  "C:\\projects\\Sales-System\\inspection-reports\\LP8_I6E_RELEASE_CANDIDATE_2026-08-01";
const MIGRATIONS = join(process.cwd(), "migrations");

function sha256(buf: Buffer | string) {
  return createHash("sha256").update(buf).digest("hex");
}

function applyThrough(dbPath: string, maxPrefix: string) {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL,
      checksum TEXT
    )`
  );
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const prefix = f.slice(0, 4);
    if (prefix > maxPrefix) break;
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    db.exec(sql);
    db.prepare(
      `INSERT OR IGNORE INTO schema_migrations(filename, applied_at, checksum) VALUES (?,?,?)`
    ).run(f, new Date().toISOString(), sha256(sql));
  }
  const tip = db
    .prepare(`SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1`)
    .get() as { filename: string };
  db.close();
  return tip.filename;
}

function continueTo(dbPath: string, maxPrefix: string) {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  const applied = new Set(
    (
      db.prepare(`SELECT filename FROM schema_migrations`).all() as Array<{ filename: string }>
    ).map((r) => r.filename)
  );
  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  let added = 0;
  for (const f of files) {
    if (applied.has(f)) continue;
    if (f.slice(0, 4) > maxPrefix) break;
    const sql = readFileSync(join(MIGRATIONS, f), "utf8");
    db.exec(sql);
    db.prepare(
      `INSERT INTO schema_migrations(filename, applied_at, checksum) VALUES (?,?,?)`
    ).run(f, new Date().toISOString(), sha256(sql));
    added += 1;
  }
  const tip = db
    .prepare(`SELECT filename FROM schema_migrations ORDER BY filename DESC LIMIT 1`)
    .get() as { filename: string };
  const fk = db.pragma("foreign_key_check") as unknown[];
  db.close();
  return { tip: tip.filename, added, fkOk: fk.length === 0 };
}

function main() {
  mkdirSync(REPORT, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), "maa-i6e-mig-"));
  const fresh = join(dir, "fresh-0018.sqlite");
  const upgrade = join(dir, "upgrade-0014.sqlite");

  const freshTip = applyThrough(fresh, "0018");
  const stopped = applyThrough(upgrade, "0014");
  const cont = continueTo(upgrade, "0018");

  const result = {
    freshTip,
    stoppedAt0014: stopped,
    upgradedTip: cont.tip,
    migrationsAdded: cont.added,
    fkOk: cont.fkOk,
    freshOk: freshTip.startsWith("0018"),
    upgradeOk: cont.tip.startsWith("0018") && cont.added === 4,
    isolatedDir: dir
  };
  writeFileSync(join(REPORT, "maa-migration-rehearsal.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!result.freshOk || !result.upgradeOk || !result.fkOk) process.exitCode = 1;
}

main();
