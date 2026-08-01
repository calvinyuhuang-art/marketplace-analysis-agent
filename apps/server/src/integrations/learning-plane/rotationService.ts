import { AppError } from "@maa/contracts";
import type { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import type { LearningPlaneSecretFile, RotationStatus } from "./contracts.js";
import type { LearningPlaneSecretStore } from "./secretStore.js";

function resolveRotationStatus(
  secret: Pick<
    LearningPlaneSecretFile,
    | "previousCredentialId"
    | "previousAgentApiKey"
    | "previousCallbackKeyId"
    | "previousCallbackVerificationSecret"
  >
): RotationStatus {
  const hasApiOverlap = !!(secret.previousAgentApiKey || secret.previousCredentialId);
  const hasHmacOverlap = !!(
    secret.previousCallbackVerificationSecret || secret.previousCallbackKeyId
  );
  if (hasApiOverlap && hasHmacOverlap) return "degraded";
  if (hasApiOverlap) return "api_key_overlap";
  if (hasHmacOverlap) return "hmac_overlap";
  return "idle";
}

function requireSecret(secrets: LearningPlaneSecretStore): LearningPlaneSecretFile {
  const secret = secrets.load();
  if (!secret) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      message: "Learning Plane secrets are missing or malformed."
    });
  }
  return secret;
}

export class LearningPlaneRotationService {
  constructor(
    private readonly secrets: LearningPlaneSecretStore,
    private readonly repo: LearningPlaneAdapterRepository
  ) {}

  applyCredentialRotation(input: {
    credentialId: string;
    agentApiKey: string;
    previousCredentialId?: string;
    overlapExpiresAt?: string;
  }): { credentialId: string; rotationStatus: RotationStatus } {
    if (input.agentApiKey.length < 32) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "agentApiKey must be at least 32 characters."
      });
    }
    const existing = requireSecret(this.secrets);
    const updated = this.secrets.applyRotationUpdate({
      credentialId: input.credentialId,
      agentApiKey: input.agentApiKey,
      previousCredentialId: input.previousCredentialId ?? existing.credentialId,
      previousAgentApiKey: existing.agentApiKey,
      rotationOverlapExpiresAt: input.overlapExpiresAt ?? existing.rotationOverlapExpiresAt,
      rotationStatus: resolveRotationStatus({
        previousCredentialId: input.previousCredentialId ?? existing.credentialId,
        previousAgentApiKey: existing.agentApiKey,
        previousCallbackKeyId: existing.previousCallbackKeyId,
        previousCallbackVerificationSecret: existing.previousCallbackVerificationSecret
      })
    });

    if (this.repo.tablesPresent()) {
      const settings = this.repo.getSettings();
      if (settings) {
        this.repo.upsertSettings({
          agentId: settings.agent_id,
          learningPlaneBaseUrl: settings.learning_plane_base_url,
          learningPlaneApiCompat: settings.learning_plane_api_compat,
          registrationStatus: settings.registration_status,
          credentialId: input.credentialId,
          callbackKeyId: settings.callback_key_id,
          callbackPath: settings.callback_path,
          enabled: settings.enabled === 1,
          publishEnabled: settings.publish_enabled === 1,
          receiveEnabled: settings.receive_enabled === 1,
          lastRegistrationCheckAt: settings.last_registration_check_at,
          lastHealthReportAt: settings.last_health_report_at,
          lastSuccessfulConnectionAt: settings.last_successful_connection_at,
          lastErrorCode: settings.last_error_code,
          lastBoundedError: settings.last_bounded_error
        });
      }
      this.repo.recordProcessingEvent({
        eventKind: "learning_plane.credential_rotation_applied",
        detail: {
          credentialId: input.credentialId,
          previousCredentialId: updated.previousCredentialId ?? null,
          rotationStatus: updated.rotationStatus ?? "idle"
        }
      });
    }

    return {
      credentialId: updated.credentialId,
      rotationStatus: updated.rotationStatus ?? "idle"
    };
  }

  applyCallbackKeyRotation(input: {
    callbackKeyId: string;
    callbackVerificationSecret: string;
    previousCallbackKeyId?: string;
    previousCallbackVerificationSecret?: string;
    overlapExpiresAt?: string;
    acceptedCallbackKeyIds?: string[];
  }): { callbackKeyId: string; rotationStatus: RotationStatus } {
    if (input.callbackVerificationSecret.length < 32) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "callbackVerificationSecret must be at least 32 characters."
      });
    }
    const existing = requireSecret(this.secrets);
    const previousCallbackKeyId = input.previousCallbackKeyId ?? existing.callbackKeyId;
    const previousCallbackVerificationSecret =
      input.previousCallbackVerificationSecret ?? existing.callbackVerificationSecret;

    const updated = this.secrets.applyRotationUpdate({
      callbackKeyId: input.callbackKeyId,
      callbackVerificationSecret: input.callbackVerificationSecret,
      previousCallbackKeyId,
      previousCallbackVerificationSecret,
      acceptedCallbackKeyIds: input.acceptedCallbackKeyIds ?? existing.acceptedCallbackKeyIds,
      rotationOverlapExpiresAt: input.overlapExpiresAt ?? existing.rotationOverlapExpiresAt,
      rotationStatus: resolveRotationStatus({
        previousCredentialId: existing.previousCredentialId,
        previousAgentApiKey: existing.previousAgentApiKey,
        previousCallbackKeyId,
        previousCallbackVerificationSecret
      })
    });

    if (this.repo.tablesPresent()) {
      const settings = this.repo.getSettings();
      if (settings) {
        this.repo.upsertSettings({
          agentId: settings.agent_id,
          learningPlaneBaseUrl: settings.learning_plane_base_url,
          learningPlaneApiCompat: settings.learning_plane_api_compat,
          registrationStatus: settings.registration_status,
          credentialId: settings.credential_id,
          callbackKeyId: input.callbackKeyId,
          callbackPath: settings.callback_path,
          enabled: settings.enabled === 1,
          publishEnabled: settings.publish_enabled === 1,
          receiveEnabled: settings.receive_enabled === 1,
          lastRegistrationCheckAt: settings.last_registration_check_at,
          lastHealthReportAt: settings.last_health_report_at,
          lastSuccessfulConnectionAt: settings.last_successful_connection_at,
          lastErrorCode: settings.last_error_code,
          lastBoundedError: settings.last_bounded_error
        });
      }
      this.repo.recordProcessingEvent({
        eventKind: "learning_plane.callback_key_rotation_applied",
        detail: {
          callbackKeyId: input.callbackKeyId,
          previousCallbackKeyId: updated.previousCallbackKeyId ?? null,
          rotationStatus: updated.rotationStatus ?? "idle"
        }
      });
    }

    return {
      callbackKeyId: updated.callbackKeyId,
      rotationStatus: updated.rotationStatus ?? "idle"
    };
  }

  completeCredentialRotation(): { rotationStatus: RotationStatus } {
    const existing = requireSecret(this.secrets);
    const updated = this.secrets.applyRotationUpdate({
      previousCredentialId: undefined,
      previousAgentApiKey: undefined,
      clearPreviousCredential: true,
      rotationStatus: resolveRotationStatus({
        previousCredentialId: undefined,
        previousAgentApiKey: undefined,
        previousCallbackKeyId: existing.previousCallbackKeyId,
        previousCallbackVerificationSecret: existing.previousCallbackVerificationSecret
      })
    });

    if (this.repo.tablesPresent()) {
      this.repo.recordProcessingEvent({
        eventKind: "learning_plane.credential_rotation_completed",
        detail: { rotationStatus: updated.rotationStatus ?? "idle" }
      });
    }

    return { rotationStatus: updated.rotationStatus ?? "idle" };
  }

  completeCallbackKeyRotation(): { rotationStatus: RotationStatus } {
    const existing = requireSecret(this.secrets);
    const updated = this.secrets.applyRotationUpdate({
      previousCallbackKeyId: undefined,
      previousCallbackVerificationSecret: undefined,
      acceptedCallbackKeyIds: undefined,
      clearPreviousCallback: true,
      rotationStatus: resolveRotationStatus({
        previousCredentialId: existing.previousCredentialId,
        previousAgentApiKey: existing.previousAgentApiKey,
        previousCallbackKeyId: undefined,
        previousCallbackVerificationSecret: undefined
      })
    });

    if (this.repo.tablesPresent()) {
      this.repo.recordProcessingEvent({
        eventKind: "learning_plane.callback_key_rotation_completed",
        detail: { rotationStatus: updated.rotationStatus ?? "idle" }
      });
    }

    return { rotationStatus: updated.rotationStatus ?? "idle" };
  }

  rollbackCredentialRotation(): { credentialId: string; rotationStatus: RotationStatus } {
    const existing = requireSecret(this.secrets);
    if (!existing.previousAgentApiKey || !existing.previousCredentialId) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "No previous credential material available for rollback."
      });
    }

    const updated = this.secrets.applyRotationUpdate({
      credentialId: existing.previousCredentialId,
      agentApiKey: existing.previousAgentApiKey,
      previousCredentialId: undefined,
      previousAgentApiKey: undefined,
      clearPreviousCredential: true,
      rotationStatus: resolveRotationStatus({
        previousCredentialId: undefined,
        previousAgentApiKey: undefined,
        previousCallbackKeyId: existing.previousCallbackKeyId,
        previousCallbackVerificationSecret: existing.previousCallbackVerificationSecret
      })
    });

    if (this.repo.tablesPresent()) {
      const settings = this.repo.getSettings();
      if (settings) {
        this.repo.upsertSettings({
          agentId: settings.agent_id,
          learningPlaneBaseUrl: settings.learning_plane_base_url,
          learningPlaneApiCompat: settings.learning_plane_api_compat,
          registrationStatus: settings.registration_status,
          credentialId: updated.credentialId,
          callbackKeyId: settings.callback_key_id,
          callbackPath: settings.callback_path,
          enabled: settings.enabled === 1,
          publishEnabled: settings.publish_enabled === 1,
          receiveEnabled: settings.receive_enabled === 1,
          lastRegistrationCheckAt: settings.last_registration_check_at,
          lastHealthReportAt: settings.last_health_report_at,
          lastSuccessfulConnectionAt: settings.last_successful_connection_at,
          lastErrorCode: settings.last_error_code,
          lastBoundedError: settings.last_bounded_error
        });
      }
      this.repo.recordProcessingEvent({
        eventKind: "learning_plane.credential_rotation_rolled_back",
        detail: {
          credentialId: updated.credentialId,
          rotationStatus: updated.rotationStatus ?? "idle"
        }
      });
    }

    return {
      credentialId: updated.credentialId,
      rotationStatus: updated.rotationStatus ?? "idle"
    };
  }

  operatorRetryOutbox(outboxId: string): { outboxId: string; status: string } {
    const row = this.repo.operatorRetryOutbox(outboxId);
    if (!row) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Outbox item not found or not eligible for operator retry."
      });
    }
    return { outboxId: row.outbox_id, status: row.status };
  }
}
