import type { LearningPlaneSecretFile } from "./contracts.js";

export function callbackVerifyOptions(secret: LearningPlaneSecretFile) {
  const additional: string[] = [];
  const allowedKeyIds = new Set<string>([
    secret.callbackKeyId,
    ...(secret.acceptedCallbackKeyIds ?? [])
  ]);
  if (secret.previousCallbackVerificationSecret) {
    additional.push(secret.previousCallbackVerificationSecret);
  }
  if (secret.previousCallbackKeyId) allowedKeyIds.add(secret.previousCallbackKeyId);
  return {
    verificationSecret: secret.callbackVerificationSecret,
    additionalVerificationSecrets: additional.length ? additional : undefined,
    allowedKeyIds: [...allowedKeyIds]
  };
}
