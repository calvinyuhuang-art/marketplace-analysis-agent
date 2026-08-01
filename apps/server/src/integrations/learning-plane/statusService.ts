import { API_COMPAT_LABEL, type BackupManifest } from "@maa/contracts";
import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { listBackups } from "@maa/ops";
import type { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import {
  declaredCapabilitiesForFlags,
  MAA_LP_REQUIRED_API_COMPAT,
  LP8_I3B_MILESTONE,
  LP8_I4C_MILESTONE,
  LP8_I5C_MILESTONE,
  publishModeStatus,
  receiveModeStatus,
  type LearningPlaneAdapterConfig
} from "./config.js";
import type { AdapterRuntimeState, LearningPlaneStatusResponse } from "./contracts.js";
import type { LearningPlaneSecretStore } from "./secretStore.js";
import { loadLearningPlanePackageIdentity } from "./packageIdentity.js";
import type { PublishedKnowledgeBridgeService } from "./publishedKnowledgeBridgeService.js";
import { PublishedKnowledgeBridgeRepository } from "./publishedKnowledgeBridgeRepository.js";

function buildRecoveryStatus(input: {
  backupDir: string;
  artifactRetentionDays: number;
  publishedKnowledgeBridge?: PublishedKnowledgeBridgeService | null;
  pkRepo?: PublishedKnowledgeBridgeRepository | null;
}): NonNullable<LearningPlaneStatusResponse["recovery"]> {
  const backups = listBackups(input.backupDir);
  const latest = backups[0];
  let lastIntegrityOk: boolean | null = null;
  if (latest) {
    try {
      const manifest = JSON.parse(
        readFileSync(join(latest.path, "manifest.json"), "utf8")
      ) as BackupManifest;
      lastIntegrityOk = manifest.integrity?.ok ?? null;
    } catch {
      lastIntegrityOk = null;
    }
  }

  let localReferenceCount = 0;
  let tombstoneOrDeletedReferenceCount = 0;
  const pkRepo = input.pkRepo;
  if (pkRepo?.tablesPresent()) {
    localReferenceCount = pkRepo.countLocalReferences();
    tombstoneOrDeletedReferenceCount = pkRepo.countTombstonedReferences();
  } else if (input.publishedKnowledgeBridge?.tablesPresent()) {
    const counts = input.publishedKnowledgeBridge.getStatus().counts as
      | Record<string, number>
      | undefined;
    localReferenceCount = counts?.localReferences ?? 0;
    tombstoneOrDeletedReferenceCount = counts?.tombstonedReferences ?? 0;
  }

  return {
    lastBackupAt: latest?.createdAt ?? null,
    lastBackupPathDisplay: latest ? basename(latest.path) : null,
    lastIntegrityOk,
    retentionDaysConfigured: input.artifactRetentionDays,
    localReferenceCount,
    tombstoneOrDeletedReferenceCount
  };
}

export function buildLearningPlaneStatus(input: {
  config: LearningPlaneAdapterConfig;
  repo: LearningPlaneAdapterRepository;
  secrets: LearningPlaneSecretStore;
  serviceVersion: string;
  databaseSchemaVersion: string;
  learningPlaneReachable: boolean | null;
  repoRoot: string;
  backupDir?: string;
  artifactRetentionDays?: number;
  publishedKnowledgeBridge?: PublishedKnowledgeBridgeService | null;
  pkRepo?: PublishedKnowledgeBridgeRepository | null;
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

  let loadedSecret: ReturnType<LearningPlaneSecretStore["load"]> = null;
  if (secretsPresent) {
    try {
      loadedSecret = secrets.load();
    } catch {
      loadedSecret = null;
    }
  }

  const rotation =
    secretsPresent && loadedSecret
      ? {
          status: loadedSecret.rotationStatus ?? "idle",
          credentialId: settings?.credential_id ?? loadedSecret.credentialId ?? null,
          previousCredentialId: loadedSecret.previousCredentialId ?? null,
          callbackKeyId: settings?.callback_key_id ?? loadedSecret.callbackKeyId ?? null,
          previousCallbackKeyId: loadedSecret.previousCallbackKeyId ?? null,
          acceptedCallbackKeyIds: loadedSecret.acceptedCallbackKeyIds ?? [],
          overlapExpiresAt: loadedSecret.rotationOverlapExpiresAt ?? null
        }
      : undefined;

  const queuePressure = repo.tablesPresent()
    ? {
        outboxPending: outboxCounts.pending ?? 0,
        outboxRetryScheduled: outboxCounts.retry_scheduled ?? 0,
        outboxPermanentFailure: outboxCounts.permanent_failure ?? 0,
        oldestPendingAgeSeconds: repo.oldestPendingAgeSeconds()
      }
    : undefined;

  const notes: string[] = [
    "LP8-I3b production workflow-feedback adapter: created + evaluated publish; resolution_submitted receive.",
    "LP8-I4c governance/replay bridge available behind feature flags (default off).",
    "LP8-I5c published-knowledge bridge available behind feature flags (default off).",
    "Approval does not activate. Replay eligibility does not activate.",
    "Discovery does not create a local reference. Reference is not adoption. Publication never activates rules."
  ];
  if (!config.publishEnabled) notes.push("Publish flag is off; no outbox capture.");
  if (!config.receiveEnabled) notes.push("Receive flag is off; callback rejects deliveries.");
  if (!config.governanceBridgeEnabled) notes.push("Governance bridge flag is off.");
  if (!config.replayBridgeEnabled) notes.push("Replay bridge flag is off.");
  if (!config.publicationBridgeEnabled) notes.push("Published-knowledge bridge flag is off.");

  const milestone = config.publicationBridgeEnabled
    ? LP8_I5C_MILESTONE
    : config.governanceBridgeEnabled
      ? LP8_I4C_MILESTONE
      : LP8_I3B_MILESTONE;

  return {
    implementationMilestone: milestone,
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
    bridgeFlags: {
      governanceBridgeEnabled: config.governanceBridgeEnabled,
      governancePublishEnabled: config.governancePublishEnabled,
      governanceReceiveEnabled: config.governanceReceiveEnabled,
      validationReceiptEnabled: config.validationReceiptEnabled,
      activationReceiptEnabled: config.activationReceiptEnabled,
      replayBridgeEnabled: config.replayBridgeEnabled,
      replayExecuteEnabled: config.replayExecuteEnabled,
      replayReportEnabled: config.replayReportEnabled,
      grandfatherRegisterEnabled: config.grandfatherRegisterEnabled,
      publicationBridgeEnabled: config.publicationBridgeEnabled,
      publicationSubmitEnabled: config.publicationSubmitEnabled,
      discoveryEnabled: config.discoveryEnabled,
      localReferenceEnabled: config.localReferenceEnabled,
      externalRetrievalEnabled: config.externalRetrievalEnabled
    },
    publishedKnowledge: input.publishedKnowledgeBridge?.getStatus(),
    recovery:
      input.backupDir != null
        ? buildRecoveryStatus({
            backupDir: input.backupDir,
            artifactRetentionDays: input.artifactRetentionDays ?? 0,
            publishedKnowledgeBridge: input.publishedKnowledgeBridge,
            pkRepo: input.pkRepo
          })
        : undefined,
    rotation,
    queuePressure,
    notes
  };
}
