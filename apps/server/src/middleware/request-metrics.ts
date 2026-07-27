import type { NextFunction, Request, Response } from "express";
import type { Container } from "../composition/container";

/** Rolling latency window for /metrics latencyMs snapshot. */
export class LatencyTracker {
  private readonly samples: number[] = [];
  private readonly maxSamples: number;

  constructor(maxSamples = 500) {
    this.maxSamples = maxSamples;
  }

  record(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > this.maxSamples) {
      this.samples.splice(0, this.samples.length - this.maxSamples);
    }
  }

  snapshot(): {
    count: number;
    avg: number;
    p50: number;
    p95: number;
    max: number;
  } {
    const n = this.samples.length;
    if (n === 0) {
      return { count: 0, avg: 0, p50: 0, p95: 0, max: 0 };
    }
    const sorted = [...this.samples].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    const pct = (p: number) => sorted[Math.min(n - 1, Math.floor((p / 100) * n))]!;
    return {
      count: n,
      avg: sum / n,
      p50: pct(50),
      p95: pct(95),
      max: sorted[n - 1]!
    };
  }
}

export function requestMetricsMiddleware(container: Container) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = performance.now();
    res.on("finish", () => {
      const ms = performance.now() - start;
      container.latency.record(ms);
      container.metrics.increment("http_requests_total");
      container.metrics.increment(`http_status_${res.statusCode}`);
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
      if (route) {
        container.metrics.increment(`http_path_${sanitizeMetricName(route)}`);
      }
      container.metrics.increment("http_duration_ms_sum", Math.round(ms));
    });
    next();
  };
}

function sanitizeMetricName(path: string): string {
  return path.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 80) || "unknown";
}
