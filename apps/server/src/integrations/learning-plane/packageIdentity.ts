import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LEARNING_PLANE_CLIENT_COMPAT } from "@learning-plane/client";
import { API_COMPAT_VERSION } from "@learning-plane/contracts";

export type LearningPlanePackageIdentity = {
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

type BundleManifest = {
  learningPlaneClientVersion?: string;
  learningPlaneContractsVersion?: string;
  learningPlaneApiCompat?: string;
  supportedEnvelopeVersions?: string[];
  releasedWorkflowFeedbackPayloadVersions?: Record<string, string>;
  buildCommitOrSourceRevision?: string;
  artifacts?: {
    client?: { packageSha256?: string; version?: string };
    contracts?: { packageSha256?: string; version?: string };
  };
};

export function loadLearningPlanePackageIdentity(repoRoot: string): LearningPlanePackageIdentity {
  let clientSha: string | null = null;
  let contractsSha: string | null = null;
  let clientVersion: string = LEARNING_PLANE_CLIENT_COMPAT.learningPlaneClientVersion;
  let contractsVersion: string = LEARNING_PLANE_CLIENT_COMPAT.learningPlaneContractsVersion;
  let apiCompat: string =
    LEARNING_PLANE_CLIENT_COMPAT.learningPlaneApiCompat || API_COMPAT_VERSION;
  let envelopeVersion = "1.0";
  let releasedWorkflowFeedbackPayloadVersions: Record<string, string> =
    LEARNING_PLANE_CLIENT_COMPAT.releasedWorkflowFeedbackPayloadVersions
      ? { ...LEARNING_PLANE_CLIENT_COMPAT.releasedWorkflowFeedbackPayloadVersions }
      : {};
  let buildCommitOrSourceRevision: string | null = null;

  try {
    const raw = readFileSync(
      join(repoRoot, "vendor", "learning-plane", "COMPATIBILITY_MANIFEST.json"),
      "utf8"
    );
    const manifest = JSON.parse(raw) as BundleManifest;
    clientVersion = manifest.learningPlaneClientVersion ?? clientVersion;
    contractsVersion = manifest.learningPlaneContractsVersion ?? contractsVersion;
    apiCompat = manifest.learningPlaneApiCompat ?? apiCompat;
    clientSha = manifest.artifacts?.client?.packageSha256 ?? null;
    contractsSha = manifest.artifacts?.contracts?.packageSha256 ?? null;
    envelopeVersion = manifest.supportedEnvelopeVersions?.[0] ?? envelopeVersion;
    releasedWorkflowFeedbackPayloadVersions =
      manifest.releasedWorkflowFeedbackPayloadVersions ??
      releasedWorkflowFeedbackPayloadVersions;
    buildCommitOrSourceRevision = manifest.buildCommitOrSourceRevision ?? null;
  } catch {
    /* manifest optional at runtime; identity still comes from installed packages */
  }

  if (clientVersion !== "0.8.0" || contractsVersion !== "0.8.0") {
    throw new Error(
      `Malformed Learning Plane package identity: expected 0.8.0, got client=${clientVersion} contracts=${contractsVersion}`
    );
  }

  return {
    clientVersion,
    contractsVersion,
    apiCompat,
    envelopeVersion,
    releasedWorkflowFeedbackPayloadVersions,
    packageChecksum: {
      client: clientSha,
      contracts: contractsSha
    },
    buildCommitOrSourceRevision
  };
}
