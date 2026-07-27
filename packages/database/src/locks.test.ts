import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database, ExecutionLocksRepository, runMigrations } from "@maa/database";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../migrations");

describe("ExecutionLocksRepository", () => {
  let database: Database;
  let locks: ExecutionLocksRepository;

  beforeEach(() => {
    database = Database.open({ path: ":memory:" });
    runMigrations(database.db, MIGRATIONS_DIR);
    locks = new ExecutionLocksRepository(database.db);
  });

  afterEach(() => database.close());

  it("allows only one concurrent claim", () => {
    const first = locks.tryClaim({
      lockKey: "run:r1",
      runId: "r1",
      executionId: "exec_a",
      ownerInstance: "inst_a",
      leaseMs: 60_000
    });
    const second = locks.tryClaim({
      lockKey: "run:r1",
      runId: "r1",
      executionId: "exec_b",
      ownerInstance: "inst_b",
      leaseMs: 60_000
    });
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(locks.get("run:r1")?.ownerInstance).toBe("inst_a");
  });

  it("allows reclaim after lease expiry", () => {
    expect(
      locks.tryClaim({
        lockKey: "run:r2",
        runId: "r2",
        executionId: "exec_a",
        ownerInstance: "inst_a",
        leaseMs: 1
      })
    ).toBe(true);

    // Force lease into the past.
    database.db
      .prepare(`UPDATE execution_locks SET lease_expires_at = ? WHERE lock_key = ?`)
      .run(new Date(Date.now() - 1000).toISOString(), "run:r2");

    const reclaimed = locks.tryClaim({
      lockKey: "run:r2",
      runId: "r2",
      executionId: "exec_b",
      ownerInstance: "inst_b",
      leaseMs: 60_000
    });
    expect(reclaimed).toBe(true);
    expect(locks.get("run:r2")?.ownerInstance).toBe("inst_b");
  });
});
