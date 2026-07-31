import { API_COMPAT_LABEL } from "@maa/contracts";
import type { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import {
  declaredCapabilitiesForFlags,
  MAA_LP_REQUIRED_API_COMPAT,
  LP8_I3B_MILESTONE,
  publishModeStatus,
  receiveModeStatus,
  type LearningPlaneAdapterConfig
} from "./config.js";
import type { AdapterRuntimeState, LearningPlaneStatusResponse } from "./contracts.js";
import type { LearningPlaneSecretStore } from "./secretStore.js";
import { loadLearningPlanePackageIdentity } from "./packageIdentity.js";

export function buildLearningPlaneStatus(input: {
  config: LearningPlaneAdapterConfig;
  repo: LearningPlaneAdapterRepository;
  secrets: LearningPlaneSecretStore;
  serviceVersion: string;
  databaseSchemaVersion: string;
  learningPlaneReachable: boolean | null;
  repoRoot: string;
}): LearningPlaneStatusResponse {
  const { config, repo, secrets, serviceVersion, databaseSchemaVersion } = input;
  const settings = repo.tablesPresent() ? repo.getSettings() : null;
  const secretsPresent = secrets.exists();
  const publish = publishModeStatus(config);
  const receive = receiveModeStatus(config);
  const declaredCapabilities = declaredCapabilitiesForFlags(config);

  let adapterState: AdapterRuntimeState = "disabled";
  if (!config.enabled) {
    adapterState = "disabled";
  } else if (!secretsPresent) {
    adapterState = "not_bootstrapped";
  } else if (input.learningPlaneReachable === false) {
    adapterState = "unavailable";
  } else if (settings?.last_error_code) {
    adapterState = "degraded";
  } else {
    adapterState = "enabled";
  }

  const outboxCounts = repo.tablesPresent()
    ? repo.countByStatus("lp_adapter_outbox", "status")
    : {};
  const inboxCounts = repo.tablesPresent()
    ? repo.countByStatus("lp_adapter_inbox", "processing_status")
    : {};
  const acknowledgementCounts = repo.tablesPresent()
    ? repo.countByStatus("lp_adapter_acknowledgements", "status")
    : {};

  const notes: string[] = [
    "LP8-I3b production workflow-feedback adapter: created + evaluated publish; resolution_submitted receive."
  ];
  if (!config.publishEnabled) notes.push("Publish flag is off; no outbox capture.");
  if (!config.receiveEnabled) notes.push("Receive flag is off; callback rejects deliveries.");

  return {
    implementationMilestone: LP8_I3B_MILESTONE,
    enabled: config.enabled,
    publishEnabled: config.publishEnabled,
    receiveEnabled: config.receiveEnabled,
    publishMode: publish.status,
    receiveMode: receive.status,
    adapterState,
    agentId: config.agentId,
    declaredCapabilities,
    registrationStatus: settings?.registration_status ?? "unknown",
    credentialId: settings?.credential_id ?? null,
    callbackKeyId: settings?.callback_key_id ?? null,
    callbackPath: config.callbackPath,
    learningPlaneBaseUrl: config.baseUrl,
    learningPlaneApiCompatibility: settings?.learning_plane_api_compat ?? null,
    requiredLearningPlaneApiCompatibility: MAA_LP_REQUIRED_API_COMPAT,
    maaServiceVersion: serviceVersion,
    maaApiCompatibility: API_COMPAT_LABEL,
    maaDatabaseSchemaVersion: databaseSchemaVersion,
    lastHealthReportAt: settings?.last_health_report_at ?? null,
    lastSuccessfulConnectionAt: settings?.last_successful_connection_at ?? null,
    lastSuccessfulPublishAt: repo.tablesPresent() ? repo.lastPublishedAt() : null,
    lastSuccessfulReceiveAt: repo.tablesPresent() ? repo.lastReceivedAt() : null,
    lastSuccessfulAcknowledgementAt: repo.tablesPresent()
      ? repo.lastAcknowledgedAt()
      : null,
    lastErrorCode: settings?.last_error_code ?? null,
    boundedDiagnostic: settings?.last_bounded_error ?? null,
    outboxCounts,
    inboxCounts,
    acknowledgementCounts,
    waitingForCausationCount: outboxCounts.waiting_for_causation ?? 0,
    awaitingLocalReconciliationCount: inboxCounts.awaiting_local_reconciliation ?? 0,
    semanticConflictCount: inboxCounts.semantic_conflict ?? 0,
    oldestPendingAgeSeconds: repo.tablesPresent() ? repo.oldestPendingAgeSeconds() : null,
    secretsPresent,
    packageIdentity: loadLearningPlanePackageIdentity(input.repoRoot),
    notes
  };
}
