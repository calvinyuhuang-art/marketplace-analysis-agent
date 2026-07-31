/** Client compatibility expectations for Marketplace Analysis Agent. */
export const MAA_API_COMPAT_LABEL = "2026.07" as const;

/**
 * Minimum server version recommended for the current `@maa/client` surface
 * after N7 (public removal of `propose_memory_update`, comparative analysis,
 * outcomes, typed procedural, evidence plans, workflow feedback).
 */
export const MIN_SERVER_VERSION = "0.17.0" as const;

/**
 * `propose_memory_update` is removed from the public OperationType allowlist.
 * Use `POST /v1/memory-proposals` instead. Clients must not send this operation.
 */
export const REMOVED_PUBLIC_OPERATIONS = ["propose_memory_update"] as const;
