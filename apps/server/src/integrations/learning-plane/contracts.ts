export type RegistrationStatus =
  | "unregistered"
  | "registered"
  | "reconciled"
  | "failed"
  | "disabled";

export type AdapterRuntimeState =
  | "disabled"
  | "enabled"
  | "degraded"
  | "unavailable"
  | "not_bootstrapped";

export type LpAdapterSettingsRow = {
  adapter_id: string;
  agent_id: string;
  learning_plane_base_url: string;
  learning_plane_api_compat: string | null;
  registration_status: RegistrationStatus;
  credential_id: string | null;
  callback_key_id: string | null;
  callback_path: string | null;
  enabled: number;
  publish_enabled: number;
  receive_enabled: number;
  last_registration_check_at: string | null;
  last_health_report_at: string | null;
  last_successful_connection_at: string | null;
  last_error_code: string | null;
  last_bounded_error: string | null;
  created_at: string;
  updated_at: string;
};

export type RotationStatus = "idle" | "api_key_overlap" | "hmac_overlap" | "degraded";

export type LearningPlaneSecretFile = {
  schemaVersion: "maa.learning-plane-adapter.secrets.v1";
  agentId: string;
  learningPlaneBaseUrl: string;
  credentialId: string;
  callbackKeyId: string;
  agentApiKey: string;
  callbackVerificationSecret: string;
  createdAt: string;
  updatedAt: string;
  previousCredentialId?: string;
  previousAgentApiKey?: string;
  previousCallbackKeyId?: string;
  previousCallbackVerificationSecret?: string;
  acceptedCallbackKeyIds?: string[];
  rotationStatus?: RotationStatus;
  rotationOverlapExpiresAt?: string;
};

export type BootstrapRequest = {
  operatorToken: string;
  learningPlaneBaseUrl?: string;
};

export type LearningPlaneStatusResponse = {
  implementationMilestone: "LP8-I3b" | "LP8-I4c" | "LP8-I5c";
  enabled: boolean;
  publishEnabled: boolean;
  receiveEnabled: boolean;
  publishMode: "disabled" | "active";
  receiveMode: "disabled" | "active";
  adapterState: AdapterRuntimeState;
  agentId: string;
  declaredCapabilities: string[];
  registrationStatus: RegistrationStatus | "unknown";
  credentialId: string | null;
  callbackKeyId: string | null;
  callbackPath: string;
  learningPlaneBaseUrl: string;
  learningPlaneApiCompatibility: string | null;
  requiredLearningPlaneApiCompatibility: string;
  maaServiceVersion: string;
  maaApiCompatibility: string;
  maaDatabaseSchemaVersion: string;
  lastHealthReportAt: string | null;
  lastSuccessfulConnectionAt: string | null;
  lastSuccessfulPublishAt: string | null;
  lastSuccessfulReceiveAt: string | null;
  lastSuccessfulAcknowledgementAt: string | null;
  lastErrorCode: string | null;
  boundedDiagnostic: string | null;
  outboxCounts: Record<string, number>;
  inboxCounts: Record<string, number>;
  acknowledgementCounts: Record<string, number>;
  waitingForCausationCount: number;
  awaitingLocalReconciliationCount: number;
  semanticConflictCount: number;
  oldestPendingAgeSeconds: number | null;
  secretsPresent: boolean;
  packageIdentity: {
    clientVersion: string;
    contractsVersion: string;
    apiCompat: string;
    envelopeVersion: string;
    releasedWorkflowFeedbackPayloadVersions: Record<string, string>;
    packageChecksum: {
      client: string | null;
      contracts: string | null;
    };
    buildCommitOrSourceRevision: string | null;
  };
  bridgeFlags?: {
    governanceBridgeEnabled: boolean;
    governancePublishEnabled: boolean;
    governanceReceiveEnabled: boolean;
    validationReceiptEnabled: boolean;
    activationReceiptEnabled: boolean;
    replayBridgeEnabled: boolean;
    replayExecuteEnabled: boolean;
    replayReportEnabled: boolean;
    grandfatherRegisterEnabled: boolean;
    publicationBridgeEnabled?: boolean;
    publicationSubmitEnabled?: boolean;
    discoveryEnabled?: boolean;
    localReferenceEnabled?: boolean;
    externalRetrievalEnabled?: boolean;
  };
  publishedKnowledge?: Record<string, unknown>;
  rotation?: {
    status: string;
    credentialId: string | null;
    previousCredentialId: string | null;
    callbackKeyId: string | null;
    previousCallbackKeyId: string | null;
    acceptedCallbackKeyIds: string[];
    overlapExpiresAt: string | null;
  };
  queuePressure?: {
    outboxPending: number;
    outboxRetryScheduled: number;
    outboxPermanentFailure: number;
    oldestPendingAgeSeconds: number | null;
  };
  notes: string[];
};
