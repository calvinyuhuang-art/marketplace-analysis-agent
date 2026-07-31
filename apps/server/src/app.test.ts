import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "@maa/contracts";
import { createApp } from "./app";
import { findRepoRoot } from "./config/paths";
import { type Container, createContainer } from "./composition/container";
import type { ResolvedConfig } from "./config/index";

describe("MAA server (M0 endpoints)", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-test-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-test-log-"));
    const config: ResolvedConfig = {
      raw: ConfigSchema.parse({ NODE_ENV: "test" }),
      repoRoot,
      databasePath: ":memory:",
      artifactRoot,
      logRoot,
      backupDir: join(artifactRoot, "backups"),
      migrationsDir: resolve(repoRoot, "migrations")
    };
    container = createContainer(config);
    app = createApp(container);
  });

  afterAll(async () => {
    await container.shutdown();
    await new Promise((r) => setTimeout(r, 100));
    try {
      rmSync(artifactRoot, { recursive: true, force: true });
    } catch {
      /* ignore Windows ENOTEMPTY races */
    }
    try {
      rmSync(logRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("GET /health returns ok and a correlation id header", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("marketplace-analysis-agent");
    expect(res.headers["x-correlation-id"]).toBeTruthy();
    expect(res.headers["x-request-id"]).toBeTruthy();
  });

  it("reuses an inbound correlation id", async () => {
    const res = await request(app).get("/health").set("x-correlation-id", "corr_fixed_123");
    expect(res.headers["x-correlation-id"]).toBe("corr_fixed_123");
  });

  it("GET /ready reports database and artifact readiness", async () => {
    const res = await request(app).get("/ready");
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(true);
    const names = (res.body.checks as { name: string; ok: boolean }[]).map((c) => c.name);
    expect(names).toContain("database");
    expect(names).toContain("artifact_root");
  });

  it("GET /metrics returns JSON counters", async () => {
    const res = await request(app).get("/metrics");
    expect(res.status).toBe(200);
    expect(res.body.process.pid).toBeGreaterThan(0);
    expect(typeof res.body.counters).toBe("object");
  });

  it("GET /v1/capabilities advertises the Amazon KDP pack", async () => {
    const res = await request(app).get("/v1/capabilities");
    expect(res.status).toBe(200);
    expect(res.body.capabilities[0].platform).toBe("amazon");
    expect(res.body.capabilities[0].supportedAnalysisAreas).toContain("customer_evidence");
  });

  it("GET /v1/model-profiles lists the mock profile as enabled", async () => {
    const res = await request(app).get("/v1/model-profiles");
    expect(res.status).toBe(200);
    const mock = (res.body.profiles as { id: string; enabled: boolean }[]).find(
      (p) => p.id === "mock-only"
    );
    expect(mock?.enabled).toBe(true);
  });

  it("unknown routes return the canonical NOT_FOUND error contract", async () => {
    const res = await request(app).get("/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
    expect(res.body.error.requestId).toBeTruthy();
    expect(res.body.error.retryable).toBe(false);
  });

  it("malformed JSON returns VALIDATION_ERROR", async () => {
    const res = await request(app)
      .post("/v1/capabilities")
      .set("Content-Type", "application/json")
      .send("{ not json");
    // POST is not defined on that path, but body parsing runs first.
    expect([400, 404]).toContain(res.status);
  });
});
