import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import BetterSqlite3 from "better-sqlite3";

export type SqliteDatabase = BetterSqlite3.Database;

export interface OpenDatabaseOptions {
  /** Absolute or relative path to the SQLite file, or ":memory:". */
  path: string;
  readonly?: boolean;
  busyTimeoutMs?: number;
}

/**
 * Opens a SQLite database with the pragmas the plan requires: WAL journaling,
 * enforced foreign keys, and a sensible busy timeout. The parent directory is
 * created on demand so the service can start from an empty data directory.
 */
export function openDatabase(options: OpenDatabaseOptions): SqliteDatabase {
  const isMemory = options.path === ":memory:";
  const path = isMemory ? options.path : resolve(options.path);

  if (!isMemory) {
    mkdirSync(dirname(path), { recursive: true });
  }

  const db = new BetterSqlite3(path, { readonly: options.readonly ?? false });
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma(`busy_timeout = ${options.busyTimeoutMs ?? 5000}`);
  db.pragma("synchronous = NORMAL");
  return db;
}

export class Database {
  readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  static open(options: OpenDatabaseOptions): Database {
    return new Database(openDatabase(options));
  }

  /** Quick liveness probe used by the readiness endpoint. */
  healthy(): boolean {
    try {
      const row = this.db.prepare("SELECT 1 AS ok").get() as { ok: number } | undefined;
      return row?.ok === 1;
    } catch {
      return false;
    }
  }

  close(): void {
    this.db.close();
  }
}
