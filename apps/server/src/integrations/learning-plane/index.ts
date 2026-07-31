import type { Logger } from "@maa/logging";
import type { SqliteDatabase, WorkflowFeedbackRepository } from "@maa/database";
import { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import { bootstrapLearningPlaneAdapter } from "./bootstrap.js";
import {
  resolveLearningPlaneAdapterConfig,
  type LearningPlaneAdapterConfig
} from "./config.js";
import type { BootstrapRequest, LearningPlaneStatusResponse } from "./contracts.js";
import { LearningPlaneHealthService } from "./healthService.js";
import { LearningPlaneRegistrationService } from "./registrationService.js";
import { LearningPlaneSecretStore } from "./secretStore.js";
import { buildLearningPlaneStatus } from "./statusService.js";
import { probeLearningPlaneApiCompat } from "./clientFactory.js";
import type { Config } from "@maa/contracts";
import { WorkflowFeedbackLearningPlaneCapture } from "./workflowFeedbackCapture.js";
import { LearningPlaneOutboxWorker } from "./outboxWorker.js";
import { LearningPlaneAcknowledgementWorker } from "./acknowledgementWorker.js";
import { LearningPlaneReconciliationWorker } from "./reconciliationWorker.js";

export type LearningPlaneAdapter = {
  config: LearningPlaneAdapterConfig;
  repo: LearningPlaneAdapterRepository;
  secrets: LearningPlaneSecretStore;
  registration: LearningPlaneRegistrationService;
  health: LearningPlaneHealthService;
  capture: WorkflowFeedbackLearningPlaneCapture;
  reconciliation: LearningPlaneReconciliationWorker;
  getStatus: () => Promise<LearningPlaneStatusResponse>;
  bootstrap: (request: BootstrapRequest) => ReturnType<typeof bootstrapLearningPlaneAdapter>;
  reconcile: () => ReturnType<LearningPlaneRegistrationService["reconcile"]>;
  reportHealth: () => ReturnType<LearningPlaneHealthService["report"]>;
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
}): LearningPlaneAdapter {
  const config = resolveLearningPlaneAdapterConfig(input.rawConfig, input.repoRoot);
  const repo = new LearningPlaneAdapterRepository(input.db);
  const secrets = new LearningPlaneSecretStore(config.secretFilePath);
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
        repoRoot: input.repoRoot
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
            receiveEnabled: config.receiveEnabled
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
        health.startHeartbeat();
        outboxWorker.start();
        ackWorker.start();
        reconciliation.start();
      } else {
        repo.recordProcessingEvent({
          eventKind: "learning_plane.secret_missing",
          detail: { reason: "file_absent" }
        });
      }
    },
    async stop() {
      health.stopHeartbeat();
      await Promise.all([outboxWorker.stop(), ackWorker.stop(), reconciliation.stop()]);
    }
  };
}

export * from "./config.js";
export * from "./contracts.js";
export * from "./callbackRoute.js";
export * from "./workflowFeedbackCapture.js";
export * from "./workflowFeedbackMapping.js";
