import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Database } from "./connection";
import { runMigrations } from "./migrator";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../../migrations");

/** Canonical LF checksums for migrations 0001–0014 (P1C / production ledger lineage). */
const CANONICAL_LF_CHECKSUMS_0001_0014: Record<string, string> = {
  "0001": "ac44b4c2bbc58b1def3e32e539e456b066eccf16201cdfbe7497f2b7eaf61eaa",
  "0002": "dbccf0f1a4dd9009cfa5a9e072543b562bc47fa496e23440235ae14899033f74",
  "0003": "158216500262ba892e0e63a07fd411f297914508bacc6ebb2e3fd8743034253d",
  "0004": "f6443da4b6e2a294f5e95cf336d7c395dc76d7d72dacb252bd19967af577e65e",
  "0005": "d39afd0087f1e8c8b73408263184a1a22c505d2668d911e15aa31cc86e99d35e",
  "0006": "c2427673df232f4801076da4e3fefefde201106fdcc6dcae4647740d4516b24a",
  "0007": "0eb9de579807c456f2e2bc6294440434350c664946ad8b70907933801a2d00bc",
  "0008": "cbc66c137f21691baad19cc765a06eb5be548cdacdea3f2f6bbb81c883ec2021",
  "0009": "9ed7df6015072ca05af23ce249f98db238150fc06190b62c142ef14251fe6bfd",
  "0010": "c3acffe24985b299f0f96da1cc688c4b1e3c29961ef2f5c5dd7051700a484d42",
  "0011": "30a3978fb5020ac88293ad1fb2ba572aa46493ea3a34ef5d127d841b2fc1f4a6",
  "0012": "0361f82a075dab00a5d5d3150a4bb4b7e3d24149e77b9b0087d3f632db5d45b0",
  "0013": "2240e142e7408c7e6a3e8d8b879f2dec3c06a6b99509edd9717a34bb7c824638",
  "0014": "c488edad41daf44d16ae6a3e224753b5d1a622b5de4bde02600182ef7c83e45a"
};

function runnerChecksum(sqlUtf8: string): string {
  return createHash("sha256").update(sqlUtf8).digest("hex");
}

function listMigrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /^\d+[-_].*\.sql$/.test(f))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

describe("migration SQL source integrity (LF)", () => {
  it("authoritative migrations contain no CRLF or UTF-8 BOM and match runner checksums", () => {
    const files = listMigrationFiles(MIGRATIONS_DIR);
    expect(files.length).toBeGreaterThanOrEqual(18);
    for (const name of files) {
      const buf = readFileSync(join(MIGRATIONS_DIR, name));
      expect(buf.includes(0x0d), `${name} must not contain CR (CRLF)`).toBe(false);
      expect(
        !(buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf),
        `${name} must not contain UTF-8 BOM`
      ).toBe(true);
      const sql = buf.toString("utf8");
      const version = name.match(/^(\d+)/)![1]!;
      const checksum = runnerChecksum(sql);
      if (CANONICAL_LF_CHECKSUMS_0001_0014[version]) {
        expect(checksum, `${name} LF checksum`).toBe(CANONICAL_LF_CHECKSUMS_0001_0014[version]);
      }
    }
  });

  it("fails clearly when a migration file is materialized with CRLF", () => {
    const dir = mkdtempSync(join(tmpdir(), "maa-mig-crlf-"));
    try {
      const src = readFileSync(join(MIGRATIONS_DIR, "0001_init.sql"));
      const crlf = Buffer.from(src.toString("utf8").replace(/\n/g, "\r\n"), "utf8");
      writeFileSync(join(dir, "0001_init.sql"), crlf);
      const buf = readFileSync(join(dir, "0001_init.sql"));
      expect(buf.includes(0x0d)).toBe(true);
      const checksum = runnerChecksum(buf.toString("utf8"));
      expect(checksum).not.toBe(CANONICAL_LF_CHECKSUMS_0001_0014["0001"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

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
