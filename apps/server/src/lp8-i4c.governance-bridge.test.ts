import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigSchema } from "@maa/contracts";
import { assertNoProhibitedBridgeFields } from "@learning-plane/contracts";
import {
  createContainer,
  CURRENT_DATABASE_SCHEMA_VERSION,
  SERVICE_VERSION
} from "./composition/container";
import type { ResolvedConfig } from "./config/index";
import { findRepoRoot } from "./config/paths";
import { buildAllowlistedSharePayload } from "./integrations/learning-plane/governanceReplayBridgeRepository";

const repoRoot = findRepoRoot();
const migrationsDir = resolve(repoRoot, "migrations");
const containers: Array<{ shutdown: () => Promise<void> }> = [];

function makeConfig(overrides: Record<string, string | undefined> = {}): ResolvedConfig {
  const root = mkdtempSync(join(tmpdir(), "maa-lp8-i4c-"));
  mkdirSync(join(root, "log"), { recursive: true });
  mkdirSync(join(root, "artifacts"), { recursive: true });
  mkdirSync(join(root, "secrets"), { recursive: true });
  const raw = ConfigSchema.parse({
    NODE_ENV: "test",
    MAA_CONFIG_PROFILE: "test",
    MAA_DATABASE_PATH: join(root, "maa.sqlite"),
    MAA_ARTIFACT_ROOT: join(root, "artifacts"),
    MAA_LOG_ROOT: join(root, "log"),
    MAA_BACKUP_DIR: join(root, "backups"),
    MAA_LEARNING_PLANE_SECRET_FILE: join(root, "secrets", "learning-plane-adapter.json"),
    ...overrides
  });
  return {
    raw,
    repoRoot,
    databasePath: raw.MAA_DATABASE_PATH,
    artifactRoot: raw.MAA_ARTIFACT_ROOT,
    logRoot: raw.MAA_LOG_ROOT,
    backupDir: raw.MAA_BACKUP_DIR,
    migrationsDir
  };
}

afterEach(async () => {
  while (containers.length) {
    const c = containers.pop();
    await c?.shutdown();
  }
});

describe("LP8-I4c MAA governance/replay bridge", () => {
  it("ships service 0.20.0 / schema 0017 with bridge flags default off", () => {
    expect(SERVICE_VERSION).toBe("0.20.0");
    expect(CURRENT_DATABASE_SCHEMA_VERSION).toBe("0017");
    const cfg = ConfigSchema.parse({});
    expect(cfg.MAA_LEARNING_PLANE_GOVERNANCE_BRIDGE_ENABLED).toBe(false);
    expect(cfg.MAA_LEARNING_PLANE_GOVERNANCE_PUBLISH_ENABLED).toBe(false);
    expect(cfg.MAA_LEARNING_PLANE_GOVERNANCE_RECEIVE_ENABLED).toBe(false);
    expect(cfg.MAA_LEARNING_PLANE_VALIDATION_RECEIPT_ENABLED).toBe(false);
    expect(cfg.MAA_LEARNING_PLANE_ACTIVATION_RECEIPT_ENABLED).toBe(false);
    expect(cfg.MAA_LEARNING_PLANE_REPLAY_BRIDGE_ENABLED).toBe(false);
    expect(cfg.MAA_LEARNING_PLANE_REPLAY_EXECUTE_ENABLED).toBe(false);
    expect(cfg.MAA_LEARNING_PLANE_REPLAY_REPORT_ENABLED).toBe(false);
    expect(cfg.MAA_LEARNING_PLANE_GRANDFATHER_REGISTER_ENABLED).toBe(false);
  });

  it("applies migration 0017 bridge tables on fresh install", () => {
    const container = createContainer(makeConfig());
    containers.push(container);
    expect(container.databaseSchemaVersion).toBe("0017");
    const tables = (
      container.database.db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'lp_%bridge%' OR name = 'lp_legacy_local_registrations'`
        )
        .all() as Array<{ name: string }>
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining([
        "lp_gov_bridge_links",
        "lp_gov_bridge_outbox",
        "lp_gov_bridge_inbox",
        "lp_replay_bridge_runs",
        "lp_legacy_local_registrations"
      ])
    );
    expect(container.learningPlane?.governanceBridge).toBeTruthy();
  });

  it("rejects prohibited evidence fields before share", () => {
    expect(() =>
      assertNoProhibitedBridgeFields({ privateMemory: "x" }, "test")
    ).toThrow(/PROHIBITED_BRIDGE_FIELD/);
    const payload = buildAllowlistedSharePayload({
      title: "t",
      summary: "s",
      rationale: "r",
      ruleType: "require_direct_customer_evidence",
      currentVersion: "v1",
      candidateVersion: "v2",
      localProposalId: "prv_1",
      localProposalVersionId: "prv_1",
      localRuleId: "rule_1",
      localRuleVersionId: "prv_1",
      localContentHash: "a".repeat(64),
      idempotencyKey: "k1"
    });
    expect(payload.productionBridge).toBe(true);
    expect(payload.limitations).toContain("approval-does-not-activate");
  });

  it("blocks competing local approval for learning_plane_shared proposals", () => {
    const container = createContainer(
      makeConfig({
        MAA_LEARNING_PLANE_ENABLED: "true",
        MAA_LEARNING_PLANE_GOVERNANCE_BRIDGE_ENABLED: "true",
        MAA_LEARNING_PLANE_GOVERNANCE_PUBLISH_ENABLED: "true"
      })
    );
    containers.push(container);
    const bridge = container.learningPlane!.governanceBridge!;
    const proposed = container.typedProceduralService.proposeVersion({
      ruleType: "require_direct_customer_evidence",
      createdBy: "tester"
    });
    container.typedProceduralService.replayVersion(proposed.versionId);
    const shared = bridge.shareVersionToLearningPlane(proposed.versionId);
    expect(shared.link.governance_origin).toBe("learning_plane_shared");
    expect(shared.outboxId).toBeTruthy();
    expect(() => bridge.assertLocalApproveAllowed(proposed.versionId)).toThrow(
      /Competing local approval/
    );
    // Share does not activate the shared candidate.
    const active = container.typedProceduralService.getActiveVersion(
      "require_direct_customer_evidence"
    );
    expect(active?.versionId).not.toBe(proposed.versionId);
    expect(shared.link.submission_status).toBe("pending");
  });

  it("local validation accepted projects LP approval without activating", () => {
    const container = createContainer(
      makeConfig({
        MAA_LEARNING_PLANE_ENABLED: "true",
        MAA_LEARNING_PLANE_GOVERNANCE_BRIDGE_ENABLED: "true",
        MAA_LEARNING_PLANE_GOVERNANCE_PUBLISH_ENABLED: "true",
        MAA_LEARNING_PLANE_GOVERNANCE_RECEIVE_ENABLED: "true",
        MAA_LEARNING_PLANE_VALIDATION_RECEIPT_ENABLED: "true"
      })
    );
    containers.push(container);
    const bridge = container.learningPlane!.governanceBridge!;
    const proposed = container.typedProceduralService.proposeVersion({
      ruleType: "require_format_normalization_for_pricing",
      createdBy: "tester"
    });
    container.typedProceduralService.replayVersion(proposed.versionId);
    bridge.shareVersionToLearningPlane(proposed.versionId);
    // Simulate published case linkage
    container.database.db
      .prepare(
        `UPDATE lp_gov_bridge_links SET lp_proposal_id = ?, lp_case_id = ?, submission_status = 'published' WHERE version_id = ?`
      )
      .run("prop_test", "case_test", proposed.versionId);

    const handled = bridge.handleGovernanceDecision({
      governanceDeliveryId: "gdel_1",
      governanceCaseId: "case_test",
      governanceDecisionId: "gdec_1",
      proposalId: "prop_test",
      decision: "approve",
      conditions: [],
      limitations: [],
      decisionTimestamp: new Date().toISOString(),
      acknowledgementDeadline: new Date(Date.now() + 60_000).toISOString(),
      targetAgentId: "marketplace-analysis-agent",
      caseType: "procedural_change_activation",
      currentVersion: "v0",
      candidateVersion: `v${proposed.versionNumber}`,
      changeType: "typed_rule",
      messageType: "governance.decision_notification"
    });
    expect(handled.validationStatus).toBe("accepted");
    const version = container.typedProceduralService.getVersion(proposed.versionId);
    expect(version.lifecycleStatus).toBe("approved");
    expect(version.approvedBy).toMatch(/^lp-decision:/);
    expect(
      container.typedProceduralService.getActiveVersion(
        "require_format_normalization_for_pricing"
      )
    ).toBeNull();
  });
});
