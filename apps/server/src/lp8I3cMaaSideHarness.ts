/**
 * LP8-I3c-a UAT-only MAA side process.
 *
 * Starts a real MAA 0.19.1 instance with Learning Plane adapter workers and exposes a
 * loopback control API so the Research Team orchestrator can trigger late-gap detection
 * and revision/evaluation without modifying production routes.
 *
 * Not a production surface. Do not register these paths in createApp().
 */
import { createServer } from "node:http";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { ConfigSchema } from "@maa/contracts";
import { createApp } from "./app.js";
import {
  createContainer,
  CURRENT_DATABASE_SCHEMA_VERSION,
  SERVICE_VERSION,
  type Container
} from "./composition/container.js";
import { findRepoRoot } from "./config/paths.js";
import type { ResolvedConfig } from "./config/index.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env ${name}`);
  return value;
}

function makeEvidence(subjectId: string) {
  const now = new Date().toISOString();
  return [
    {
      evidenceId: `ei_${subjectId}`,
      sourceType: "listing" as const,
      platform: "amazon",
      marketplace: "US",
      subjectId,
      fields: { price: 11.99 },
      confidence: 0.9,
      provenance: {
        collector: "lp8-i3c-cross-service-uat",
        collectorVersion: SERVICE_VERSION,
        observedAt: now
      },
      validationStatus: "valid" as const
    }
  ];
}

function outboxRow(container: Container, workflowFeedbackId: string, eventType: string) {
  return container.database.db
    .prepare(
      `SELECT * FROM lp_adapter_outbox WHERE workflow_feedback_id=? AND event_type=? ORDER BY created_at DESC LIMIT 1`
    )
    .get(workflowFeedbackId, eventType) as Record<string, unknown> | undefined;
}

function inboxByEvent(container: Container, eventId: string) {
  return container.database.db
    .prepare(`SELECT * FROM lp_adapter_inbox WHERE event_id=?`)
    .get(eventId) as Record<string, unknown> | undefined;
}

async function main() {
  if (SERVICE_VERSION !== "0.19.1") {
    throw new Error(`Expected MAA SERVICE_VERSION 0.19.1, got ${SERVICE_VERSION}`);
  }
  if (CURRENT_DATABASE_SCHEMA_VERSION !== "0016") {
    throw new Error(`Expected schema 0016, got ${CURRENT_DATABASE_SCHEMA_VERSION}`);
  }

  const repoRoot = findRepoRoot();
  const root = required("MAA_UAT_ROOT");
  const lpBase = required("MAA_LEARNING_PLANE_BASE_URL");
  const maaPort = Number(required("MAA_PORT"));
  const controlPort = Number(required("MAA_UAT_CONTROL_PORT"));
  const operatorToken = required("LEARNING_PLANE_OPERATOR_TOKEN");

  mkdirSync(join(root, "log"), { recursive: true });
  mkdirSync(join(root, "artifacts"), { recursive: true });
  mkdirSync(join(root, "secrets"), { recursive: true });
  mkdirSync(join(root, "backups"), { recursive: true });

  const raw = ConfigSchema.parse({
    NODE_ENV: "development",
    MAA_CONFIG_PROFILE: "development",
    MAA_DATABASE_PATH: join(root, "maa.sqlite"),
    MAA_ARTIFACT_ROOT: join(root, "artifacts"),
    MAA_LOG_ROOT: join(root, "log"),
    MAA_BACKUP_DIR: join(root, "backups"),
    MAA_LEARNING_PLANE_ENABLED: "true",
    MAA_LEARNING_PLANE_PUBLISH_ENABLED: "true",
    MAA_LEARNING_PLANE_RECEIVE_ENABLED: "true",
    MAA_LEARNING_PLANE_BASE_URL: lpBase,
    MAA_LEARNING_PLANE_SECRET_FILE: join(root, "secrets", "lp.json"),
    MAA_LEARNING_PLANE_CALLBACK_HOST: "127.0.0.1",
    MAA_HOST: "127.0.0.1",
    MAA_PORT: String(maaPort)
  });
  const config: ResolvedConfig = {
    raw,
    repoRoot,
    databasePath: raw.MAA_DATABASE_PATH,
    artifactRoot: raw.MAA_ARTIFACT_ROOT,
    logRoot: raw.MAA_LOG_ROOT,
    backupDir: raw.MAA_BACKUP_DIR,
    migrationsDir: join(repoRoot, "migrations")
  };

  const container = createContainer(config, { startWorker: false });
  const app = createApp(container);
  const server = app.listen(maaPort, "127.0.0.1");
  await new Promise<void>((resolveListen, reject) => {
    server.once("listening", () => resolveListen());
    server.once("error", reject);
  });
  const maaBase = `http://127.0.0.1:${maaPort}`;

  const bootstrap = await fetch(`${maaBase}/v1/integrations/learning-plane/bootstrap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ operatorToken, learningPlaneBaseUrl: lpBase })
  });
  if (!bootstrap.ok) {
    throw new Error(`MAA bootstrap failed ${bootstrap.status} ${await bootstrap.text()}`);
  }
  container.learningPlane!.start();
  const reconcile = await fetch(
    `${maaBase}/v1/integrations/learning-plane/registration/reconcile`,
    { method: "POST" }
  );
  if (!reconcile.ok) {
    throw new Error(`MAA reconcile failed ${reconcile.status}`);
  }

  const control = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        const send = (status: number, body: unknown) => {
          res.writeHead(status, { "content-type": "application/json" });
          res.end(JSON.stringify(body));
        };
        try {
          const url = new URL(req.url ?? "/", `http://127.0.0.1:${controlPort}`);
          const bodyText = Buffer.concat(chunks).toString("utf8");
          const body = bodyText ? JSON.parse(bodyText) : {};

          if (req.method === "GET" && url.pathname === "/health") {
            return send(200, {
              status: "ok",
              serviceVersion: SERVICE_VERSION,
              schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
              maaBase,
              secretFilePresent: existsSync(join(root, "secrets", "lp.json"))
            });
          }

          if (req.method === "POST" && url.pathname === "/uat/detect") {
            const feedback = container.workflowFeedbackService.detectLatePricingGaps({
              projectId: String(body.projectId),
              runId: String(body.runId),
              requestId: String(body.requestId),
              correlationId: body.correlationId ? String(body.correlationId) : undefined,
              externalWorkOrderId: body.workOrderId ? String(body.workOrderId) : undefined,
              operation: "analyze",
              capabilityVersion: "1.0.0",
              platform: "amazon",
              marketplace: "US",
              productType: "paperback",
              requestedAreas: ["pricing"],
              evidenceItems: makeEvidence(String(body.subjectId ?? `asin_${Date.now()}`))
            });
            if (!feedback) return send(409, { error: "detect returned null" });
            return send(200, feedback);
          }

          if (req.method === "GET" && url.pathname === "/uat/outbox") {
            const workflowFeedbackId = url.searchParams.get("workflowFeedbackId") ?? "";
            const eventType = url.searchParams.get("eventType") ?? "";
            return send(200, {
              row: outboxRow(container, workflowFeedbackId, eventType) ?? null
            });
          }

          if (req.method === "GET" && url.pathname === "/uat/inbox") {
            const eventId = url.searchParams.get("eventId") ?? "";
            return send(200, { row: inboxByEvent(container, eventId) ?? null });
          }

          if (req.method === "POST" && url.pathname === "/uat/attach-revision") {
            container.workflowFeedbackService.attachRevision({
              workflowFeedbackId: String(body.workflowFeedbackId),
              revisionRunId: String(body.revisionRunId)
            });
            return send(200, { status: "attached" });
          }

          if (req.method === "POST" && url.pathname === "/uat/complete-revision") {
            const evaluated = container.workflowFeedbackService.completeRevision({
              revisionRunId: String(body.revisionRunId),
              priorRunId: String(body.priorRunId),
              bindingPresentInSupplemental: Boolean(body.bindingPresentInSupplemental)
            });
            return send(200, { feedback: evaluated });
          }

          if (req.method === "POST" && url.pathname === "/uat/shutdown") {
            send(200, { status: "shutting_down" });
            setTimeout(async () => {
              await container.shutdown();
              server.close();
              control.close();
              process.exit(0);
            }, 50);
            return;
          }

          return send(404, { error: "not found" });
        } catch (error) {
          return send(500, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      })();
    });
  });

  await new Promise<void>((resolveListen, reject) => {
    control.once("error", reject);
    control.listen(controlPort, "127.0.0.1", () => resolveListen());
  });

  console.log(
    JSON.stringify({
      eventType: "lp8_i3c_maa_side_ready",
      maaBase,
      controlBase: `http://127.0.0.1:${controlPort}`,
      serviceVersion: SERVICE_VERSION,
      schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION
    })
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
