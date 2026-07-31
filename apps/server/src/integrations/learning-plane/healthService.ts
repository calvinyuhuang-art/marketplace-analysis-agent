import { AppError } from "@maa/contracts";
import type { Logger } from "@maa/logging";
import { API_COMPAT_LABEL } from "@maa/contracts";
import type { AgentHealthSnapshot } from "@learning-plane/contracts";
import type { LearningPlaneAdapterConfig } from "./config.js";
import type { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import { createAgentClient } from "./clientFactory.js";
import type { LearningPlaneSecretStore } from "./secretStore.js";

export type HealthReportDeps = {
  config: LearningPlaneAdapterConfig;
  repo: LearningPlaneAdapterRepository;
  secrets: LearningPlaneSecretStore;
  serviceVersion: string;
  databaseSchemaVersion: string;
  databaseAvailable: () => boolean;
  logger: Logger;
};

function bounded(message: string): string {
  return message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 500);
}

export class LearningPlaneHealthService {
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: HealthReportDeps) {}

  startHeartbeat(): void {
    this.stopHeartbeat();
    if (!this.deps.config.enabled) return;
    const intervalMs = this.deps.config.healthReportIntervalSeconds * 1000;
    this.timer = setInterval(() => {
      void this.report().catch(() => {
        /* recorded in repo */
      });
    }, intervalMs);
    this.timer.unref?.();
  }

  stopHeartbeat(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async report(): Promise<{
    availability: "healthy" | "degraded" | "unhealthy" | "unknown";
    reportedAt: string | null;
  }> {
    const { config, repo, secrets, serviceVersion, databaseSchemaVersion, logger } = this.deps;
    if (!config.enabled) {
      return { availability: "unknown", reportedAt: null };
    }
    if (!secrets.exists()) {
      repo.recordProcessingEvent({
        eventKind: "learning_plane.health_report_failed",
        detail: { reason: "secret_missing" }
      });
      return { availability: "unknown", reportedAt: null };
    }

    const secret = secrets.load();
    if (!secret) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Learning Plane secrets could not be loaded for health reporting."
      });
    }

    const dbOk = this.deps.databaseAvailable();
    const publishNote = config.publishEnabled ? "publish=active" : "publish=disabled";
    const receiveNote = config.receiveEnabled ? "receive=active" : "receive=disabled";
    const diagnosticSummary = [
      `adapter=LP8-I3b`,
      `maaApiCompat=${API_COMPAT_LABEL}`,
      `schema=${databaseSchemaVersion}`,
      `db=${dbOk ? "ok" : "unavailable"}`,
      publishNote,
      receiveNote
    ].join("; ");

    const availability = dbOk ? "healthy" : "degraded";
    repo.recordProcessingEvent({
      eventKind: "learning_plane.health_report_attempted",
      detail: { availability }
    });

    try {
      const client = createAgentClient(config, secret.agentApiKey);
      const health = (await client.reportHealth(config.agentId, {
        availability,
        serviceVersion,
        reportedContractVersion: "1.0",
        diagnosticSummary
      })) as AgentHealthSnapshot;
      const timestamp = health.reportedAt;
      const settings = repo.getSettings();
      repo.upsertSettings({
        agentId: config.agentId,
        learningPlaneBaseUrl: config.baseUrl,
        learningPlaneApiCompat: settings?.learning_plane_api_compat ?? null,
        registrationStatus: settings?.registration_status ?? "registered",
        credentialId: secret.credentialId,
        callbackKeyId: secret.callbackKeyId,
        callbackPath: config.callbackPath,
        enabled: true,
        publishEnabled: config.publishEnabled,
        receiveEnabled: config.receiveEnabled,
        lastHealthReportAt: timestamp,
        lastSuccessfulConnectionAt: timestamp,
        lastErrorCode: null,
        lastBoundedError: null
      });
      repo.recordProcessingEvent({
        eventKind: "learning_plane.health_reported",
        detail: { availability, checkId: health.checkId }
      });
      logger.info(
        { eventType: "learning_plane.health_reported", availability },
        "Learning Plane health reported"
      );
      return { availability, reportedAt: timestamp };
    } catch (error) {
      const message = bounded(error instanceof Error ? error.message : String(error));
      const settings = repo.getSettings();
      repo.upsertSettings({
        agentId: config.agentId,
        learningPlaneBaseUrl: config.baseUrl,
        learningPlaneApiCompat: settings?.learning_plane_api_compat ?? null,
        registrationStatus: settings?.registration_status ?? "registered",
        credentialId: secret.credentialId,
        callbackKeyId: secret.callbackKeyId,
        callbackPath: config.callbackPath,
        enabled: true,
        publishEnabled: config.publishEnabled,
        receiveEnabled: config.receiveEnabled,
        lastHealthReportAt: settings?.last_health_report_at ?? null,
        lastSuccessfulConnectionAt: settings?.last_successful_connection_at ?? null,
        lastErrorCode: "LP_HEALTH_REPORT_FAILED",
        lastBoundedError: message
      });
      repo.recordProcessingEvent({
        eventKind: "learning_plane.health_report_failed",
        detail: { error: message }
      });
      logger.warn(
        { eventType: "learning_plane.health_report_failed", err: { message } },
        "Learning Plane health report failed"
      );
      return { availability: "unhealthy", reportedAt: null };
    }
  }
}
