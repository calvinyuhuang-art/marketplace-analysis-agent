import { AppError, API_COMPAT_LABEL } from "@maa/contracts";
import type { Logger } from "@maa/logging";
import {
  declaredCapabilitiesForFlags,
  asAgentCapabilities,
  MAA_LP_REQUIRED_API_COMPAT,
  MAA_LP_SUPPORTED_CONTRACT_VERSIONS,
  agentPublicBaseUrl,
  type LearningPlaneAdapterConfig
} from "./config.js";
import type { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import {
  createAgentClient,
  createBootstrapClient,
  probeLearningPlaneApiCompat
} from "./clientFactory.js";
import type { LearningPlaneSecretStore } from "./secretStore.js";
import type { RegisteredAgent } from "@learning-plane/contracts";

export type RegistrationDeps = {
  config: LearningPlaneAdapterConfig;
  repo: LearningPlaneAdapterRepository;
  secrets: LearningPlaneSecretStore;
  serviceVersion: string;
  logger: Logger;
};

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]").slice(0, 500);
}

async function operatorJson<T>(
  baseUrl: string,
  path: string,
  operatorToken: string,
  timeoutMs: number,
  body: unknown = {}
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${operatorToken}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const json = (await response.json()) as T;
    if (!response.ok) {
      throw new Error(`Learning Plane operator call ${path} failed with HTTP ${response.status}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

/** Idempotent recovery when LP already has marketplace-analysis-agent registered. */
async function rebootstrapExistingAgent(input: {
  config: LearningPlaneAdapterConfig;
  operatorToken: string;
  serviceVersion: string;
}): Promise<{
  agent: RegisteredAgent;
  agentApiKey: string;
  callbackVerificationSecret: string;
}> {
  const { config, operatorToken } = input;
  const rotated = await operatorJson<{
    credentialId: string;
    agentApiKey: string;
  }>(
    config.baseUrl,
    `/v1/agents/${encodeURIComponent(config.agentId)}/credentials/rotate`,
    operatorToken,
    config.requestTimeoutMs,
    { gracePeriodSeconds: 60 }
  );
  const callback = await operatorJson<{
    currentKeyId: string;
    currentSecret: string;
    nextKeyId: string;
    nextSecret: string;
  }>(
    config.baseUrl,
    `/v1/agents/${encodeURIComponent(config.agentId)}/callback-keys/rotate`,
    operatorToken,
    config.requestTimeoutMs,
    { gracePeriodSeconds: 60 }
  );
  const agent = await createAgentClient(config, rotated.agentApiKey).updateCapabilities(
    config.agentId,
    {
          capabilities: asAgentCapabilities(declaredCapabilitiesForFlags(config)),
      supportedContractVersions: [...MAA_LP_SUPPORTED_CONTRACT_VERSIONS]
    }
  );
  return {
    agent,
    agentApiKey: rotated.agentApiKey,
    callbackVerificationSecret: callback.nextSecret || callback.currentSecret
  };
}

export class LearningPlaneRegistrationService {
  constructor(private readonly deps: RegistrationDeps) {}

  async bootstrap(operatorToken: string, baseUrlOverride?: string): Promise<{
    agentId: string;
    credentialId: string;
    callbackKeyId: string;
    capabilities: string[];
  }> {
    const { config, repo, secrets, serviceVersion, logger } = this.deps;
    if (!config.enabled) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Learning Plane adapter is disabled. Set MAA_LEARNING_PLANE_ENABLED=true first."
      });
    }
    if (!operatorToken || operatorToken.trim().length < 8) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Bootstrap requires a temporary Learning Plane operator token (min 8 chars)."
      });
    }

    const effectiveConfig: LearningPlaneAdapterConfig = {
      ...config,
      baseUrl: (baseUrlOverride ?? config.baseUrl).replace(/\/$/, "")
    };

    repo.recordProcessingEvent({
      eventKind: "learning_plane.bootstrap_started",
      detail: { agentId: effectiveConfig.agentId, baseUrl: effectiveConfig.baseUrl }
    });
    logger.info(
      { eventType: "learning_plane.bootstrap_started", agentId: effectiveConfig.agentId },
      "Learning Plane bootstrap started"
    );

    try {
      const probe = await probeLearningPlaneApiCompat(
        effectiveConfig.baseUrl,
        effectiveConfig.requestTimeoutMs
      );
      if (!probe.ok || probe.apiCompat !== MAA_LP_REQUIRED_API_COMPAT) {
        const code = "LP_API_COMPAT_MISMATCH";
        const message = `Learning Plane API compatibility rejected. required=${MAA_LP_REQUIRED_API_COMPAT} observed=${probe.apiCompat ?? "missing"} (${probe.error ?? "ok"})`;
        repo.upsertSettings({
          agentId: effectiveConfig.agentId,
          learningPlaneBaseUrl: effectiveConfig.baseUrl,
          learningPlaneApiCompat: probe.apiCompat,
          registrationStatus: "failed",
          enabled: true,
          publishEnabled: effectiveConfig.publishEnabled,
          receiveEnabled: effectiveConfig.receiveEnabled,
          lastRegistrationCheckAt: new Date().toISOString(),
          lastErrorCode: code,
          lastBoundedError: message
        });
        throw new AppError({ code: "VALIDATION_ERROR", message });
      }

      const client = createBootstrapClient(effectiveConfig, operatorToken.trim());
      let registered: {
        agent: RegisteredAgent;
        agentApiKey: string;
        callbackVerificationSecret: string;
      };
      try {
        registered = (await client.registerAgent({
          agentId: effectiveConfig.agentId,
          displayName: "Marketplace Analysis Agent",
          agentType: "marketplace_analysis",
          serviceVersion: String(serviceVersion),
          supportedContractVersions: [...MAA_LP_SUPPORTED_CONTRACT_VERSIONS],
          baseUrl: agentPublicBaseUrl(effectiveConfig),
          callbackPath: effectiveConfig.callbackPath,
          healthEndpointPath: "/health",
          capabilities: asAgentCapabilities(declaredCapabilitiesForFlags(effectiveConfig)),
          enabled: true
        })) as {
          agent: RegisteredAgent;
          agentApiKey: string;
          callbackVerificationSecret: string;
        };
      } catch (error) {
        const status =
          error && typeof error === "object" && "status" in error
            ? Number((error as { status?: number }).status)
            : undefined;
        if (status !== 409) throw error;
        registered = await rebootstrapExistingAgent({
          config: effectiveConfig,
          operatorToken: operatorToken.trim(),
          serviceVersion: String(serviceVersion)
        });
      }

      const secret = secrets.save({
        agentId: registered.agent.agentId,
        learningPlaneBaseUrl: effectiveConfig.baseUrl,
        credentialId: registered.agent.credentialId,
        callbackKeyId: "lp-delivery-hmac-v1",
        agentApiKey: registered.agentApiKey,
        callbackVerificationSecret: registered.callbackVerificationSecret
      });

      const timestamp = new Date().toISOString();
      repo.upsertSettings({
        agentId: registered.agent.agentId,
        learningPlaneBaseUrl: effectiveConfig.baseUrl,
        learningPlaneApiCompat: probe.apiCompat,
        registrationStatus: "registered",
        credentialId: secret.credentialId,
        callbackKeyId: secret.callbackKeyId,
        callbackPath: effectiveConfig.callbackPath,
        enabled: true,
        publishEnabled: effectiveConfig.publishEnabled,
        receiveEnabled: effectiveConfig.receiveEnabled,
        lastRegistrationCheckAt: timestamp,
        lastSuccessfulConnectionAt: timestamp,
        lastErrorCode: null,
        lastBoundedError: null
      });
      repo.recordProcessingEvent({
        eventKind: "learning_plane.bootstrap_completed",
        detail: {
          agentId: registered.agent.agentId,
          credentialId: secret.credentialId,
          callbackKeyId: secret.callbackKeyId,
          capabilities: registered.agent.capabilities
        }
      });
      repo.recordProcessingEvent({
        eventKind: "learning_plane.secret_loaded",
        detail: { credentialId: secret.credentialId, pathPresent: true }
      });
      logger.info(
        {
          eventType: "learning_plane.bootstrap_completed",
          agentId: registered.agent.agentId,
          credentialId: secret.credentialId
        },
        "Learning Plane bootstrap completed"
      );

      return {
        agentId: registered.agent.agentId,
        credentialId: secret.credentialId,
        callbackKeyId: secret.callbackKeyId,
        capabilities: registered.agent.capabilities
      };
    } catch (error) {
      const message = boundedError(error);
      repo.recordProcessingEvent({
        eventKind: "learning_plane.bootstrap_failed",
        detail: { error: message }
      });
      logger.warn(
        { eventType: "learning_plane.bootstrap_failed", err: { message } },
        "Learning Plane bootstrap failed"
      );
      if (error instanceof AppError) throw error;
      throw new AppError({
        code: "INTERNAL_ERROR",
        message: `Learning Plane bootstrap failed: ${message}`,
        retryable: true,
        httpStatus: 502
      });
    }
  }

  async reconcile(): Promise<{
    agentId: string;
    credentialId: string;
    capabilities: string[];
    registrationStatus: "reconciled";
  }> {
    const { config, repo, secrets, serviceVersion, logger } = this.deps;
    if (!config.enabled) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Learning Plane adapter is disabled."
      });
    }
    if (!secrets.exists()) {
      repo.recordProcessingEvent({ eventKind: "learning_plane.secret_missing", detail: {} });
      throw new AppError({
        code: "VALIDATION_ERROR",
        message:
          "Learning Plane secrets are missing. Run bootstrap with a temporary operator token."
      });
    }

    const secret = secrets.load();
    if (!secret) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Learning Plane secrets could not be loaded."
      });
    }

    const probe = await probeLearningPlaneApiCompat(config.baseUrl, config.requestTimeoutMs);
    if (!probe.ok || probe.apiCompat !== MAA_LP_REQUIRED_API_COMPAT) {
      const message = `Learning Plane API compatibility rejected during reconcile. required=${MAA_LP_REQUIRED_API_COMPAT} observed=${probe.apiCompat ?? "missing"}`;
      repo.upsertSettings({
        agentId: config.agentId,
        learningPlaneBaseUrl: config.baseUrl,
        learningPlaneApiCompat: probe.apiCompat,
        registrationStatus: "failed",
        credentialId: secret.credentialId,
        callbackKeyId: secret.callbackKeyId,
        callbackPath: config.callbackPath,
        enabled: true,
        publishEnabled: config.publishEnabled,
        receiveEnabled: config.receiveEnabled,
        lastRegistrationCheckAt: new Date().toISOString(),
        lastErrorCode: "LP_API_COMPAT_MISMATCH",
        lastBoundedError: message
      });
      throw new AppError({ code: "VALIDATION_ERROR", message });
    }

    try {
      const expectedCapabilities = asAgentCapabilities(declaredCapabilitiesForFlags(config));
      const agent = await createAgentClient(config, secret.agentApiKey).updateCapabilities(
        config.agentId,
        {
          capabilities: expectedCapabilities,
          supportedContractVersions: [...MAA_LP_SUPPORTED_CONTRACT_VERSIONS]
        }
      );
      if (!agent.enabled) {
        repo.upsertSettings({
          agentId: config.agentId,
          learningPlaneBaseUrl: config.baseUrl,
          learningPlaneApiCompat: probe.apiCompat,
          registrationStatus: "disabled",
          credentialId: secret.credentialId,
          callbackKeyId: secret.callbackKeyId,
          callbackPath: config.callbackPath,
          enabled: true,
          publishEnabled: config.publishEnabled,
          receiveEnabled: config.receiveEnabled,
          lastRegistrationCheckAt: new Date().toISOString(),
          lastErrorCode: "LP_AGENT_DISABLED",
          lastBoundedError: "Learning Plane reports the agent as disabled."
        });
        throw new AppError({
          code: "FORBIDDEN",
          message: "Learning Plane agent is disabled."
        });
      }

      const expectedSet = new Set<string>(expectedCapabilities);
      const unsupported = agent.capabilities.filter((cap) => !expectedSet.has(cap));
      if (unsupported.length > 0) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: `Unexpected Learning Plane capabilities present after reconcile: ${unsupported.join(", ")}`
        });
      }
      const missing = expectedCapabilities.filter(
        (cap) => !(agent.capabilities as string[]).includes(cap)
      );
      if (missing.length > 0) {
        throw new AppError({
          code: "VALIDATION_ERROR",
          message: `Missing Learning Plane capabilities after reconcile: ${missing.join(", ")}`
        });
      }

      const timestamp = new Date().toISOString();
      repo.upsertSettings({
        agentId: agent.agentId,
        learningPlaneBaseUrl: config.baseUrl,
        learningPlaneApiCompat: probe.apiCompat,
        registrationStatus: "reconciled",
        credentialId: secret.credentialId,
        callbackKeyId: secret.callbackKeyId,
        callbackPath: config.callbackPath,
        enabled: true,
        publishEnabled: config.publishEnabled,
        receiveEnabled: config.receiveEnabled,
        lastRegistrationCheckAt: timestamp,
        lastSuccessfulConnectionAt: timestamp,
        lastErrorCode: null,
        lastBoundedError: null
      });
      repo.recordProcessingEvent({
        eventKind: "learning_plane.registration_reconciled",
        detail: {
          agentId: agent.agentId,
          capabilities: agent.capabilities,
          maaApiCompat: API_COMPAT_LABEL,
          serviceVersion
        }
      });
      logger.info(
        { eventType: "learning_plane.registration_reconciled", agentId: agent.agentId },
        "Learning Plane registration reconciled"
      );
      return {
        agentId: agent.agentId,
        credentialId: secret.credentialId,
        capabilities: agent.capabilities,
        registrationStatus: "reconciled"
      };
    } catch (error) {
      const message = boundedError(error);
      repo.recordProcessingEvent({
        eventKind: "learning_plane.registration_failed",
        detail: { error: message }
      });
      logger.warn(
        { eventType: "learning_plane.registration_failed", err: { message } },
        "Learning Plane registration reconcile failed"
      );
      if (error instanceof AppError) throw error;
      throw new AppError({
        code: "INTERNAL_ERROR",
        message: `Learning Plane reconcile failed: ${message}`,
        retryable: true,
        httpStatus: 502
      });
    }
  }
}
