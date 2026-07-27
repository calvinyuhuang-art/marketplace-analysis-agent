import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CapabilitiesResponseSchema,
  ConfigSchema,
  HealthResponseSchema,
  MetricsResponseSchema,
  mergeConfigEnv
} from "@maa/contracts";
import { createApp } from "./app";
import type { ResolvedConfig } from "./config/index";
import { findRepoRoot } from "./config/paths";
import { type Container, createContainer, SERVICE_VERSION } from "./composition/container";

describe("M10 hardening", () => {
  describe("config profiles", () => {
    it("applies local-hardened defaults including require api key", () => {
      const merged = mergeConfigEnv({
        MAA_CONFIG_PROFILE: "local-hardened",
        MAA_API_KEY: "test-secret-key"
      });
      const cfg = ConfigSchema.parse(merged);
      expect(cfg.MAA_CONFIG_PROFILE).toBe("local-hardened");
      expect(cfg.MAA_REQUIRE_API_KEY).toBe(true);
      expect(cfg.MAA_ARTIFACT_RETENTION_DAYS).toBe(30);
    });
  });

  describe("local API auth", () => {
    let container: Container;
    let app: Express;
    let artifactRoot: string;
    let logRoot: string;
    const apiKey = "m10-test-api-key";

    beforeAll(() => {
      const repoRoot = findRepoRoot();
      artifactRoot = mkdtempSync(join(tmpdir(), "maa-m10-art-"));
      logRoot = mkdtempSync(join(tmpdir(), "maa-m10-log-"));
      const config: ResolvedConfig = {
        raw: ConfigSchema.parse({
          NODE_ENV: "test",
          MAA_API_KEY: apiKey,
          MAA_WORKER_POLL_MS: "20",
          MAA_FAKE_PHASE_DELAY_MS: "5"
        }),
        repoRoot,
        databasePath: join(artifactRoot, "maa.sqlite"),
        artifactRoot,
        logRoot,
        backupDir: join(artifactRoot, "backups"),
        migrationsDir: resolve(repoRoot, "migrations")
      };
      container = createContainer(config, { startWorker: false });
      app = createApp(container);
    });

    afterAll(async () => {
      await container.shutdown();
      rmSync(artifactRoot, { recursive: true, force: true });
      rmSync(logRoot, { recursive: true, force: true });
    });

    it("keeps health/ready public and rejects unauthenticated /v1", async () => {
      expect((await request(app).get("/health")).status).toBe(200);
      expect((await request(app).get("/ready")).status).toBe(200);
      const denied = await request(app).get("/v1/capabilities");
      expect(denied.status).toBe(401);
      expect(denied.body.error.code).toBe("UNAUTHORIZED");
    });

    it("accepts Bearer and x-api-key", async () => {
      const bearer = await request(app)
        .get("/v1/capabilities")
        .set("Authorization", `Bearer ${apiKey}`);
      expect(bearer.status).toBe(200);
      CapabilitiesResponseSchema.parse(bearer.body);

      const header = await request(app).get("/v1/capabilities").set("x-api-key", apiKey);
      expect(header.status).toBe(200);
    });

    it("runs integrity and backup admin endpoints", async () => {
      const integrity = await request(app)
        .get("/v1/admin/integrity")
        .set("x-api-key", apiKey);
      expect(integrity.status).toBe(200);
      expect(integrity.body.ok).toBe(true);

      const backup = await request(app)
        .post("/v1/admin/backup")
        .set("x-api-key", apiKey)
        .send({ includeArtifacts: false });
      expect(backup.status).toBe(201);
      expect(backup.body.manifest.schemaVersion).toBe("maa-backup.v1");

      const list = await request(app).get("/v1/admin/backups").set("x-api-key", apiKey);
      expect(list.status).toBe(200);
      expect(list.body.backups.length).toBeGreaterThan(0);
    });

    it("expands metrics with latency and auth counters", async () => {
      await request(app).get("/v1/capabilities").set("x-api-key", apiKey);
      const metrics = await request(app).get("/metrics").set("x-api-key", apiKey);
      expect(metrics.status).toBe(200);
      const body = MetricsResponseSchema.parse(metrics.body);
      expect(body.version).toBe(SERVICE_VERSION);
      expect(body.authRequired).toBe(true);
      expect(body.latencyMs?.count).toBeGreaterThan(0);
      expect(body.counters.http_requests_total).toBeGreaterThan(0);
    });
  });

  describe("API compatibility shapes", () => {
    let container: Container;
    let app: Express;
    let artifactRoot: string;
    let logRoot: string;

    beforeAll(() => {
      const repoRoot = findRepoRoot();
      artifactRoot = mkdtempSync(join(tmpdir(), "maa-m10c-art-"));
      logRoot = mkdtempSync(join(tmpdir(), "maa-m10c-log-"));
      const config: ResolvedConfig = {
        raw: ConfigSchema.parse({ NODE_ENV: "test" }),
        repoRoot,
        databasePath: ":memory:",
        artifactRoot,
        logRoot,
        backupDir: join(artifactRoot, "backups"),
        migrationsDir: resolve(repoRoot, "migrations")
      };
      container = createContainer(config, { startWorker: false });
      app = createApp(container);
    });

    afterAll(async () => {
      await container.shutdown();
      rmSync(artifactRoot, { recursive: true, force: true });
      rmSync(logRoot, { recursive: true, force: true });
    });

    it("keeps health and metrics contracts stable", async () => {
      const health = await request(app).get("/health");
      HealthResponseSchema.parse(health.body);
      const metrics = await request(app).get("/metrics");
      MetricsResponseSchema.parse(metrics.body);
    });
  });

  describe("retention dry-run via admin", () => {
    it("reports purge without deleting when dryRun default", async () => {
      const repoRoot = findRepoRoot();
      const artifactRoot = mkdtempSync(join(tmpdir(), "maa-m10r-art-"));
      const logRoot = mkdtempSync(join(tmpdir(), "maa-m10r-log-"));
      writeFileSync(join(artifactRoot, "keep.bin"), "x");
      const config: ResolvedConfig = {
        raw: ConfigSchema.parse({
          NODE_ENV: "test",
          MAA_ARTIFACT_RETENTION_DAYS: "30"
        }),
        repoRoot,
        databasePath: ":memory:",
        artifactRoot,
        logRoot,
        backupDir: join(artifactRoot, "backups"),
        migrationsDir: resolve(repoRoot, "migrations")
      };
      const container = createContainer(config, { startWorker: false });
      const app = createApp(container);
      try {
        const res = await request(app).post("/v1/admin/retention/purge").send({});
        expect(res.status).toBe(200);
        expect(res.body.dryRun).toBe(true);
      } finally {
        await container.shutdown();
        rmSync(artifactRoot, { recursive: true, force: true });
        rmSync(logRoot, { recursive: true, force: true });
      }
    });
  });
});
