import { createHash, randomBytes } from "node:crypto";
import type { SqliteDatabase } from "@maa/database";
import {
  ALLOWED_GOVERNANCE_EVIDENCE_KINDS,
  assertNoProhibitedBridgeFields
} from "@learning-plane/contracts";
import { AppError } from "@maa/contracts";

export type GovernanceOrigin =
  | "legacy_local"
  | "local_only"
  | "learning_plane_shared";

export type GovBridgeLink = {
  link_id: string;
  version_id: string;
  rule_id: string;
  governance_origin: GovernanceOrigin;
  local_proposal_id: string;
  local_proposal_version_id: string;
  local_content_hash: string;
  lp_proposal_id: string | null;
  lp_case_id: string | null;
  lp_decision_id: string | null;
  lp_decision: string | null;
  decision_payload_sha256: string | null;
  local_validation_status: string | null;
  local_validation_diagnostic: string | null;
  submission_status: string;
  submission_idempotency_key: string;
  submission_payload_sha256: string | null;
  correlation_id: string | null;
  created_at: string;
  updated_at: string;
};

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(10).toString("hex")}`;
}

function sha256Json(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

export class GovernanceReplayBridgeRepository {
  constructor(private readonly db: SqliteDatabase) {}

  getLinkByVersion(versionId: string): GovBridgeLink | undefined {
    return this.db
      .prepare(`SELECT * FROM lp_gov_bridge_links WHERE version_id = ?`)
      .get(versionId) as GovBridgeLink | undefined;
  }

  getLinkByCase(caseId: string): GovBridgeLink | undefined {
    return this.db
      .prepare(`SELECT * FROM lp_gov_bridge_links WHERE lp_case_id = ?`)
      .get(caseId) as GovBridgeLink | undefined;
  }

  ensureLocalOnlyLink(input: {
    versionId: string;
    ruleId: string;
    contentHash: string;
  }): GovBridgeLink {
    const existing = this.getLinkByVersion(input.versionId);
    if (existing) return existing;
    const now = new Date().toISOString();
    const linkId = newId("lpgl");
    this.db
      .prepare(
        `INSERT INTO lp_gov_bridge_links (
          link_id, version_id, rule_id, governance_origin,
          local_proposal_id, local_proposal_version_id, local_content_hash,
          submission_status, submission_idempotency_key, created_at, updated_at
        ) VALUES (?, ?, ?, 'local_only', ?, ?, ?, 'not_submitted', ?, ?, ?)`
      )
      .run(
        linkId,
        input.versionId,
        input.ruleId,
        input.versionId,
        input.versionId,
        input.contentHash,
        `local-only-${input.versionId}`,
        now,
        now
      );
    return this.getLinkByVersion(input.versionId)!;
  }

  createShareLink(input: {
    versionId: string;
    ruleId: string;
    contentHash: string;
    idempotencyKey: string;
    correlationId: string;
    payloadSha256: string;
  }): GovBridgeLink {
    const existing = this.getLinkByVersion(input.versionId);
    if (existing) {
      if (existing.governance_origin === "learning_plane_shared") {
        if (existing.submission_idempotency_key !== input.idempotencyKey) {
          throw new AppError({
            code: "IDEMPOTENCY_CONFLICT",
            message: "Version already shared with a different idempotency key."
          });
        }
        return existing;
      }
      if (existing.governance_origin !== "local_only") {
        throw new AppError({
          code: "INVALID_STATE_TRANSITION",
          message: `Cannot share version with governance_origin=${existing.governance_origin}.`
        });
      }
    }
    const now = new Date().toISOString();
    const linkId = existing?.link_id ?? newId("lpgl");
    if (existing) {
      this.db
        .prepare(
          `UPDATE lp_gov_bridge_links SET
            governance_origin = 'learning_plane_shared',
            submission_status = 'pending',
            submission_idempotency_key = ?,
            submission_payload_sha256 = ?,
            correlation_id = ?,
            updated_at = ?
           WHERE version_id = ?`
        )
        .run(
          input.idempotencyKey,
          input.payloadSha256,
          input.correlationId,
          now,
          input.versionId
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO lp_gov_bridge_links (
            link_id, version_id, rule_id, governance_origin,
            local_proposal_id, local_proposal_version_id, local_content_hash,
            submission_status, submission_idempotency_key, submission_payload_sha256,
            correlation_id, created_at, updated_at
          ) VALUES (?, ?, ?, 'learning_plane_shared', ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`
        )
        .run(
          linkId,
          input.versionId,
          input.ruleId,
          input.versionId,
          input.versionId,
          input.contentHash,
          input.idempotencyKey,
          input.payloadSha256,
          input.correlationId,
          now,
          now
        );
    }
    return this.getLinkByVersion(input.versionId)!;
  }

  markPublished(
    versionId: string,
    refs: { lpProposalId: string; lpCaseId: string }
  ): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE lp_gov_bridge_links SET
          submission_status = 'published',
          lp_proposal_id = ?,
          lp_case_id = ?,
          updated_at = ?
         WHERE version_id = ?`
      )
      .run(refs.lpProposalId, refs.lpCaseId, now, versionId);
  }

  recordDecision(input: {
    caseId: string;
    decisionId: string;
    decision: string;
    payloadSha256: string;
  }): GovBridgeLink {
    const link = this.getLinkByCase(input.caseId);
    if (!link) {
      throw new AppError({
        code: "NOT_FOUND",
        message: `No bridge link for governance case ${input.caseId}.`
      });
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE lp_gov_bridge_links SET
          lp_decision_id = ?,
          lp_decision = ?,
          decision_payload_sha256 = ?,
          updated_at = ?
         WHERE link_id = ?`
      )
      .run(
        input.decisionId,
        input.decision,
        input.payloadSha256,
        now,
        link.link_id
      );
    return this.getLinkByVersion(link.version_id)!;
  }

  recordLocalValidation(input: {
    versionId: string;
    status: "accepted" | "rejected" | "incompatible";
    diagnostic: string;
  }): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE lp_gov_bridge_links SET
          local_validation_status = ?,
          local_validation_diagnostic = ?,
          updated_at = ?
         WHERE version_id = ?`
      )
      .run(input.status, input.diagnostic.slice(0, 1024), now, input.versionId);
  }

  enqueueOutbox(input: {
    kind: string;
    linkId?: string;
    versionId?: string;
    caseId?: string;
    decisionId?: string;
    replayJobId?: string;
    localReplayId?: string;
    idempotencyKey: string;
    payload: unknown;
  }): { outboxId: string; idempotentReplay: boolean } {
    const existing = this.db
      .prepare(
        `SELECT outbox_id, payload_sha256 FROM lp_gov_bridge_outbox WHERE idempotency_key = ?`
      )
      .get(input.idempotencyKey) as
      | { outbox_id: string; payload_sha256: string }
      | undefined;
    const payloadSha = sha256Json(input.payload);
    if (existing) {
      if (existing.payload_sha256 !== payloadSha) {
        throw new AppError({
          code: "IDEMPOTENCY_CONFLICT",
          message: "Bridge outbox idempotency key reused with different payload."
        });
      }
      return { outboxId: existing.outbox_id, idempotentReplay: true };
    }
    const outboxId = newId("lpgo");
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO lp_gov_bridge_outbox (
          outbox_id, kind, link_id, version_id, case_id, decision_id,
          replay_job_id, local_replay_id, idempotency_key, payload_json,
          payload_sha256, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(
        outboxId,
        input.kind,
        input.linkId ?? null,
        input.versionId ?? null,
        input.caseId ?? null,
        input.decisionId ?? null,
        input.replayJobId ?? null,
        input.localReplayId ?? null,
        input.idempotencyKey,
        JSON.stringify(input.payload),
        payloadSha,
        now,
        now
      );
    return { outboxId, idempotentReplay: false };
  }

  claimPendingOutbox(limit = 10): Array<Record<string, unknown>> {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM lp_gov_bridge_outbox
         WHERE status IN ('pending', 'retry_scheduled')
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at ASC LIMIT ?`
      )
      .all(now, limit) as Array<Record<string, unknown>>;
    for (const row of rows) {
      this.db
        .prepare(
          `UPDATE lp_gov_bridge_outbox SET status = 'claimed', updated_at = ? WHERE outbox_id = ? AND status IN ('pending', 'retry_scheduled')`
        )
        .run(now, row.outbox_id);
    }
    return rows;
  }

  markOutboxPublished(outboxId: string, learningPlaneRef: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE lp_gov_bridge_outbox SET
          status = 'published', learning_plane_ref = ?, published_at = ?, updated_at = ?
         WHERE outbox_id = ?`
      )
      .run(learningPlaneRef, now, now, outboxId);
  }

  markOutboxRetry(outboxId: string, code: string, message: string): void {
    const now = new Date().toISOString();
    const next = new Date(Date.now() + 5_000).toISOString();
    this.db
      .prepare(
        `UPDATE lp_gov_bridge_outbox SET
          status = 'retry_scheduled',
          attempt_count = attempt_count + 1,
          next_attempt_at = ?,
          last_error_code = ?,
          last_bounded_error = ?,
          updated_at = ?
         WHERE outbox_id = ?`
      )
      .run(next, code, message.slice(0, 512), now, outboxId);
  }

  insertInboxIfNew(input: {
    deliveryId: string;
    messageType: string;
    caseId?: string;
    decisionId?: string;
    replayJobId?: string;
    versionId?: string;
    payload: unknown;
  }): { inboxId: string; idempotentReplay: boolean } {
    const existing = this.db
      .prepare(
        `SELECT inbox_id, payload_sha256 FROM lp_gov_bridge_inbox
         WHERE delivery_id = ? AND message_type = ?`
      )
      .get(input.deliveryId, input.messageType) as
      | { inbox_id: string; payload_sha256: string }
      | undefined;
    const payloadSha = sha256Json(input.payload);
    if (existing) {
      if (existing.payload_sha256 !== payloadSha) {
        throw new AppError({
          code: "IDEMPOTENCY_CONFLICT",
          message: "Bridge inbox delivery reused with different payload."
        });
      }
      return { inboxId: existing.inbox_id, idempotentReplay: true };
    }
    const inboxId = newId("lpgi");
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO lp_gov_bridge_inbox (
          inbox_id, delivery_id, message_type, case_id, decision_id, replay_job_id,
          version_id, payload_json, payload_sha256, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?, ?)`
      )
      .run(
        inboxId,
        input.deliveryId,
        input.messageType,
        input.caseId ?? null,
        input.decisionId ?? null,
        input.replayJobId ?? null,
        input.versionId ?? null,
        JSON.stringify(input.payload),
        payloadSha,
        now,
        now
      );
    return { inboxId, idempotentReplay: false };
  }

  upsertReplayRun(input: {
    replayJobId: string;
    versionId: string;
    linkId?: string;
    manifestId?: string;
    manifestSha256?: string;
    status: string;
  }): void {
    const existing = this.db
      .prepare(`SELECT bridge_run_id FROM lp_replay_bridge_runs WHERE replay_job_id = ?`)
      .get(input.replayJobId) as { bridge_run_id: string } | undefined;
    const now = new Date().toISOString();
    if (existing) {
      this.db
        .prepare(
          `UPDATE lp_replay_bridge_runs SET execution_status = ?, updated_at = ? WHERE replay_job_id = ?`
        )
        .run(input.status, now, input.replayJobId);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO lp_replay_bridge_runs (
          bridge_run_id, replay_job_id, version_id, link_id, manifest_id,
          manifest_sha256, execution_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        newId("lprr"),
        input.replayJobId,
        input.versionId,
        input.linkId ?? null,
        input.manifestId ?? null,
        input.manifestSha256 ?? null,
        input.status,
        now,
        now
      );
  }

  registerLegacyLocal(input: {
    localRuleId: string;
    localRuleVersionId: string;
    localLifecycleStatus: string;
    contentHash: string;
    typedRuleKey?: string;
    activationTimestamp?: string | null;
    idempotencyKey: string;
  }): { registrationId: string; idempotentReplay: boolean } {
    const existing = this.db
      .prepare(
        `SELECT registration_id, content_hash FROM lp_legacy_local_registrations
         WHERE idempotency_key = ?`
      )
      .get(input.idempotencyKey) as
      | { registration_id: string; content_hash: string }
      | undefined;
    if (existing) {
      if (existing.content_hash !== input.contentHash) {
        throw new AppError({
          code: "IDEMPOTENCY_CONFLICT",
          message: "Legacy registration key reused with different content."
        });
      }
      return { registrationId: existing.registration_id, idempotentReplay: true };
    }
    const registrationId = newId("llreg");
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO lp_legacy_local_registrations (
          registration_id, local_rule_id, local_rule_version_id, local_lifecycle_status,
          content_hash, typed_rule_key, activation_timestamp, idempotency_key,
          status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
      )
      .run(
        registrationId,
        input.localRuleId,
        input.localRuleVersionId,
        input.localLifecycleStatus,
        input.contentHash,
        input.typedRuleKey ?? null,
        input.activationTimestamp ?? null,
        input.idempotencyKey,
        now,
        now
      );
    return { registrationId, idempotentReplay: false };
  }
}

export function buildAllowlistedSharePayload(input: {
  title: string;
  summary: string;
  rationale: string;
  ruleType: string;
  currentVersion: string;
  candidateVersion: string;
  localProposalId: string;
  localProposalVersionId: string;
  localRuleId: string;
  localRuleVersionId: string;
  localContentHash: string;
  idempotencyKey: string;
}): Record<string, unknown> {
  const evidence = [
    {
      evidenceId: `ev_${input.localProposalVersionId}`,
      kind: "local_proposal_ref" as const,
      reference: `${input.localProposalId}@${input.localProposalVersionId}`,
      summary: "MAA typed procedural proposal reference"
    },
    {
      evidenceId: `ev_rule_${input.localRuleVersionId}`,
      kind: "local_rule_ref" as const,
      reference: `${input.localRuleId}@${input.localRuleVersionId}`,
      summary: `typed rule ${input.ruleType}`
    }
  ];
  for (const item of evidence) {
    if (
      !(ALLOWED_GOVERNANCE_EVIDENCE_KINDS as readonly string[]).includes(item.kind)
    ) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: `Evidence kind ${item.kind} is not allowlisted.`
      });
    }
  }
  const payload = {
    title: input.title.slice(0, 256),
    summary: input.summary.slice(0, 4000),
    changeType: "typed_rule",
    scope: "agent_private",
    currentVersion: input.currentVersion,
    candidateVersion: input.candidateVersion,
    rationale: input.rationale.slice(0, 8000),
    sourceExperienceReferences: [],
    evidenceReferences: evidence,
    limitations: ["maa-typed-procedural", "approval-does-not-activate"],
    idempotencyKey: input.idempotencyKey,
    productionBridge: true,
    localProposalId: input.localProposalId,
    localProposalVersionId: input.localProposalVersionId,
    localRuleId: input.localRuleId,
    localRuleVersionId: input.localRuleVersionId,
    localContentHash: input.localContentHash
  };
  try {
    assertNoProhibitedBridgeFields(payload, "sharePayload");
  } catch (error) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      message: error instanceof Error ? error.message : "Prohibited bridge field."
    });
  }
  return payload;
}

export { sha256Json, newId };
