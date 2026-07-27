/**
 * Keys that must never appear in logs, matched case-insensitively as a
 * substring of the field name. This protects secrets even if a payload is
 * accidentally passed to a logger.
 */
export const DEFAULT_SENSITIVE_KEYS: readonly string[] = [
  "authorization",
  "cookie",
  "set-cookie",
  "password",
  "passwd",
  "secret",
  "token",
  "apikey",
  "api_key",
  "api-key",
  "deepseek_api_key",
  "maa_api_key",
  "credential",
  "x-api-key"
];

export const REDACTED = "[REDACTED]";

export interface RedactOptions {
  sensitiveKeys?: readonly string[];
  maxDepth?: number;
}

function isSensitiveKey(key: string, sensitive: readonly string[]): boolean {
  const lower = key.toLowerCase();
  return sensitive.some((s) => lower.includes(s));
}

/**
 * Returns a deep copy with sensitive fields replaced by a redaction marker.
 * Non-plain values (Buffers, functions) are summarized rather than serialized.
 */
export function redact(value: unknown, options: RedactOptions = {}): unknown {
  const sensitive = options.sensitiveKeys ?? DEFAULT_SENSITIVE_KEYS;
  const maxDepth = options.maxDepth ?? 8;

  const seen = new WeakSet<object>();

  const walk = (input: unknown, depth: number): unknown => {
    if (input === null || typeof input !== "object") return input;
    if (depth >= maxDepth) return "[Truncated]";
    if (input instanceof Error) {
      return { name: input.name, message: input.message, stack: input.stack };
    }
    if (Buffer.isBuffer(input)) return `[Buffer ${input.length}B]`;
    if (seen.has(input)) return "[Circular]";
    seen.add(input);

    if (Array.isArray(input)) {
      return input.map((item) => walk(item, depth + 1));
    }

    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(input as Record<string, unknown>)) {
      out[key] = isSensitiveKey(key, sensitive) ? REDACTED : walk(val, depth + 1);
    }
    return out;
  };

  return walk(value, 0);
}
