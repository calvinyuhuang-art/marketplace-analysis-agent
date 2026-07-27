export type PollOptions = {
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export async function pollUntil<T>(
  tick: () => Promise<{ value: T; done: boolean }>,
  opts: PollOptions = {}
): Promise<T> {
  const intervalMs = opts.intervalMs ?? 200;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const start = Date.now();
  let last: T | undefined;

  while (Date.now() - start < timeoutMs) {
    if (opts.signal?.aborted) {
      throw new Error("Polling aborted");
    }
    const result = await tick();
    last = result.value;
    if (result.done) return result.value;
    await sleep(intervalMs, opts.signal);
  }

  throw new Error(
    `Polling timed out after ${timeoutMs}ms` +
      (last !== undefined ? ` (last value available)` : "")
  );
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("Polling aborted"));
      return;
    }
    const t = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("Polling aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
