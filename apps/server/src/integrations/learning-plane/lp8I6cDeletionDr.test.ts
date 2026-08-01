import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { ConfigSchema } from "@maa/contracts";
import { createApp } from "../../app.js";
import { createContainer } from "../../composition/container.js";
import type { ResolvedConfig } from "../../config/index.js";
import { findRepoRoot } from "../../config/paths.js";
import { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import { PublishedKnowledgeBridgeRepository } from "./publishedKnowledgeBridgeRepository.js";

const repoRoot = findRepoRoot();
const migrationsDir = resolve(repoRoot, "migrations");
const dirs: string[] = [];
const containers: Array<{ shutdown: () => Promise<void> }> = [];

function makeConfig(overrides: Record<string, string | undefined> = {}): ResolvedConfig {
  const root = mkdtempSync(join(tmpdir(), "maa-lp8-i6c-"));
  dirs.push(root);
  const raw = ConfigSchema.parse({
    NODE_ENV: "test",
    MAA_CONFIG_PROFILE: "test",
    MAA_DATABASE_PATH: join(root, "maa.sqlite"),
    MAA_ARTIFACT_ROOT: join(root, "artifacts"),
    MAA_LOG_ROOT: join(root, "log"),
    MAA_BACKUP_DIR: join(root, "backups"),
    MAA_LEARNING_PLANE_SECRET_FILE: join(root, "secrets", "learning-plane-adapter.json"),
    MAA_LEARNING_PLANE_ENABLED: "true",
    MAA_LEARNING_PLANE_PUBLICATION_BRIDGE_ENABLED: "true",
    ...overrides
  });
  return {
    raw,
    repoRoot: findRepoRoot(),
    databasePath: raw.MAA_DATABASE_PATH,
    artifactRoot: raw.MAA_ARTIFACT_ROOT,
    logRoot: raw.MAA_LOG_ROOT,
    backupDir: raw.MAA_BACKUP_DIR,
    migrationsDir
  };
}

function startContainer(config: ResolvedConfig) {
  const container = createContainer(config, { startWorker: false });
  containers.push(container);
  return container;
}

function seedLocalReference(db: import("@maa/database").SqliteDatabase): string {
  const pkRepo = new PublishedKnowledgeBridgeRepository(db);
  const now = new Date().toISOString();
  const localReferenceId = "pkref_test_delete_1";
  const packageSha256 = "b".repeat(64);
  pkRepo.upsertPackageCache({
    package_sha256: packageSha256,
    published_knowledge_id: "lp_pk_test_1",
    publication_package_id: "pkg_test_1",
    publication_version: "1",
    source_agent_id: "research-orchestrator",
    knowledge_type: "semantic_fact",
    body_json: JSON.stringify({ sections: [{ content: "advisory only" }] }),
    meta_json: JSON.stringify({ untrustedContent: true }),
    fetched_at: now,
    byte_size: 32
  });
  pkRepo.insertLocalReference({
    local_reference_id: localReferenceId,
    published_knowledge_id: "lp_pk_test_1",
    publication_package_id: "pkg_test_1",
    publication_version: "1",
    package_sha256: packageSha256,
    source_agent_id: "research-orchestrator",
    knowledge_type: "semantic_fact",
    authority: "advisory",
    applicability_json: "[]",
    scope_snapshot: "agent_group",
    untrusted_content: 1,
    discovered_at: null,
    reference_created_at: now,
    reference_origin: "uat",
    local_review_state: "eligible_for_retrieval",
    local_retrieval_eligible: 1,
    lp_eligible: 1,
    lp_eligibility_json: null,
    lp_freshness_state: "fresh",
    local_freshness_state: "fresh",
    challenge_state: null,
    catalog_state: "active",
    offline_grace_deadline: null,
    last_reconciled_at: null,
    last_used_at: null,
    use_count: 0,
    influence_count: 0,
    title: "Test reference",
    summary: "For deletion DR test",
    created_at: now,
    updated_at: now
  });
  return localReferenceId;
}

afterEach(async () => {
  while (containers.length) {
    const container = containers.pop();
    if (container) await container.shutdown();
  }
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("LP8-I6c local reference deletion DR", () => {
  it("delete local reference is idempotent and does not require Learning Plane", async () => {
    const config = makeConfig();
    const container = startContainer(config);
    const app = createApp(container);
    const localReferenceId = seedLocalReference(container.database.db);

    const first = await request(app)
      .delete(
        `/v1/integrations/learning-plane/published-knowledge/local-references/${localReferenceId}`
      )
      .send({ reason: "operator cleanup" })
      .expect(200);
    expect(first.body).toMatchObject({
      ok: true,
      idempotent: false,
      localReferenceId
    });

    const pkRepo = new PublishedKnowledgeBridgeRepository(container.database.db);
    const tombstoned = pkRepo.getLocalReference(localReferenceId);
    expect(tombstoned?.local_retrieval_eligible).toBe(0);
    expect(tombstoned?.local_review_state).toBe("disabled");

    const adapterRepo = new LearningPlaneAdapterRepository(container.database.db);
    const events = adapterRepo.listRecentProcessingEvents(10);
    expect(
      events.some((e) => e.event_kind === "learning_plane.local_reference_deleted")
    ).toBe(true);
    const deletedEvent = events.find(
      (e) => e.event_kind === "learning_plane.local_reference_deleted"
    );
    expect(String(deletedEvent?.detail_json ?? "")).toContain(localReferenceId);
    expect(String(deletedEvent?.detail_json ?? "")).not.toMatch(/advisory only|sections/i);

    const second = await request(app)
      .delete(
        `/v1/integrations/learning-plane/published-knowledge/local-references/${localReferenceId}`
      )
      .expect(200);
    expect(second.body).toMatchObject({ ok: true, idempotent: true, localReferenceId });

    const missing = await request(app)
      .delete(
        "/v1/integrations/learning-plane/published-knowledge/local-references/pkref_missing"
      )
      .expect(200);
    expect(missing.body).toMatchObject({ ok: true, idempotent: true });
  });

  it("status includes recovery block (may be sparse)", async () => {
    const config = makeConfig();
    const container = startContainer(config);
    const app = createApp(container);

    const status = await request(app).get("/v1/integrations/learning-plane/status").expect(200);
    expect(status.body.recovery).toMatchObject({
      lastBackupAt: null,
      lastBackupPathDisplay: null,
      lastIntegrityOk: null,
      retentionDaysConfigured: expect.any(Number),
      localReferenceCount: expect.any(Number),
      tombstoneOrDeletedReferenceCount: expect.any(Number)
    });
  });
});
