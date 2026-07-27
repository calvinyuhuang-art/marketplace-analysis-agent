import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "./connection";
import { runMigrations } from "./migrator";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../migrations");

describe("runMigrations", () => {
  let database: Database;

  beforeEach(() => {
    database = Database.open({ path: ":memory:" });
  });

  afterEach(() => {
    database.close();
  });

  it("applies the initial migration from an empty database", () => {
    const result = runMigrations(database.db, MIGRATIONS_DIR);
    expect(result.applied.length).toBeGreaterThan(0);

    const tables = database.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("analysis_projects");
    expect(names).toContain("analysis_runs");
    expect(names).toContain("artifacts");
    expect(names).toContain("audit_events");
    expect(names).toContain("settings_model_profiles");
    expect(names).toContain("execution_locks");
    expect(names).toContain("idempotency_records");
  });

  it("is repeatable (second run applies nothing)", () => {
    runMigrations(database.db, MIGRATIONS_DIR);
    const second = runMigrations(database.db, MIGRATIONS_DIR);
    expect(second.applied).toHaveLength(0);
    expect(second.skipped.length).toBeGreaterThan(0);
  });

  it("enforces the scoped idempotency uniqueness constraint", () => {
    runMigrations(database.db, MIGRATIONS_DIR);
    const now = new Date().toISOString();
    database.db
      .prepare(
        `INSERT INTO analysis_projects (project_id, name, platform, marketplace, category, product_type, created_at, updated_at)
         VALUES ('p1','n','amazon','US','books','adult_coloring_book', ?, ?)`
      )
      .run(now, now);
    const insertReq = () =>
      database.db
        .prepare(
          `INSERT INTO analysis_requests (request_id, project_id, client, operation, idempotency_key, created_at, updated_at)
           VALUES (?, 'p1', 'research-team', 'full_marketplace_analysis', 'k1', ?, ?)`
        )
        .run(`r_${Math.random().toString(36).slice(2)}`, now, now);
    insertReq();
    expect(() => insertReq()).toThrow();
  });
});
