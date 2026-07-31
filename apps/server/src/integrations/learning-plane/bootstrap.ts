import type { LearningPlaneRegistrationService } from "./registrationService.js";
import type { BootstrapRequest } from "./contracts.js";

/** Bounded bootstrap entry used by HTTP and CLI. Operator token is never retained. */
export async function bootstrapLearningPlaneAdapter(
  registration: LearningPlaneRegistrationService,
  request: BootstrapRequest
): Promise<{
  agentId: string;
  credentialId: string;
  callbackKeyId: string;
  capabilities: string[];
}> {
  return registration.bootstrap(request.operatorToken, request.learningPlaneBaseUrl);
}
