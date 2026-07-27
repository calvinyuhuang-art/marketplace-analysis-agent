import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuditRepository, Database, runMigrations } from "@maa/database";
import { AuditLog } from "./index";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../migrations");

describe("AuditLog", () => {
  let database: Database;
  let log: AuditLog;
  let repo: AuditRepository;

  beforeEach(() => {
    database = Database.open({ path: ":memory:" });
    runMigrations(database.db, MIGRATIONS_DIR);
    repo = new AuditRepository(database.db);
    log = new AuditLog(repo);
  });

  afterEach(() => database.close());

  it("chains event hashes and verifies the chain", () => {
    const first = log.append({ actorType: "system", actorId: "svc", action: "server_started" });
    const second = log.append({
      actorType: "operator",
      actorId: "op1",
      action: "run_cancelled",
      runId: "run_1"
    });

    expect(first.previousHash).toBeNull();
    expect(second.previousHash).toBe(first.eventHash);

    const rows = repo.list();
    expect(log.verify(rows).ok).toBe(true);
  });

  it("detects a broken chain", () => {
    log.append({ actorType: "system", actorId: "svc", action: "a" });
    log.append({ actorType: "system", actorId: "svc", action: "b" });
    const rows = repo.list();
    rows[0]!.previousHash = "tampered";
    expect(log.verify(rows).ok).toBe(false);
  });
});
