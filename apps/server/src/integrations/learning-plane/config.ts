import { resolve } from "node:path";
import type { Config } from "@maa/contracts";
import { API_COMPAT_VERSION as LP_API_COMPAT_VERSION } from "@learning-plane/contracts";
import type { AgentCapability } from "@learning-plane/contracts";

export const LP8_I3B_MILESTONE = "LP8-I3b" as const;
export const LP8_I4C_MILESTONE = "LP8-I4c" as const;
export const LP8_I5C_MILESTONE = "LP8-I5c" as const;
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
  /** LP8-I4c production bridge flags (all default off). */
  governanceBridgeEnabled: boolean;
  governancePublishEnabled: boolean;
  governanceReceiveEnabled: boolean;
  validationReceiptEnabled: boolean;
  activationReceiptEnabled: boolean;
  replayBridgeEnabled: boolean;
  replayExecuteEnabled: boolean;
  replayReportEnabled: boolean;
  grandfatherRegisterEnabled: boolean;
  /** LP8-I5c published-knowledge flags (all default off). */
  publicationBridgeEnabled: boolean;
  publicationSubmitEnabled: boolean;
  publicationReconcileEnabled: boolean;
  discoveryEnabled: boolean;
  packageFetchEnabled: boolean;
  localReferenceEnabled: boolean;
  localReferenceReviewEnabled: boolean;
  externalRetrievalEnabled: boolean;
  referenceReceiptEnabled: boolean;
  useReceiptEnabled: boolean;
  influenceReceiptEnabled: boolean;
  challengeEnabled: boolean;
  pkLifecycleReconcileEnabled: boolean;
  offlineGraceHours: number;
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
    maaPort: raw.MAA_PORT,
    governanceBridgeEnabled: raw.MAA_LEARNING_PLANE_GOVERNANCE_BRIDGE_ENABLED,
    governancePublishEnabled: raw.MAA_LEARNING_PLANE_GOVERNANCE_PUBLISH_ENABLED,
    governanceReceiveEnabled: raw.MAA_LEARNING_PLANE_GOVERNANCE_RECEIVE_ENABLED,
    validationReceiptEnabled: raw.MAA_LEARNING_PLANE_VALIDATION_RECEIPT_ENABLED,
    activationReceiptEnabled: raw.MAA_LEARNING_PLANE_ACTIVATION_RECEIPT_ENABLED,
    replayBridgeEnabled: raw.MAA_LEARNING_PLANE_REPLAY_BRIDGE_ENABLED,
    replayExecuteEnabled: raw.MAA_LEARNING_PLANE_REPLAY_EXECUTE_ENABLED,
    replayReportEnabled: raw.MAA_LEARNING_PLANE_REPLAY_REPORT_ENABLED,
    grandfatherRegisterEnabled: raw.MAA_LEARNING_PLANE_GRANDFATHER_REGISTER_ENABLED,
    publicationBridgeEnabled: raw.MAA_LEARNING_PLANE_PUBLICATION_BRIDGE_ENABLED,
    publicationSubmitEnabled: raw.MAA_LEARNING_PLANE_PUBLICATION_SUBMIT_ENABLED,
    publicationReconcileEnabled: raw.MAA_LEARNING_PLANE_PUBLICATION_RECONCILE_ENABLED,
    discoveryEnabled: raw.MAA_LEARNING_PLANE_DISCOVERY_ENABLED,
    packageFetchEnabled: raw.MAA_LEARNING_PLANE_PACKAGE_FETCH_ENABLED,
    localReferenceEnabled: raw.MAA_LEARNING_PLANE_LOCAL_REFERENCE_ENABLED,
    localReferenceReviewEnabled: raw.MAA_LEARNING_PLANE_LOCAL_REFERENCE_REVIEW_ENABLED,
    externalRetrievalEnabled: raw.MAA_LEARNING_PLANE_EXTERNAL_RETRIEVAL_ENABLED,
    referenceReceiptEnabled: raw.MAA_LEARNING_PLANE_REFERENCE_RECEIPT_ENABLED,
    useReceiptEnabled: raw.MAA_LEARNING_PLANE_USE_RECEIPT_ENABLED,
    influenceReceiptEnabled: raw.MAA_LEARNING_PLANE_INFLUENCE_RECEIPT_ENABLED,
    challengeEnabled: raw.MAA_LEARNING_PLANE_CHALLENGE_ENABLED,
    pkLifecycleReconcileEnabled: raw.MAA_LEARNING_PLANE_PK_LIFECYCLE_RECONCILE_ENABLED,
    offlineGraceHours: raw.MAA_LEARNING_PLANE_OFFLINE_GRACE_HOURS
  };
}

export function agentPublicBaseUrl(config: LearningPlaneAdapterConfig): string {
  return `http://${config.callbackHost}:${config.maaPort}`;
}

type DeclaredCap =
  | "health.report"
  | "events.publish"
  | "events.receive"
  | "events.acknowledge"
  | "procedural_change.propose"
  | "governance.decision_receive"
  | "local_validation.receipt_submit"
  | "activation.receipt_submit"
  | "rollback.receipt_submit"
  | "replay.execute"
  | "replay.status_submit"
  | "replay.report_submit"
  | "legacy_local.reference_register"
  | "knowledge.publish_proposal"
  | "knowledge.discover"
  | "knowledge.challenge_submit"
  | "knowledge.reference_receipt_submit"
  | "knowledge.use_receipt_submit"
  | "knowledge.influence_receipt_submit"
  | "knowledge.eligibility_query";

/** Capabilities declared from accepted feature flags (implemented only). */
export function declaredCapabilitiesForFlags(
  config: Pick<
    LearningPlaneAdapterConfig,
    | "enabled"
    | "publishEnabled"
    | "receiveEnabled"
    | "governanceBridgeEnabled"
    | "governancePublishEnabled"
    | "governanceReceiveEnabled"
    | "validationReceiptEnabled"
    | "activationReceiptEnabled"
    | "replayBridgeEnabled"
    | "replayExecuteEnabled"
    | "replayReportEnabled"
    | "grandfatherRegisterEnabled"
    | "publicationBridgeEnabled"
    | "publicationSubmitEnabled"
    | "discoveryEnabled"
    | "challengeEnabled"
    | "referenceReceiptEnabled"
    | "useReceiptEnabled"
    | "influenceReceiptEnabled"
  >
): DeclaredCap[] {
  if (!config.enabled) return [];
  const caps: DeclaredCap[] = ["health.report"];
  if (config.publishEnabled) caps.push("events.publish");
  if (config.receiveEnabled) {
    caps.push("events.receive", "events.acknowledge");
  }
  if (config.governanceBridgeEnabled && config.governancePublishEnabled) {
    caps.push("procedural_change.propose");
  }
  if (config.governanceBridgeEnabled && config.governanceReceiveEnabled) {
    caps.push("governance.decision_receive");
  }
  if (config.governanceBridgeEnabled && config.validationReceiptEnabled) {
    caps.push("local_validation.receipt_submit");
  }
  if (config.governanceBridgeEnabled && config.activationReceiptEnabled) {
    caps.push("activation.receipt_submit", "rollback.receipt_submit");
  }
  if (config.replayBridgeEnabled) {
    caps.push("replay.execute", "replay.status_submit");
  }
  if (config.replayBridgeEnabled && config.replayReportEnabled) {
    caps.push("replay.report_submit");
  }
  if (config.governanceBridgeEnabled && config.grandfatherRegisterEnabled) {
    caps.push("legacy_local.reference_register");
  }
  if (config.publicationBridgeEnabled) {
    if (config.publicationSubmitEnabled) caps.push("knowledge.publish_proposal");
    if (config.discoveryEnabled) {
      caps.push("knowledge.discover", "knowledge.eligibility_query");
    }
    if (config.challengeEnabled) caps.push("knowledge.challenge_submit");
    if (config.referenceReceiptEnabled) caps.push("knowledge.reference_receipt_submit");
    if (config.useReceiptEnabled) caps.push("knowledge.use_receipt_submit");
    if (config.influenceReceiptEnabled) caps.push("knowledge.influence_receipt_submit");
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

export function asAgentCapabilities(caps: DeclaredCap[]): AgentCapability[] {
  return caps as AgentCapability[];
}
