export type FetchLike = typeof fetch;

export type MarketplaceAnalysisClientOptions = {
  baseUrl: string;
  timeoutMs?: number;
  /** Default correlation id for outbound calls when not overridden. */
  correlationId?: string;
  /** Optional API bearer / local token (M10 may require auth). */
  apiKey?: string;
  fetchImpl?: FetchLike;
};

export type RequestOptions = {
  correlationId?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
  /** Extra request headers (e.g. X-Maa-Allow-Deprecated). */
  headers?: Record<string, string>;
};

export async function httpJson<T>(
  opts: MarketplaceAnalysisClientOptions,
  method: string,
  path: string,
  body: unknown | undefined,
  requestOpts?: RequestOptions
): Promise<{ data: T; status: number; correlationId: string | null; headers: Headers }> {
  const base = opts.baseUrl.replace(/\/$/, "");
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    Accept: "application/json"
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const correlationId = requestOpts?.correlationId ?? opts.correlationId;
  if (correlationId) {
    headers["x-correlation-id"] = correlationId;
  }
  if (requestOpts?.idempotencyKey) {
    headers["idempotency-key"] = requestOpts.idempotencyKey;
  }
  if (opts.apiKey) {
    headers.Authorization = `Bearer ${opts.apiKey}`;
  }
  if (requestOpts?.headers) {
    for (const [k, v] of Object.entries(requestOpts.headers)) {
      headers[k] = v;
    }
  }

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (requestOpts?.signal) {
    if (requestOpts.signal.aborted) controller.abort();
    else requestOpts.signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error("fetch is not available; pass fetchImpl in client options");
    }
    const res = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = { message: text };
      }
    }
    const fromBody =
      json && typeof json === "object" && "correlationId" in json
        ? String((json as { correlationId?: unknown }).correlationId ?? "")
        : "";
    const responseCorrelation =
      res.headers.get("x-correlation-id") ?? (fromBody || null);

    return {
      data: json as T,
      status: res.status,
      correlationId: responseCorrelation || correlationId || null,
      headers: res.headers
    };
  } finally {
    clearTimeout(timer);
    requestOpts?.signal?.removeEventListener("abort", onAbort);
  }
}
