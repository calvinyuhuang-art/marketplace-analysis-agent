import { resolve } from "node:path";
import type { Config } from "@maa/contracts";
import { API_COMPAT_VERSION as LP_API_COMPAT_VERSION } from "@learning-plane/contracts";

export const LP8_I3B_MILESTONE = "LP8-I3b" as const;
/** @deprecated use LP8_I3B_MILESTONE */
export const LP8_I1_MILESTONE = LP8_I3B_MILESTONE;
export const MAA_LP_ADAPTER_ID = "maa-learning-plane-adapter" as const;
export const MAA_LP_REQUIRED_API_COMPAT = LP_API_COMPAT_VERSION;
export const MAA_LP_SUPPORTED_CONTRACT_VERSIONS = ["1.0"] as const;

export type LearningPlaneAdapterConfig = {
  enabled: boolean;
  publishEnabled: boolean;
  receiveEnabled: boolean;
  baseUrl: string;
  agentId: string;
  callbackHost: string;
  callbackPath: string;
  healthReportIntervalSeconds: number;
  requestTimeoutMs: number;
  secretFilePath: string;
  maaHost: string;
  maaPort: number;
};

export function resolveLearningPlaneAdapterConfig(
  raw: Config,
  repoRoot: string
): LearningPlaneAdapterConfig {
  return {
    enabled: raw.MAA_LEARNING_PLANE_ENABLED,
    publishEnabled: raw.MAA_LEARNING_PLANE_PUBLISH_ENABLED,
    receiveEnabled: raw.MAA_LEARNING_PLANE_RECEIVE_ENABLED,
    baseUrl: raw.MAA_LEARNING_PLANE_BASE_URL.replace(/\/$/, ""),
    agentId: raw.MAA_LEARNING_PLANE_AGENT_ID,
    callbackHost: raw.MAA_LEARNING_PLANE_CALLBACK_HOST,
    callbackPath: raw.MAA_LEARNING_PLANE_CALLBACK_PATH,
    healthReportIntervalSeconds: raw.MAA_LEARNING_PLANE_HEALTH_REPORT_INTERVAL_SECONDS,
    requestTimeoutMs: raw.MAA_LEARNING_PLANE_REQUEST_TIMEOUT_MS,
    secretFilePath: resolve(repoRoot, raw.MAA_LEARNING_PLANE_SECRET_FILE),
    maaHost: raw.MAA_HOST,
    maaPort: raw.MAA_PORT
  };
}

export function agentPublicBaseUrl(config: LearningPlaneAdapterConfig): string {
  return `http://${config.callbackHost}:${config.maaPort}`;
}

/** Capabilities declared from accepted feature flags (implemented only). */
export function declaredCapabilitiesForFlags(config: {
  enabled: boolean;
  publishEnabled: boolean;
  receiveEnabled: boolean;
}): Array<
  "health.report" | "events.publish" | "events.receive" | "events.acknowledge"
> {
  if (!config.enabled) return [];
  const caps: Array<
    "health.report" | "events.publish" | "events.receive" | "events.acknowledge"
  > = ["health.report"];
  if (config.publishEnabled) caps.push("events.publish");
  if (config.receiveEnabled) {
    caps.push("events.receive", "events.acknowledge");
  }
  return caps;
}

/** @deprecated Prefer declaredCapabilitiesForFlags(config). */
export const MAA_LP_DECLARED_CAPABILITIES = ["health.report"] as const;

export function publishModeStatus(config: LearningPlaneAdapterConfig): {
  flag: boolean;
  status: "disabled" | "active";
} {
  if (!config.enabled || !config.publishEnabled) return { flag: false, status: "disabled" };
  return { flag: true, status: "active" };
}

export function receiveModeStatus(config: LearningPlaneAdapterConfig): {
  flag: boolean;
  status: "disabled" | "active";
} {
  if (!config.enabled || !config.receiveEnabled) return { flag: false, status: "disabled" };
  return { flag: true, status: "active" };
}
