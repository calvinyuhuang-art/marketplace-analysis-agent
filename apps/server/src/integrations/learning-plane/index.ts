import type { Logger } from "@maa/logging";
import { resolve } from "node:path";
import type {
  ProceduralRuleActivationsRepository,
  ProceduralRuleDefinitionsRepository,
  ProceduralRuleVersionsRepository,
  SqliteDatabase,
  WorkflowFeedbackRepository
} from "@maa/database";
import type { TypedProceduralService } from "@maa/learning";
import type { Config } from "@maa/contracts";
import { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import { bootstrapLearningPlaneAdapter } from "./bootstrap.js";
import {
  resolveLearningPlaneAdapterConfig,
  type LearningPlaneAdapterConfig
} from "./config.js";
import type { BootstrapRequest, LearningPlaneStatusResponse, RotationStatus } from "./contracts.js";
import { LearningPlaneHealthService } from "./healthService.js";
import { LearningPlaneRegistrationService } from "./registrationService.js";
import { LearningPlaneSecretStore } from "./secretStore.js";
import { buildLearningPlaneStatus } from "./statusService.js";
import { LearningPlaneRotationService } from "./rotationService.js";
import { probeLearningPlaneApiCompat } from "./clientFactory.js";
import { WorkflowFeedbackLearningPlaneCapture } from "./workflowFeedbackCapture.js";
import { LearningPlaneOutboxWorker } from "./outboxWorker.js";
import { LearningPlaneAcknowledgementWorker } from "./acknowledgementWorker.js";
import { LearningPlaneReconciliationWorker } from "./reconciliationWorker.js";
import { GovernanceReplayBridgeRepository } from "./governanceReplayBridgeRepository.js";
import { GovernanceBridgeService } from "./governanceBridgeService.js";
import { GovernanceBridgeOutboxWorker } from "./governanceBridgeOutboxWorker.js";
import { PublishedKnowledgeBridgeRepository } from "./publishedKnowledgeBridgeRepository.js";
import { PublishedKnowledgeBridgeService } from "./publishedKnowledgeBridgeService.js";
import { PublishedKnowledgeOutboxWorker } from "./publishedKnowledgeOutboxWorker.js";
import type { MemoryItemsRepository } from "@maa/database";

export type LearningPlaneAdapter = {
  config: LearningPlaneAdapterConfig;
  repo: LearningPlaneAdapterRepository;
  secrets: LearningPlaneSecretStore;
  registration: LearningPlaneRegistrationService;
  health: LearningPlaneHealthService;
  capture: WorkflowFeedbackLearningPlaneCapture;
  reconciliation: LearningPlaneReconciliationWorker;
  governanceBridge: GovernanceBridgeService | null;
  publishedKnowledgeBridge: PublishedKnowledgeBridgeService | null;
  publishedKnowledgeOutboxWorker: PublishedKnowledgeOutboxWorker;
  getStatus: () => Promise<LearningPlaneStatusResponse>;
  bootstrap: (request: BootstrapRequest) => ReturnType<typeof bootstrapLearningPlaneAdapter>;
  reconcile: () => ReturnType<LearningPlaneRegistrationService["reconcile"]>;
  reportHealth: () => ReturnType<LearningPlaneHealthService["report"]>;
  applyCredentialRotation: (input: {
    credentialId: string;
    agentApiKey: string;
    previousCredentialId?: string;
    overlapExpiresAt?: string;
  }) => { credentialId: string; rotationStatus: RotationStatus };
  applyCallbackKeyRotation: (input: {
    callbackKeyId: string;
    callbackVerificationSecret: string;
    previousCallbackKeyId?: string;
    previousCallbackVerificationSecret?: string;
    overlapExpiresAt?: string;
    acceptedCallbackKeyIds?: string[];
  }) => { callbackKeyId: string; rotationStatus: RotationStatus };
  completeCredentialRotation: () => { rotationStatus: RotationStatus };
  completeCallbackKeyRotation: () => { rotationStatus: RotationStatus };
  rollbackCredentialRotation: () => { credentialId: string; rotationStatus: RotationStatus };
  operatorRetryOutbox: (outboxId: string) => { outboxId: string; status: string };
  start: () => void;
  stop: () => Promise<void>;
};

export function createLearningPlaneAdapter(input: {
  rawConfig: Config;
  repoRoot: string;
  db: SqliteDatabase;
  feedback: WorkflowFeedbackRepository;
  serviceVersion: string;
  databaseSchemaVersion: string;
  logger: Logger;
  typedProcedural?: TypedProceduralService;
  versions?: ProceduralRuleVersionsRepository;
  definitions?: ProceduralRuleDefinitionsRepository;
  activations?: ProceduralRuleActivationsRepository;
  memoryItems?: MemoryItemsRepository;
}): LearningPlaneAdapter {
  const config = resolveLearningPlaneAdapterConfig(input.rawConfig, input.repoRoot);
  const repo = new LearningPlaneAdapterRepository(input.db);
  const secrets = new LearningPlaneSecretStore(config.secretFilePath);
  const rotation = new LearningPlaneRotationService(secrets, repo);
  const registration = new LearningPlaneRegistrationService({
    config,
    repo,
    secrets,
    serviceVersion: input.serviceVersion,
    logger: input.logger
  });
  const health = new LearningPlaneHealthService({
    config,
    repo,
    secrets,
    serviceVersion: input.serviceVersion,
    databaseSchemaVersion: input.databaseSchemaVersion,
    databaseAvailable: () => {
      try {
        input.db.prepare("SELECT 1 AS ok").get();
        return true;
      } catch {
        return false;
      }
    },
    logger: input.logger
  });
  const capture = new WorkflowFeedbackLearningPlaneCapture({ config, repo });
  const reconciliation = new LearningPlaneReconciliationWorker({
    config,
    repo,
    feedback: input.feedback,
    logger: input.logger,
    enabled: () => config.enabled
  });
  const outboxWorker = new LearningPlaneOutboxWorker({
    config,
    repo,
    secrets,
    logger: input.logger,
    enabled: () => config.enabled && config.publishEnabled
  });
  const ackWorker = new LearningPlaneAcknowledgementWorker({
    config,
    repo,
    secrets,
    logger: input.logger,
    enabled: () => config.enabled && config.receiveEnabled
  });

  const bridgeRepo = new GovernanceReplayBridgeRepository(input.db);
  let governanceBridge: GovernanceBridgeService | null = null;
  let govOutboxWorker: GovernanceBridgeOutboxWorker | null = null;
  let replayTimer: NodeJS.Timeout | null = null;

  if (
    input.typedProcedural &&
    input.versions &&
    input.definitions &&
    input.activations
  ) {
    governanceBridge = new GovernanceBridgeService({
      config,
      db: input.db,
      bridge: bridgeRepo,
      adapterRepo: repo,
      typedProcedural: input.typedProcedural,
      versions: input.versions,
      definitions: input.definitions,
      activations: input.activations
    });
    govOutboxWorker = new GovernanceBridgeOutboxWorker({
      config,
      bridge: bridgeRepo,
      adapterRepo: repo,
      secrets,
      logger: input.logger,
      enabled: () => config.enabled && config.governanceBridgeEnabled
    });
  }

  const pkRepo = new PublishedKnowledgeBridgeRepository(input.db);
  const publishedKnowledgeBridge = new PublishedKnowledgeBridgeService({
    config,
    db: input.db,
    repo: pkRepo,
    adapterRepo: repo,
    secrets,
    memoryItems: input.memoryItems
  });
  const pkOutboxWorker = new PublishedKnowledgeOutboxWorker({
    config,
    pkRepo,
    adapterRepo: repo,
    secrets,
    logger: input.logger,
    enabled: () => config.enabled && config.publicationBridgeEnabled
  });

  const syncFlagSettings = () => {
    if (!repo.tablesPresent() || !config.enabled) return;
    const existing = repo.getSettings();
    repo.upsertSettings({
      agentId: config.agentId,
      learningPlaneBaseUrl: config.baseUrl,
      learningPlaneApiCompat: existing?.learning_plane_api_compat ?? null,
      registrationStatus: existing?.registration_status ?? "unregistered",
      credentialId: existing?.credential_id ?? null,
      callbackKeyId: existing?.callback_key_id ?? null,
      callbackPath: config.callbackPath,
      enabled: config.enabled,
      publishEnabled: config.publishEnabled,
      receiveEnabled: config.receiveEnabled,
      lastRegistrationCheckAt: existing?.last_registration_check_at ?? null,
      lastHealthReportAt: existing?.last_health_report_at ?? null,
      lastSuccessfulConnectionAt: existing?.last_successful_connection_at ?? null,
      lastErrorCode: existing?.last_error_code ?? null,
      lastBoundedError: existing?.last_bounded_error ?? null
    });
  };

  return {
    config,
    repo,
    secrets,
    registration,
    health,
    capture,
    reconciliation,
    governanceBridge,
    publishedKnowledgeBridge,
    publishedKnowledgeOutboxWorker: pkOutboxWorker,
    async getStatus() {
      let reachable: boolean | null = null;
      if (config.enabled) {
        const probe = await probeLearningPlaneApiCompat(config.baseUrl, config.requestTimeoutMs);
        reachable = probe.ok;
      }
      return buildLearningPlaneStatus({
        config,
        repo,
        secrets,
        serviceVersion: input.serviceVersion,
        databaseSchemaVersion: input.databaseSchemaVersion,
        learningPlaneReachable: reachable,
        repoRoot: input.repoRoot,
        backupDir: resolve(input.repoRoot, input.rawConfig.MAA_BACKUP_DIR),
        artifactRetentionDays: input.rawConfig.MAA_ARTIFACT_RETENTION_DAYS,
        publishedKnowledgeBridge,
        pkRepo
      });
    },
    bootstrap(request) {
      return bootstrapLearningPlaneAdapter(registration, request);
    },
    reconcile() {
      return registration.reconcile();
    },
    reportHealth() {
      return health.report();
    },
    applyCredentialRotation(input) {
      return rotation.applyCredentialRotation(input);
    },
    applyCallbackKeyRotation(input) {
      return rotation.applyCallbackKeyRotation(input);
    },
    completeCredentialRotation() {
      return rotation.completeCredentialRotation();
    },
    completeCallbackKeyRotation() {
      return rotation.completeCallbackKeyRotation();
    },
    rollbackCredentialRotation() {
      return rotation.rollbackCredentialRotation();
    },
    operatorRetryOutbox(outboxId) {
      return rotation.operatorRetryOutbox(outboxId);
    },
    start() {
      syncFlagSettings();
      if (!config.enabled) {
        if (repo.tablesPresent()) {
          repo.recordProcessingEvent({
            eventKind: "learning_plane.adapter_disabled",
            detail: { reason: "flag_off" }
          });
        }
        input.logger.info(
          { eventType: "learning_plane.adapter_disabled" },
          "Learning Plane adapter disabled"
        );
        return;
      }
      if (repo.tablesPresent()) {
        repo.recordProcessingEvent({
          eventKind: "learning_plane.adapter_enabled",
          detail: {
            publishEnabled: config.publishEnabled,
            receiveEnabled: config.receiveEnabled,
            governanceBridgeEnabled: config.governanceBridgeEnabled,
            replayBridgeEnabled: config.replayBridgeEnabled
          }
        });
      }
      input.logger.info(
        { eventType: "learning_plane.adapter_enabled" },
        "Learning Plane adapter enabled"
      );
      if (secrets.exists()) {
        try {
          secrets.load();
          repo.recordProcessingEvent({
            eventKind: "learning_plane.secret_loaded",
            detail: { pathPresent: true }
          });
        } catch {
          repo.recordProcessingEvent({
            eventKind: "learning_plane.secret_missing",
            detail: { reason: "malformed" }
          });
        }
      } else {
        repo.recordProcessingEvent({
          eventKind: "learning_plane.secret_missing",
          detail: { reason: "file_absent" }
        });
      }
      // Workers may start before bootstrap; ticks no-op until secrets exist.
      health.startHeartbeat();
      outboxWorker.start();
      ackWorker.start();
      reconciliation.start();
      govOutboxWorker?.start();
      pkOutboxWorker.start();
      if (
        governanceBridge &&
        config.replayBridgeEnabled &&
        config.replayExecuteEnabled
      ) {
        if (!replayTimer) {
          replayTimer = setInterval(() => {
            try {
              governanceBridge?.executeAcceptedReplayJobs(3);
            } catch {
              /* non-blocking */
            }
          }, 1000);
          replayTimer.unref?.();
        }
      }
    },
    async stop() {
      if (replayTimer) {
        clearInterval(replayTimer);
        replayTimer = null;
      }
      health.stopHeartbeat();
      await Promise.all([
        outboxWorker.stop(),
        ackWorker.stop(),
        reconciliation.stop(),
        govOutboxWorker?.stop() ?? Promise.resolve(),
        pkOutboxWorker.stop()
      ]);
    }
  };
}

export * from "./config.js";
export * from "./contracts.js";
export * from "./callbackRoute.js";
export * from "./governanceCallbackRoute.js";
export * from "./replayCallbackRoute.js";
export * from "./workflowFeedbackCapture.js";
export * from "./workflowFeedbackMapping.js";
