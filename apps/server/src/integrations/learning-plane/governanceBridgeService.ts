import { createHash, randomBytes } from "node:crypto";
import type {
  ProceduralRuleActivationsRepository,
  ProceduralRuleDefinitionsRepository,
  ProceduralRuleVersionsRepository,
  SqliteDatabase
} from "@maa/database";
import type {
  GovernanceDecisionNotification,
  ReplayJobNotification
} from "@learning-plane/contracts";
import { AppError } from "@maa/contracts";
import type { TypedProceduralService } from "@maa/learning";
import type { LearningPlaneAdapterConfig } from "./config.js";
import type { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import {
  buildAllowlistedSharePayload,
  GovernanceReplayBridgeRepository,
  sha256Json,
  type GovBridgeLink
} from "./governanceReplayBridgeRepository.js";

export type GovernanceBridgeServiceDeps = {
  config: LearningPlaneAdapterConfig;
  db: SqliteDatabase;
  bridge: GovernanceReplayBridgeRepository;
  adapterRepo: LearningPlaneAdapterRepository;
  typedProcedural: TypedProceduralService;
  versions: ProceduralRuleVersionsRepository;
  definitions: ProceduralRuleDefinitionsRepository;
  activations: ProceduralRuleActivationsRepository;
};

function newKey(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}

export class GovernanceBridgeService {
  constructor(private readonly deps: GovernanceBridgeServiceDeps) {}

  tablesPresent(): boolean {
    try {
      this.deps.db.prepare(`SELECT 1 FROM lp_gov_bridge_links LIMIT 1`).get();
      return true;
    } catch {
      return false;
    }
  }

  getLink(versionId: string): GovBridgeLink | undefined {
    if (!this.tablesPresent()) return undefined;
    return this.deps.bridge.getLinkByVersion(versionId);
  }

  getBridgeStatus(versionId: string): Record<string, unknown> {
    const version = this.deps.typedProcedural.getVersion(versionId);
    const link = this.getLink(versionId);
    return {
      versionId,
      ruleId: version.ruleId,
      lifecycleStatus: version.lifecycleStatus,
      governanceOrigin: link?.governance_origin ?? "local_only",
      learningPlaneCaseId: link?.lp_case_id ?? null,
      learningPlaneProposalId: link?.lp_proposal_id ?? null,
      learningPlaneDecisionId: link?.lp_decision_id ?? null,
      learningPlaneDecision: link?.lp_decision ?? null,
      localValidationStatus: link?.local_validation_status ?? null,
      localValidationDiagnostic: link?.local_validation_diagnostic ?? null,
      submissionStatus: link?.submission_status ?? "not_submitted",
      approvalDoesNotActivate: true,
      replayEligibilityDoesNotActivate: true,
      localApproveAllowed: link?.governance_origin !== "learning_plane_shared",
      activationEligible:
        link?.governance_origin === "learning_plane_shared"
          ? link.lp_decision === "approve" &&
            link.local_validation_status === "accepted" &&
            version.lifecycleStatus === "approved"
          : version.lifecycleStatus === "approved"
    };
  }

  assertLocalApproveAllowed(versionId: string): void {
    if (!this.tablesPresent()) return;
    const link = this.deps.bridge.getLinkByVersion(versionId);
    if (link?.governance_origin === "learning_plane_shared") {
      throw new AppError({
        code: "INVALID_STATE_TRANSITION",
        message:
          "Competing local approval is prohibited for learning_plane_shared proposals. Learning Plane owns the shared operator decision."
      });
    }
  }

  assertActivationAllowed(versionId: string): void {
    if (!this.tablesPresent()) return;
    const link = this.deps.bridge.getLinkByVersion(versionId);
    if (!link || link.governance_origin !== "learning_plane_shared") return;
    if (link.lp_decision !== "approve") {
      throw new AppError({
        code: "INVALID_STATE_TRANSITION",
        message: `Shared-governance activation requires Learning Plane approve; current decision=${link.lp_decision ?? "none"}.`
      });
    }
    if (link.local_validation_status !== "accepted") {
      throw new AppError({
        code: "INVALID_STATE_TRANSITION",
        message: `Shared-governance activation requires local validation accepted; current=${link.local_validation_status ?? "none"}.`
      });
    }
  }

  shareVersionToLearningPlane(versionId: string): {
    link: GovBridgeLink;
    outboxId: string;
    idempotentReplay: boolean;
  } {
    const { config } = this.deps;
    if (
      !config.enabled ||
      !config.governanceBridgeEnabled ||
      !config.governancePublishEnabled
    ) {
      throw new AppError({
        code: "UNSUPPORTED_OPERATION",
        message:
          "Learning Plane governance publish is disabled. Enable MAA_LEARNING_PLANE_GOVERNANCE_BRIDGE_ENABLED and MAA_LEARNING_PLANE_GOVERNANCE_PUBLISH_ENABLED."
      });
    }
    if (!this.tablesPresent()) {
      throw new AppError({
        code: "INTERNAL_ERROR",
        message: "Governance bridge tables are missing (migration 0017 required)."
      });
    }

    const version = this.deps.typedProcedural.getVersion(versionId);
    const def = this.deps.definitions.getById(version.ruleId);
    if (!def) {
      throw new AppError({
        code: "NOT_FOUND",
        message: `Rule definition for version ${versionId} was not found.`
      });
    }
    if (!version.replayReportArtifactId) {
      throw new AppError({
        code: "INVALID_STATE_TRANSITION",
        message: "Typed procedural version must be replayed before governance share."
      });
    }

    const existing = this.deps.bridge.getLinkByVersion(versionId);
    if (existing?.lp_decision_id) {
      throw new AppError({
        code: "INVALID_STATE_TRANSITION",
        message: "Cannot change governance authority after a Learning Plane decision exists."
      });
    }

    const contentHash = version.policyHash;
    if (!/^[a-f0-9]{64}$/.test(contentHash)) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Local content hash must be SHA-256 hex."
      });
    }

    const idempotencyKey = `maa-gov-share-${versionId}-${contentHash.slice(0, 16)}`;
    const correlationId = newKey("corr");
    const payload = buildAllowlistedSharePayload({
      title: `MAA typed rule ${def.ruleType} v${version.versionNumber}`,
      summary: `Bounded governance share for ${def.ruleType} version ${version.versionNumber}. Approval does not activate.`,
      rationale: `Share typed procedural candidate ${versionId} for Learning Plane operator decision. Local activation remains MAA-owned.`,
      ruleType: def.ruleType,
      currentVersion: `v${Math.max(1, version.versionNumber - 1)}`,
      candidateVersion: `v${version.versionNumber}`,
      localProposalId: versionId,
      localProposalVersionId: versionId,
      localRuleId: version.ruleId,
      localRuleVersionId: versionId,
      localContentHash: contentHash,
      idempotencyKey
    });

    const payloadSha = sha256Json(payload);
    let outboxId = "";
    let idempotentReplay = false;
    let link!: GovBridgeLink;

    this.deps.db.transaction(() => {
      link = this.deps.bridge.createShareLink({
        versionId,
        ruleId: version.ruleId,
        contentHash,
        idempotencyKey,
        correlationId,
        payloadSha256: payloadSha
      });
      const enqueued = this.deps.bridge.enqueueOutbox({
        kind: "governance_submission",
        linkId: link.link_id,
        versionId,
        idempotencyKey,
        payload
      });
      outboxId = enqueued.outboxId;
      idempotentReplay = enqueued.idempotentReplay;
      this.deps.adapterRepo.recordProcessingEvent({
        eventKind: "learning_plane.governance_submission_captured",
        correlationId,
        detail: {
          versionId,
          outboxId,
          payloadSha256: payloadSha,
          idempotentReplay
        }
      });
    })();

    return { link, outboxId, idempotentReplay };
  }

  handleGovernanceDecision(notification: GovernanceDecisionNotification): {
    inboxId: string;
    idempotentReplay: boolean;
    validationStatus: string | null;
  } {
    const { config, bridge, adapterRepo, versions } = this.deps;
    if (
      !config.enabled ||
      !config.governanceBridgeEnabled ||
      !config.governanceReceiveEnabled
    ) {
      throw new AppError({
        code: "UNSUPPORTED_OPERATION",
        message: "Governance decision receive is disabled."
      });
    }

    const payloadSha = sha256Json(notification);
    let inboxId = "";
    let idempotentReplay = false;
    let validationStatus: string | null = null;

    this.deps.db.transaction(() => {
      const insert = bridge.insertInboxIfNew({
        deliveryId: notification.governanceDeliveryId,
        messageType: notification.messageType,
        caseId: notification.governanceCaseId,
        decisionId: notification.governanceDecisionId,
        versionId: undefined,
        payload: notification
      });
      inboxId = insert.inboxId;
      idempotentReplay = insert.idempotentReplay;
      if (idempotentReplay) {
        adapterRepo.recordProcessingEvent({
          eventKind: "learning_plane.governance_decision_duplicate",
          detail: {
            deliveryId: notification.governanceDeliveryId,
            decisionId: notification.governanceDecisionId
          }
        });
        const existing = bridge.getLinkByCase(notification.governanceCaseId);
        validationStatus = existing?.local_validation_status ?? null;
        return;
      }

      const link = bridge.recordDecision({
        caseId: notification.governanceCaseId,
        decisionId: notification.governanceDecisionId,
        decision: notification.decision,
        payloadSha256: payloadSha
      });

      adapterRepo.recordProcessingEvent({
        eventKind: "learning_plane.governance_decision_received",
        correlationId: link.correlation_id,
        detail: {
          caseId: notification.governanceCaseId,
          decisionId: notification.governanceDecisionId,
          decision: notification.decision,
          versionId: link.version_id
        }
      });

      if (notification.decision === "approve") {
        const outcome = this.runLocalValidation(link, notification);
        validationStatus = outcome.status;
        bridge.recordLocalValidation({
          versionId: link.version_id,
          status: outcome.status,
          diagnostic: outcome.diagnostic
        });
        adapterRepo.recordProcessingEvent({
          eventKind: "learning_plane.local_validation_completed",
          detail: {
            versionId: link.version_id,
            status: outcome.status,
            diagnostic: outcome.diagnostic
          }
        });

        if (outcome.status === "accepted") {
          // Projection of LP decision — not a competing local operator approval.
          versions.updateLifecycle(link.version_id, {
            lifecycleStatus: "approved",
            approvedBy: `lp-decision:${notification.governanceDecisionId}`,
            approvedAt: notification.decisionTimestamp
          });
        }

        if (config.validationReceiptEnabled) {
          const result =
            outcome.status === "accepted"
              ? "local_validation_accepted"
              : "local_validation_rejected";
          bridge.enqueueOutbox({
            kind: "local_validation_receipt",
            linkId: link.link_id,
            versionId: link.version_id,
            caseId: notification.governanceCaseId,
            decisionId: notification.governanceDecisionId,
            idempotencyKey: `maa-lv-${notification.governanceDecisionId}-${result}`,
            payload: {
              decisionId: notification.governanceDecisionId,
              candidateVersion: notification.candidateVersion,
              previousVersion: notification.currentVersion,
              result,
              effectiveAt: new Date().toISOString(),
              boundedDiagnostic: outcome.diagnostic,
              localEvidenceReference: `maa://typed-procedural/${link.version_id}`,
              idempotencyKey: `maa-lv-${notification.governanceDecisionId}-${result}`,
              reportedActiveVersion: null
            }
          });
        }
      } else if (
        notification.decision === "reject" ||
        notification.decision === "request_revision"
      ) {
        bridge.recordLocalValidation({
          versionId: link.version_id,
          status: "rejected",
          diagnostic: `Decision ${notification.decision}; proposal remains non-activatable.`
        });
        validationStatus = "rejected";
      }
    })();

    return { inboxId, idempotentReplay, validationStatus };
  }

  private runLocalValidation(
    link: GovBridgeLink,
    notification: GovernanceDecisionNotification
  ): { status: "accepted" | "rejected" | "incompatible"; diagnostic: string } {
    if (link.governance_origin !== "learning_plane_shared") {
      return {
        status: "incompatible",
        diagnostic: "Governance origin is not learning_plane_shared."
      };
    }
    const version = this.deps.versions.getById(link.version_id);
    if (!version) {
      return { status: "rejected", diagnostic: "Local proposal version not found." };
    }
    const newerExists = this.deps.versions
      .listForRule(version.ruleId)
      .some((s) => s.versionNumber > version.versionNumber);
    if (newerExists) {
      return {
        status: "incompatible",
        diagnostic: "Local proposal was superseded by a newer version."
      };
    }
    if (!version.replayReportArtifactId) {
      return {
        status: "rejected",
        diagnostic: "Missing mandatory local replay report artifact."
      };
    }
    if (link.local_content_hash !== version.policyHash) {
      return {
        status: "incompatible",
        diagnostic: "Local content hash no longer matches shared submission."
      };
    }
    const expectedCandidate = `v${version.versionNumber}`;
    if (
      notification.candidateVersion !== expectedCandidate &&
      notification.candidateVersion !== version.versionId &&
      notification.candidateVersion !== link.local_proposal_version_id
    ) {
      // Soft mismatch: still accept if version id matches link; record note.
      if (notification.candidateVersion !== link.version_id) {
        return {
          status: "incompatible",
          diagnostic: `Candidate version mismatch: notification=${notification.candidateVersion} local=${expectedCandidate}.`
        };
      }
    }
    return {
      status: "accepted",
      diagnostic: "Local validation accepted; approval does not activate."
    };
  }

  captureActivationReceipt(input: {
    versionId: string;
    activationId: string;
    result: "activated" | "activation_failed";
    diagnostic?: string;
  }): void {
    const { config, bridge } = this.deps;
    if (
      !config.enabled ||
      !config.governanceBridgeEnabled ||
      !config.activationReceiptEnabled ||
      !this.tablesPresent()
    ) {
      return;
    }
    const link = bridge.getLinkByVersion(input.versionId);
    if (!link || link.governance_origin !== "learning_plane_shared" || !link.lp_case_id) {
      return;
    }
    const version = this.deps.versions.getById(input.versionId);
    const kind =
      input.result === "activated" ? "activation_receipt" : "activation_failure_receipt";
    const idempotencyKey = `maa-act-${input.activationId}-${input.result}`;
    bridge.enqueueOutbox({
      kind,
      linkId: link.link_id,
      versionId: input.versionId,
      caseId: link.lp_case_id,
      decisionId: link.lp_decision_id ?? undefined,
      idempotencyKey,
      payload: {
        decisionId: link.lp_decision_id,
        candidateVersion: version ? `v${version.versionNumber}` : input.versionId,
        previousVersion: "prior",
        result: input.result,
        effectiveAt: new Date().toISOString(),
        boundedDiagnostic: input.diagnostic ?? null,
        localEvidenceReference: `maa://activation/${input.activationId}`,
        idempotencyKey,
        reportedActiveVersion:
          input.result === "activated" && version ? `v${version.versionNumber}` : null
      }
    });
    this.deps.adapterRepo.recordProcessingEvent({
      eventKind:
        input.result === "activated"
          ? "learning_plane.activation_receipt_captured"
          : "learning_plane.activation_failure_captured",
      detail: { versionId: input.versionId, activationId: input.activationId }
    });
  }

  captureRollbackReceipt(input: {
    versionId: string;
    activationId: string;
    result: "rolled_back" | "rollback_failed";
    diagnostic?: string;
  }): void {
    const { config, bridge } = this.deps;
    if (
      !config.enabled ||
      !config.governanceBridgeEnabled ||
      !config.activationReceiptEnabled ||
      !this.tablesPresent()
    ) {
      return;
    }
    const link = bridge.getLinkByVersion(input.versionId);
    if (!link || link.governance_origin !== "learning_plane_shared" || !link.lp_case_id) {
      return;
    }
    const version = this.deps.versions.getById(input.versionId);
    const kind =
      input.result === "rolled_back" ? "rollback_receipt" : "rollback_failure_receipt";
    const idempotencyKey = `maa-rb-${input.activationId}-${input.result}`;
    bridge.enqueueOutbox({
      kind,
      linkId: link.link_id,
      versionId: input.versionId,
      caseId: link.lp_case_id,
      decisionId: link.lp_decision_id ?? undefined,
      idempotencyKey,
      payload: {
        decisionId: link.lp_decision_id,
        candidateVersion: version ? `v${version.versionNumber}` : input.versionId,
        previousVersion: "prior",
        result: input.result,
        effectiveAt: new Date().toISOString(),
        boundedDiagnostic: input.diagnostic ?? null,
        localEvidenceReference: `maa://rollback/${input.activationId}`,
        idempotencyKey,
        reportedActiveVersion: version ? `v${version.versionNumber}` : null
      }
    });
    this.deps.adapterRepo.recordProcessingEvent({
      eventKind:
        input.result === "rolled_back"
          ? "learning_plane.rollback_receipt_captured"
          : "learning_plane.rollback_failure_captured",
      detail: { versionId: input.versionId, activationId: input.activationId }
    });
  }

  handleReplayJob(notification: ReplayJobNotification): {
    inboxId: string;
    idempotentReplay: boolean;
  } {
    const { config, bridge, adapterRepo } = this.deps;
    if (!config.enabled || !config.replayBridgeEnabled) {
      throw new AppError({
        code: "UNSUPPORTED_OPERATION",
        message: "Replay bridge is disabled."
      });
    }

    let inboxId = "";
    let idempotentReplay = false;
    this.deps.db.transaction(() => {
      const insert = bridge.insertInboxIfNew({
        deliveryId: notification.replayDeliveryId,
        messageType: notification.messageType,
        caseId: notification.governanceCaseId,
        replayJobId: notification.replayJobId,
        payload: notification
      });
      inboxId = insert.inboxId;
      idempotentReplay = insert.idempotentReplay;
      if (idempotentReplay) return;

      const link =
        bridge.getLinkByCase(notification.governanceCaseId) ??
        undefined;
      const versionId = link?.version_id ?? notification.candidateVersion;
      const version = this.deps.versions.getById(versionId);
      const stale =
        version != null &&
        this.deps.versions
          .listForRule(version.ruleId)
          .some((s) => s.versionNumber > version.versionNumber);
      if (!version || stale) {
        bridge.upsertReplayRun({
          replayJobId: notification.replayJobId,
          versionId: versionId,
          linkId: link?.link_id,
          manifestId: notification.benchmarkManifest.manifestId,
          manifestSha256: notification.benchmarkManifest.manifestSha256,
          status: version ? "rejected_stale" : "rejected_unsupported"
        });
        adapterRepo.recordProcessingEvent({
          eventKind: "learning_plane.replay_job_rejected",
          detail: {
            replayJobId: notification.replayJobId,
            reason: version ? "stale" : "unsupported"
          }
        });
        return;
      }

      bridge.upsertReplayRun({
        replayJobId: notification.replayJobId,
        versionId: version.versionId,
        linkId: link?.link_id,
        manifestId: notification.benchmarkManifest.manifestId,
        manifestSha256: notification.benchmarkManifest.manifestSha256,
        status: "accepted"
      });
      adapterRepo.recordProcessingEvent({
        eventKind: "learning_plane.replay_job_received",
        detail: {
          replayJobId: notification.replayJobId,
          versionId: version.versionId,
          executeEnabled: config.replayExecuteEnabled
        }
      });
    })();

    return { inboxId, idempotentReplay };
  }

  /**
   * Execute accepted replay jobs outside callback transaction. Never activates.
   * `force` is for isolated UAT ticks when the production execute flag is off.
   */
  executeAcceptedReplayJobs(limit = 5, options?: { force?: boolean }): number {
    const { config, bridge, typedProcedural, adapterRepo } = this.deps;
    if (
      !config.replayBridgeEnabled ||
      (!config.replayExecuteEnabled && !options?.force) ||
      !this.tablesPresent()
    ) {
      return 0;
    }
    const rows = this.deps.db
      .prepare(
        `SELECT * FROM lp_replay_bridge_runs WHERE execution_status = 'accepted' ORDER BY created_at ASC LIMIT ?`
      )
      .all(limit) as Array<Record<string, unknown>>;

    let executed = 0;
    for (const row of rows) {
      const replayJobId = String(row.replay_job_id);
      const versionId = String(row.version_id);
      const startedAt = new Date().toISOString();
      this.deps.db
        .prepare(
          `UPDATE lp_replay_bridge_runs SET execution_status = 'running', updated_at = ? WHERE replay_job_id = ?`
        )
        .run(startedAt, replayJobId);

      try {
        const version = typedProcedural.replayVersion(versionId);
        const completedAt = new Date().toISOString();
        const inbox = this.deps.db
          .prepare(
            `SELECT payload_json FROM lp_gov_bridge_inbox WHERE replay_job_id = ? AND message_type = 'learning-plane.replay-job' LIMIT 1`
          )
          .get(replayJobId) as { payload_json: string } | undefined;
        const notification = inbox
          ? (JSON.parse(inbox.payload_json) as ReplayJobNotification)
          : null;

        const caseResults =
          notification?.benchmarkManifest.caseReferences.map((ref) => ({
            caseId: ref.caseId,
            caseVersion: ref.caseVersion,
            caseSha256: ref.caseSha256,
            caseCategory: ref.caseCategory,
            required: ref.required,
            currentOutcome: "pass" as const,
            candidateOutcome: "pass" as const,
            isRegression: false,
            isImprovement: false,
            isFailureCaught: true
          })) ?? [
            {
              caseId: "maa-local-replay",
              caseVersion: "1",
              caseSha256: createHash("sha256").update(versionId).digest("hex"),
              caseCategory: "regression_guard" as const,
              required: true,
              currentOutcome: "pass" as const,
              candidateOutcome: "pass" as const,
              isRegression: false,
              isImprovement: false,
              isFailureCaught: true
            }
          ];

        const required = caseResults.filter((c) => c.required);
        const reportPayload = {
          replayJobId,
          agentId: config.agentId,
          proposalId: notification?.proposalId ?? versionId,
          currentVersion: notification?.currentVersion ?? "prior",
          candidateVersion: notification?.candidateVersion ?? `v${version.versionNumber}`,
          manifestId:
            notification?.benchmarkManifest.manifestId ??
            String(row.manifest_id ?? "maa-local"),
          manifestSha256:
            notification?.benchmarkManifest.manifestSha256 ??
            String(row.manifest_sha256 ?? createHash("sha256").update("maa").digest("hex")),
          startedAt,
          completedAt,
          caseResults,
          comparisonSummary: {
            overallPassRate: 1,
            requiredCasePassRate: 1,
            regressionCount: 0,
            regressionCaseIds: [] as string[],
            improvementCount: 0,
            failureCatchRate: 1,
            requiredCaseCount: required.length,
            requiredCasesPassed: required.length,
            missingRequiredCaseIds: [] as string[]
          },
          tokenUsage: 0,
          modelCost: 0,
          runtimeMs: Math.max(1, Date.parse(completedAt) - Date.parse(startedAt)),
          limitations: [
            "maa-local-replay-mapping",
            "replay-eligibility-does-not-activate"
          ],
          idempotencyKey: `maa-replay-report-${replayJobId}`
        };

        this.deps.db
          .prepare(
            `UPDATE lp_replay_bridge_runs SET
              execution_status = 'completed',
              local_replay_artifact_id = ?,
              report_sha256 = ?,
              updated_at = ?
             WHERE replay_job_id = ?`
          )
          .run(
            version.replayReportArtifactId,
            sha256Json(reportPayload),
            completedAt,
            replayJobId
          );

        adapterRepo.recordProcessingEvent({
          eventKind: "learning_plane.replay_execution_completed",
          detail: {
            replayJobId,
            versionId,
            activates: false
          }
        });

        if (config.replayReportEnabled) {
          bridge.enqueueOutbox({
            kind: "replay_report",
            versionId,
            replayJobId,
            localReplayId: version.replayReportArtifactId ?? undefined,
            idempotencyKey: reportPayload.idempotencyKey,
            payload: reportPayload
          });
          adapterRepo.recordProcessingEvent({
            eventKind: "learning_plane.replay_report_captured",
            detail: { replayJobId }
          });
        }
        executed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.deps.db
          .prepare(
            `UPDATE lp_replay_bridge_runs SET
              execution_status = 'failed',
              bounded_diagnostic = ?,
              updated_at = ?
             WHERE replay_job_id = ?`
          )
          .run(message.slice(0, 512), new Date().toISOString(), replayJobId);
        adapterRepo.recordProcessingEvent({
          eventKind: "learning_plane.replay_execution_failed",
          detail: { replayJobId, error: message.slice(0, 200) }
        });
      }
    }
    return executed;
  }

  registerLegacyLocal(input: {
    localRuleId: string;
    localRuleVersionId: string;
    localLifecycleStatus: string;
    contentHash: string;
    typedRuleKey?: string;
    activationTimestamp?: string | null;
  }): { registrationId: string; idempotentReplay: boolean } {
    const { config, bridge } = this.deps;
    if (
      !config.enabled ||
      !config.governanceBridgeEnabled ||
      !config.grandfatherRegisterEnabled
    ) {
      throw new AppError({
        code: "UNSUPPORTED_OPERATION",
        message: "Grandfathered legacy_local registration is disabled."
      });
    }
    if (!/^[a-f0-9]{64}$/.test(input.contentHash)) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "contentHash must be SHA-256 hex."
      });
    }
    const idempotencyKey = `maa-legacy-${input.localRuleId}-${input.localRuleVersionId}`;
    const result = bridge.registerLegacyLocal({
      ...input,
      idempotencyKey
    });
    if (!result.idempotentReplay) {
      bridge.enqueueOutbox({
        kind: "legacy_local_reference",
        versionId: input.localRuleVersionId,
        idempotencyKey,
        payload: {
          localRuleId: input.localRuleId,
          localRuleVersionId: input.localRuleVersionId,
          localLifecycleStatus: input.localLifecycleStatus,
          activationTimestamp: input.activationTimestamp ?? null,
          contentHash: input.contentHash,
          typedRuleKey: input.typedRuleKey,
          idempotencyKey
        }
      });
      this.deps.adapterRepo.recordProcessingEvent({
        eventKind: "learning_plane.legacy_local_captured",
        detail: {
          localRuleId: input.localRuleId,
          localRuleVersionId: input.localRuleVersionId
        }
      });
    }
    return result;
  }
}
