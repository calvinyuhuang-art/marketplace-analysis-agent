import { createHash, randomUUID } from "node:crypto";
import type { SqliteDatabase } from "@maa/database";
import type { LpAdapterSettingsRow, RegistrationStatus } from "./contracts.js";
import { MAA_LP_ADAPTER_ID } from "./config.js";

const now = () => new Date().toISOString();

export type OutboxStatus =
  | "waiting_for_causation"
  | "pending"
  | "claimed"
  | "retry_scheduled"
  | "published"
  | "permanent_failure"
  | "cancelled";

export type InboxProcessingStatus =
  | "received"
  | "awaiting_local_reconciliation"
  | "reconciled"
  | "semantic_conflict"
  | "permanent_failure";

export type AckStatus =
  | "pending"
  | "claimed"
  | "retry_scheduled"
  | "acknowledged"
  | "permanent_failure";

export type LpOutboxRow = {
  outbox_id: string;
  source_record_type: string | null;
  source_record_id: string | null;
  source_record_version: string | null;
  workflow_feedback_id: string | null;
  resolution_id: string | null;
  evaluation_id: string | null;
  event_type: string;
  payload_schema_version: string;
  target_agent_id: string | null;
  work_order_id: string | null;
  correlation_id: string | null;
  causation_event_id: string | null;
  source_experience_id: string | null;
  idempotency_key: string;
  payload_json: string | null;
  payload_sha256: string | null;
  status: OutboxStatus;
  attempt_count: number;
  next_attempt_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  learning_plane_event_id: string | null;
  last_error_code: string | null;
  last_bounded_error: string | null;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

export type LpInboxRow = {
  inbox_id: string;
  event_id: string;
  delivery_id: string;
  source_agent_id: string | null;
  target_agent_id: string | null;
  event_type: string;
  payload_schema_version: string | null;
  correlation_id: string | null;
  causation_event_id: string | null;
  workflow_feedback_id: string | null;
  resolution_id: string | null;
  resolution_type: string | null;
  producer_contract_name: string | null;
  producer_contract_version: string | null;
  operational_resolution_ref_json: string | null;
  payload_json: string | null;
  payload_sha256: string | null;
  received_at: string;
  processing_status: InboxProcessingStatus;
  processed_at: string | null;
  local_resolution_ref: string | null;
  acknowledgement_status: string;
  acknowledged_at: string | null;
  last_error_code: string | null;
  last_bounded_error: string | null;
};

export type LpAckRow = {
  acknowledgement_id: string;
  inbox_id: string | null;
  event_id: string;
  delivery_id: string;
  acknowledgement_kind: "ack" | "nack";
  status: AckStatus;
  attempt_count: number;
  next_attempt_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  last_error_code: string | null;
  last_bounded_error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export class LearningPlaneAdapterRepository {
  constructor(private readonly db: SqliteDatabase) {}

  get dbHandle(): SqliteDatabase {
    return this.db;
  }

  tablesPresent(): boolean {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name IN ('lp_adapter_settings','lp_adapter_outbox','lp_adapter_inbox','lp_adapter_acknowledgements','lp_adapter_processing_events')"
      )
      .get() as { c: number };
    return Number(row.c) === 5;
  }

  getSettings(): LpAdapterSettingsRow | null {
    return (
      (this.db
        .prepare("SELECT * FROM lp_adapter_settings WHERE adapter_id = ?")
        .get(MAA_LP_ADAPTER_ID) as LpAdapterSettingsRow | undefined) ?? null
    );
  }

  upsertSettings(input: {
    agentId: string;
    learningPlaneBaseUrl: string;
    learningPlaneApiCompat?: string | null;
    registrationStatus: RegistrationStatus;
    credentialId?: string | null;
    callbackKeyId?: string | null;
    callbackPath?: string | null;
    enabled: boolean;
    publishEnabled: boolean;
    receiveEnabled: boolean;
    lastRegistrationCheckAt?: string | null;
    lastHealthReportAt?: string | null;
    lastSuccessfulConnectionAt?: string | null;
    lastErrorCode?: string | null;
    lastBoundedError?: string | null;
  }): LpAdapterSettingsRow {
    const existing = this.getSettings();
    const timestamp = now();
    if (!existing) {
      this.db
        .prepare(
          `INSERT INTO lp_adapter_settings (
            adapter_id, agent_id, learning_plane_base_url, learning_plane_api_compat,
            registration_status, credential_id, callback_key_id, callback_path,
            enabled, publish_enabled, receive_enabled,
            last_registration_check_at, last_health_report_at, last_successful_connection_at,
            last_error_code, last_bounded_error, created_at, updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        )
        .run(
          MAA_LP_ADAPTER_ID,
          input.agentId,
          input.learningPlaneBaseUrl,
          input.learningPlaneApiCompat ?? null,
          input.registrationStatus,
          input.credentialId ?? null,
          input.callbackKeyId ?? null,
          input.callbackPath ?? null,
          input.enabled ? 1 : 0,
          input.publishEnabled ? 1 : 0,
          input.receiveEnabled ? 1 : 0,
          input.lastRegistrationCheckAt ?? null,
          input.lastHealthReportAt ?? null,
          input.lastSuccessfulConnectionAt ?? null,
          input.lastErrorCode ?? null,
          input.lastBoundedError ?? null,
          timestamp,
          timestamp
        );
    } else {
      this.db
        .prepare(
          `UPDATE lp_adapter_settings SET
            agent_id=?, learning_plane_base_url=?, learning_plane_api_compat=?,
            registration_status=?, credential_id=?, callback_key_id=?, callback_path=?,
            enabled=?, publish_enabled=?, receive_enabled=?,
            last_registration_check_at=?, last_health_report_at=?, last_successful_connection_at=?,
            last_error_code=?, last_bounded_error=?, updated_at=?
          WHERE adapter_id=?`
        )
        .run(
          input.agentId,
          input.learningPlaneBaseUrl,
          input.learningPlaneApiCompat ?? null,
          input.registrationStatus,
          input.credentialId ?? null,
          input.callbackKeyId ?? null,
          input.callbackPath ?? null,
          input.enabled ? 1 : 0,
          input.publishEnabled ? 1 : 0,
          input.receiveEnabled ? 1 : 0,
          input.lastRegistrationCheckAt ?? existing.last_registration_check_at,
          input.lastHealthReportAt ?? existing.last_health_report_at,
          input.lastSuccessfulConnectionAt ?? existing.last_successful_connection_at,
          input.lastErrorCode ?? null,
          input.lastBoundedError ?? null,
          timestamp,
          MAA_LP_ADAPTER_ID
        );
    }
    return this.getSettings()!;
  }

  recordProcessingEvent(input: {
    eventKind: string;
    detail?: Record<string, unknown>;
    correlationId?: string | null;
    relatedOutboxId?: string | null;
    relatedInboxId?: string | null;
    relatedAcknowledgementId?: string | null;
  }): string {
    const id = `lppe_${randomUUID()}`;
    this.db
      .prepare(
        `INSERT INTO lp_adapter_processing_events (
          processing_event_id, event_kind, related_outbox_id, related_inbox_id,
          related_acknowledgement_id, correlation_id, detail_json, created_at
        ) VALUES (?,?,?,?,?,?,?,?)`
      )
      .run(
        id,
        input.eventKind,
        input.relatedOutboxId ?? null,
        input.relatedInboxId ?? null,
        input.relatedAcknowledgementId ?? null,
        input.correlationId ?? null,
        JSON.stringify(input.detail ?? {}),
        now()
      );
    return id;
  }

  countByStatus(
    table: "lp_adapter_outbox" | "lp_adapter_inbox" | "lp_adapter_acknowledgements",
    column: string
  ): Record<string, number> {
    const rows = this.db
      .prepare(`SELECT ${column} AS status, COUNT(*) AS c FROM ${table} GROUP BY ${column}`)
      .all() as Array<{ status: string; c: number }>;
    return Object.fromEntries(rows.map((row) => [row.status, Number(row.c)]));
  }

  processingEventCount(): number {
    return Number(
      (this.db.prepare("SELECT COUNT(*) AS c FROM lp_adapter_processing_events").get() as { c: number })
        .c
    );
  }

  insertOutbox(input: {
    sourceRecordType: string;
    sourceRecordId: string;
    sourceRecordVersion: string;
    workflowFeedbackId: string;
    resolutionId?: string | null;
    evaluationId?: string | null;
    eventType: string;
    payloadSchemaVersion: string;
    targetAgentId: string;
    workOrderId?: string | null;
    correlationId: string;
    causationEventId?: string | null;
    sourceExperienceId?: string | null;
    idempotencyKey: string;
    payload: unknown;
    status: OutboxStatus;
  }): { outboxId: string; created: boolean } {
    const existing = this.db
      .prepare(`SELECT outbox_id FROM lp_adapter_outbox WHERE idempotency_key = ?`)
      .get(input.idempotencyKey) as { outbox_id: string } | undefined;
    if (existing) return { outboxId: existing.outbox_id, created: false };

    const bySource = this.db
      .prepare(
        `SELECT outbox_id FROM lp_adapter_outbox
         WHERE event_type = ? AND source_record_type = ? AND source_record_id = ? AND source_record_version = ?`
      )
      .get(
        input.eventType,
        input.sourceRecordType,
        input.sourceRecordId,
        input.sourceRecordVersion
      ) as { outbox_id: string } | undefined;
    if (bySource) return { outboxId: bySource.outbox_id, created: false };

    const outboxId = `lpox_${randomUUID()}`;
    const timestamp = now();
    const payloadJson = JSON.stringify(input.payload);
    this.db
      .prepare(
        `INSERT INTO lp_adapter_outbox (
          outbox_id, source_record_type, source_record_id, source_record_version,
          workflow_feedback_id, resolution_id, evaluation_id, event_type, payload_schema_version,
          target_agent_id, work_order_id, correlation_id, causation_event_id, source_experience_id,
          idempotency_key, payload_json, payload_sha256, status, attempt_count, next_attempt_at,
          created_at, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?)`
      )
      .run(
        outboxId,
        input.sourceRecordType,
        input.sourceRecordId,
        input.sourceRecordVersion,
        input.workflowFeedbackId,
        input.resolutionId ?? null,
        input.evaluationId ?? null,
        input.eventType,
        input.payloadSchemaVersion,
        input.targetAgentId,
        input.workOrderId ?? null,
        input.correlationId,
        input.causationEventId ?? null,
        input.sourceExperienceId ?? null,
        input.idempotencyKey,
        payloadJson,
        sha256Json(input.payload),
        input.status,
        input.status === "pending" ? timestamp : null,
        timestamp,
        timestamp
      );
    return { outboxId, created: true };
  }

  getOutbox(outboxId: string): LpOutboxRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM lp_adapter_outbox WHERE outbox_id = ?`)
        .get(outboxId) as LpOutboxRow | undefined) ?? null
    );
  }

  listOutboxByStatus(statuses: OutboxStatus[], limit = 50): LpOutboxRow[] {
    const placeholders = statuses.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT * FROM lp_adapter_outbox
         WHERE status IN (${placeholders})
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(...statuses, now(), limit) as LpOutboxRow[];
  }

  claimOutbox(outboxId: string, leaseOwner: string, leaseMs: number): LpOutboxRow | null {
    const timestamp = now();
    const expires = new Date(Date.now() + leaseMs).toISOString();
    const result = this.db
      .prepare(
        `UPDATE lp_adapter_outbox SET
           status='claimed', lease_owner=?, lease_expires_at=?, updated_at=?,
           attempt_count = attempt_count + 1
         WHERE outbox_id=?
           AND (
             status IN ('pending','retry_scheduled')
             OR (status='claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
           )`
      )
      .run(leaseOwner, expires, timestamp, outboxId, timestamp);
    if (result.changes === 0) return null;
    return this.getOutbox(outboxId);
  }

  markOutboxPublished(outboxId: string, learningPlaneEventId: string): void {
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE lp_adapter_outbox SET
           status='published', learning_plane_event_id=?, published_at=?, updated_at=?,
           lease_owner=NULL, lease_expires_at=NULL, last_error_code=NULL, last_bounded_error=NULL
         WHERE outbox_id=?`
      )
      .run(learningPlaneEventId, timestamp, timestamp, outboxId);
  }

  markOutboxRetry(outboxId: string, delayMs: number, code: string, message: string): void {
    const timestamp = now();
    const next = new Date(Date.now() + delayMs).toISOString();
    this.db
      .prepare(
        `UPDATE lp_adapter_outbox SET
           status='retry_scheduled', next_attempt_at=?, updated_at=?,
           lease_owner=NULL, lease_expires_at=NULL,
           last_error_code=?, last_bounded_error=?
         WHERE outbox_id=?`
      )
      .run(next, timestamp, code, message.slice(0, 500), outboxId);
  }

  markOutboxPermanentFailure(outboxId: string, code: string, message: string): void {
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE lp_adapter_outbox SET
           status='permanent_failure', updated_at=?,
           lease_owner=NULL, lease_expires_at=NULL,
           last_error_code=?, last_bounded_error=?
         WHERE outbox_id=?`
      )
      .run(timestamp, code, message.slice(0, 500), outboxId);
  }

  releaseWaitingEvaluated(input: {
    workflowFeedbackId: string;
    resolutionId: string;
    causationEventId: string;
    correlationId: string;
    parentEventType?: string;
  }): { released: number; mismatches: number; alreadyResolved: number } {
    const timestamp = now();
    if (
      input.parentEventType &&
      input.parentEventType !== "workflow_feedback.resolution_submitted"
    ) {
      this.recordProcessingEvent({
        eventKind: "learning_plane.evaluated.causation_mismatch",
        correlationId: input.correlationId,
        detail: {
          reason: "invalid_parent_event_type",
          parentEventType: input.parentEventType,
          workflowFeedbackId: input.workflowFeedbackId,
          resolutionId: input.resolutionId,
          causationEventId: input.causationEventId
        }
      });
      return { released: 0, mismatches: 1, alreadyResolved: 0 };
    }

    const waiting = this.db
      .prepare(
        `SELECT * FROM lp_adapter_outbox
         WHERE event_type='workflow_feedback.resolution_evaluated'
           AND status='waiting_for_causation'
           AND workflow_feedback_id=?`
      )
      .all(input.workflowFeedbackId) as LpOutboxRow[];

    let released = 0;
    let mismatches = 0;
    let alreadyResolved = 0;

    for (const row of waiting) {
      if (row.resolution_id !== input.resolutionId) {
        mismatches += 1;
        this.recordProcessingEvent({
          eventKind: "learning_plane.evaluated.causation_mismatch",
          relatedOutboxId: row.outbox_id,
          correlationId: row.correlation_id,
          detail: {
            reason: "resolution_id_mismatch",
            expectedResolutionId: row.resolution_id,
            parentResolutionId: input.resolutionId,
            workflowFeedbackId: input.workflowFeedbackId,
            payloadSha256: row.payload_sha256,
            idempotencyKey: row.idempotency_key
          }
        });
        this.recordProcessingEvent({
          eventKind: "learning_plane.evaluated.identity_mutation_rejected",
          relatedOutboxId: row.outbox_id,
          correlationId: row.correlation_id,
          detail: { field: "resolution_id" }
        });
        continue;
      }

      if (row.correlation_id !== input.correlationId) {
        mismatches += 1;
        this.recordProcessingEvent({
          eventKind: "learning_plane.evaluated.causation_mismatch",
          relatedOutboxId: row.outbox_id,
          correlationId: row.correlation_id,
          detail: {
            reason: "correlation_id_mismatch",
            expectedCorrelationId: row.correlation_id,
            parentCorrelationId: input.correlationId,
            workflowFeedbackId: input.workflowFeedbackId,
            resolutionId: row.resolution_id,
            payloadSha256: row.payload_sha256,
            idempotencyKey: row.idempotency_key
          }
        });
        this.recordProcessingEvent({
          eventKind: "learning_plane.evaluated.identity_mutation_rejected",
          relatedOutboxId: row.outbox_id,
          correlationId: row.correlation_id,
          detail: { field: "correlation_id" }
        });
        continue;
      }

      if (row.causation_event_id) {
        alreadyResolved += 1;
        this.recordProcessingEvent({
          eventKind: "learning_plane.evaluated.causation_already_resolved",
          relatedOutboxId: row.outbox_id,
          correlationId: row.correlation_id,
          detail: {
            existingCausationEventId: row.causation_event_id,
            offeredCausationEventId: input.causationEventId
          }
        });
        continue;
      }

      const result = this.db
        .prepare(
          `UPDATE lp_adapter_outbox SET
             status='pending',
             causation_event_id=?,
             next_attempt_at=?,
             updated_at=?
           WHERE outbox_id=?
             AND status='waiting_for_causation'
             AND causation_event_id IS NULL
             AND resolution_id=?
             AND correlation_id=?
             AND idempotency_key=?
             AND payload_sha256=?`
        )
        .run(
          input.causationEventId,
          timestamp,
          timestamp,
          row.outbox_id,
          row.resolution_id,
          row.correlation_id,
          row.idempotency_key,
          row.payload_sha256
        );

      if (result.changes === 0) {
        this.recordProcessingEvent({
          eventKind: "learning_plane.evaluated.identity_mutation_rejected",
          relatedOutboxId: row.outbox_id,
          correlationId: row.correlation_id,
          detail: { reason: "concurrent_identity_guard" }
        });
        continue;
      }

      released += result.changes;
      this.recordProcessingEvent({
        eventKind: "learning_plane.evaluated.causation_resolved",
        relatedOutboxId: row.outbox_id,
        correlationId: row.correlation_id,
        detail: {
          causationEventId: input.causationEventId,
          resolutionId: row.resolution_id,
          evaluationId: row.evaluation_id,
          idempotencyKey: row.idempotency_key,
          payloadSha256: row.payload_sha256
        }
      });
    }

    return { released, mismatches, alreadyResolved };
  }

  findWaitingEvaluated(workflowFeedbackId: string, resolutionId: string): LpOutboxRow[] {
    return this.db
      .prepare(
        `SELECT * FROM lp_adapter_outbox
         WHERE event_type='workflow_feedback.resolution_evaluated'
           AND status='waiting_for_causation'
           AND workflow_feedback_id=?
           AND resolution_id=?`
      )
      .all(workflowFeedbackId, resolutionId) as LpOutboxRow[];
  }

  insertInboxIfNew(input: {
    eventId: string;
    deliveryId: string;
    sourceAgentId: string;
    targetAgentId: string;
    eventType: string;
    payloadSchemaVersion: string;
    correlationId: string;
    causationEventId?: string | null;
    workflowFeedbackId: string;
    resolutionId: string;
    resolutionType: string;
    producerContractName: string;
    producerContractVersion: string;
    operationalResolutionRef: unknown;
    payload: unknown;
    processingStatus: InboxProcessingStatus;
  }): { inboxId: string; created: boolean } {
    const byEvent = this.db
      .prepare(`SELECT inbox_id FROM lp_adapter_inbox WHERE event_id = ?`)
      .get(input.eventId) as { inbox_id: string } | undefined;
    if (byEvent) return { inboxId: byEvent.inbox_id, created: false };
    const byDelivery = this.db
      .prepare(`SELECT inbox_id FROM lp_adapter_inbox WHERE delivery_id = ?`)
      .get(input.deliveryId) as { inbox_id: string } | undefined;
    if (byDelivery) return { inboxId: byDelivery.inbox_id, created: false };

    const inboxId = `lpin_${randomUUID()}`;
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO lp_adapter_inbox (
          inbox_id, event_id, delivery_id, source_agent_id, target_agent_id, event_type,
          payload_schema_version, correlation_id, causation_event_id,
          workflow_feedback_id, resolution_id, resolution_type,
          producer_contract_name, producer_contract_version,
          operational_resolution_ref_json, payload_json, payload_sha256,
          received_at, processing_status, acknowledgement_status
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')`
      )
      .run(
        inboxId,
        input.eventId,
        input.deliveryId,
        input.sourceAgentId,
        input.targetAgentId,
        input.eventType,
        input.payloadSchemaVersion,
        input.correlationId,
        input.causationEventId ?? null,
        input.workflowFeedbackId,
        input.resolutionId,
        input.resolutionType,
        input.producerContractName,
        input.producerContractVersion,
        JSON.stringify(input.operationalResolutionRef),
        JSON.stringify(input.payload),
        sha256Json(input.payload),
        timestamp,
        input.processingStatus
      );
    return { inboxId, created: true };
  }

  getInbox(inboxId: string): LpInboxRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM lp_adapter_inbox WHERE inbox_id = ?`)
        .get(inboxId) as LpInboxRow | undefined) ?? null
    );
  }

  getInboxByEventId(eventId: string): LpInboxRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM lp_adapter_inbox WHERE event_id = ?`)
        .get(eventId) as LpInboxRow | undefined) ?? null
    );
  }

  listInboxByProcessingStatus(statuses: InboxProcessingStatus[], limit = 50): LpInboxRow[] {
    const placeholders = statuses.map(() => "?").join(",");
    return this.db
      .prepare(
        `SELECT * FROM lp_adapter_inbox
         WHERE processing_status IN (${placeholders})
         ORDER BY received_at ASC
         LIMIT ?`
      )
      .all(...statuses, limit) as LpInboxRow[];
  }

  updateInboxProcessing(
    inboxId: string,
    status: InboxProcessingStatus,
    opts?: {
      localResolutionRef?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    }
  ): void {
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE lp_adapter_inbox SET
           processing_status=?, processed_at=?, local_resolution_ref=COALESCE(?, local_resolution_ref),
           last_error_code=?, last_bounded_error=?
         WHERE inbox_id=?`
      )
      .run(
        status,
        status === "reconciled" || status === "semantic_conflict" || status === "permanent_failure"
          ? timestamp
          : null,
        opts?.localResolutionRef ?? null,
        opts?.errorCode ?? null,
        opts?.errorMessage?.slice(0, 500) ?? null,
        inboxId
      );
  }

  findReconciledSubmitted(
    workflowFeedbackId: string,
    resolutionId?: string | null
  ): LpInboxRow | null {
    if (resolutionId) {
      return (
        (this.db
          .prepare(
            `SELECT * FROM lp_adapter_inbox
             WHERE event_type='workflow_feedback.resolution_submitted'
               AND processing_status='reconciled'
               AND workflow_feedback_id=?
               AND resolution_id=?
             ORDER BY received_at DESC LIMIT 1`
          )
          .get(workflowFeedbackId, resolutionId) as LpInboxRow | undefined) ?? null
      );
    }
    return (
      (this.db
        .prepare(
          `SELECT * FROM lp_adapter_inbox
           WHERE event_type='workflow_feedback.resolution_submitted'
             AND processing_status='reconciled'
             AND workflow_feedback_id=?
           ORDER BY received_at DESC LIMIT 1`
        )
        .get(workflowFeedbackId) as LpInboxRow | undefined) ?? null
    );
  }

  insertAckIfNew(input: {
    inboxId: string;
    eventId: string;
    deliveryId: string;
  }): { acknowledgementId: string; created: boolean } {
    const existing = this.db
      .prepare(`SELECT acknowledgement_id FROM lp_adapter_acknowledgements WHERE delivery_id = ?`)
      .get(input.deliveryId) as { acknowledgement_id: string } | undefined;
    if (existing) return { acknowledgementId: existing.acknowledgement_id, created: false };
    const acknowledgementId = `lpak_${randomUUID()}`;
    const timestamp = now();
    this.db
      .prepare(
        `INSERT INTO lp_adapter_acknowledgements (
          acknowledgement_id, inbox_id, event_id, delivery_id, acknowledgement_kind,
          status, attempt_count, next_attempt_at, created_at, updated_at
        ) VALUES (?,?,?,?, 'ack', 'pending', 0, ?, ?, ?)`
      )
      .run(
        acknowledgementId,
        input.inboxId,
        input.eventId,
        input.deliveryId,
        timestamp,
        timestamp,
        timestamp
      );
    return { acknowledgementId, created: true };
  }

  listPendingAcks(limit = 50): LpAckRow[] {
    return this.db
      .prepare(
        `SELECT * FROM lp_adapter_acknowledgements
         WHERE status IN ('pending','retry_scheduled')
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at ASC
         LIMIT ?`
      )
      .all(now(), limit) as LpAckRow[];
  }

  getAck(acknowledgementId: string): LpAckRow | null {
    return (
      (this.db
        .prepare(`SELECT * FROM lp_adapter_acknowledgements WHERE acknowledgement_id = ?`)
        .get(acknowledgementId) as LpAckRow | undefined) ?? null
    );
  }

  claimAck(acknowledgementId: string, leaseOwner: string, leaseMs: number): LpAckRow | null {
    const timestamp = now();
    const expires = new Date(Date.now() + leaseMs).toISOString();
    const result = this.db
      .prepare(
        `UPDATE lp_adapter_acknowledgements SET
           status='claimed', lease_owner=?, lease_expires_at=?, updated_at=?,
           attempt_count = attempt_count + 1
         WHERE acknowledgement_id=?
           AND (
             status IN ('pending','retry_scheduled')
             OR (status='claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at < ?)
           )`
      )
      .run(leaseOwner, expires, timestamp, acknowledgementId, timestamp);
    if (result.changes === 0) return null;
    return (
      (this.db
        .prepare(`SELECT * FROM lp_adapter_acknowledgements WHERE acknowledgement_id = ?`)
        .get(acknowledgementId) as LpAckRow | undefined) ?? null
    );
  }

  markAckSucceeded(acknowledgementId: string, inboxId: string | null): void {
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE lp_adapter_acknowledgements SET
           status='acknowledged', completed_at=?, updated_at=?,
           lease_owner=NULL, lease_expires_at=NULL,
           last_error_code=NULL, last_bounded_error=NULL
         WHERE acknowledgement_id=?`
      )
      .run(timestamp, timestamp, acknowledgementId);
    if (inboxId) {
      this.db
        .prepare(
          `UPDATE lp_adapter_inbox SET acknowledgement_status='acked', acknowledged_at=? WHERE inbox_id=?`
        )
        .run(timestamp, inboxId);
    }
  }

  markAckRetry(acknowledgementId: string, delayMs: number, code: string, message: string): void {
    const timestamp = now();
    const next = new Date(Date.now() + delayMs).toISOString();
    this.db
      .prepare(
        `UPDATE lp_adapter_acknowledgements SET
           status='retry_scheduled', next_attempt_at=?, updated_at=?,
           lease_owner=NULL, lease_expires_at=NULL,
           last_error_code=?, last_bounded_error=?
         WHERE acknowledgement_id=?`
      )
      .run(next, timestamp, code, message.slice(0, 500), acknowledgementId);
  }

  markAckPermanentFailure(acknowledgementId: string, code: string, message: string): void {
    const timestamp = now();
    this.db
      .prepare(
        `UPDATE lp_adapter_acknowledgements SET
           status='permanent_failure', updated_at=?, completed_at=?,
           lease_owner=NULL, lease_expires_at=NULL,
           last_error_code=?, last_bounded_error=?
         WHERE acknowledgement_id=?`
      )
      .run(timestamp, timestamp, code, message.slice(0, 500), acknowledgementId);
  }

  oldestPendingAgeSeconds(): number | null {
    const row = this.db
      .prepare(
        `SELECT MIN(created_at) AS oldest FROM lp_adapter_outbox
         WHERE status IN ('pending','retry_scheduled','claimed','waiting_for_causation')`
      )
      .get() as { oldest: string | null };
    if (!row.oldest) return null;
    return Math.max(0, Math.floor((Date.now() - Date.parse(row.oldest)) / 1000));
  }

  lastPublishedAt(): string | null {
    const row = this.db
      .prepare(
        `SELECT MAX(published_at) AS ts FROM lp_adapter_outbox WHERE status='published'`
      )
      .get() as { ts: string | null };
    return row.ts ?? null;
  }

  lastReceivedAt(): string | null {
    const row = this.db
      .prepare(`SELECT MAX(received_at) AS ts FROM lp_adapter_inbox`)
      .get() as { ts: string | null };
    return row.ts ?? null;
  }

  lastAcknowledgedAt(): string | null {
    const row = this.db
      .prepare(
        `SELECT MAX(completed_at) AS ts FROM lp_adapter_acknowledgements WHERE status='acknowledged'`
      )
      .get() as { ts: string | null };
    return row.ts ?? null;
  }

  listRecentProcessingEvents(limit = 50): Array<Record<string, unknown>> {
    return this.db
      .prepare(
        `SELECT * FROM lp_adapter_processing_events ORDER BY created_at DESC LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>;
  }

  listRecentOutbox(limit = 50): LpOutboxRow[] {
    return this.db
      .prepare(`SELECT * FROM lp_adapter_outbox ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as LpOutboxRow[];
  }

  listRecentInbox(limit = 50): LpInboxRow[] {
    return this.db
      .prepare(`SELECT * FROM lp_adapter_inbox ORDER BY received_at DESC LIMIT ?`)
      .all(limit) as LpInboxRow[];
  }
}
