/**
 * LP8-I4e MAA HTTP sidecar — isolated MAA 0.20.0 / schema 0017 with governance bridge.
 * Bootstraps to Learning Plane, starts workers, exposes a loopback UAT control port.
 * Not a production surface.
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
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

async function main(): Promise<void> {
  if (SERVICE_VERSION !== "0.21.0") {
    throw new Error(`MAA sidecar expects 0.20.0, got ${SERVICE_VERSION}`);
  }
  if (CURRENT_DATABASE_SCHEMA_VERSION !== "0018") {
    throw new Error(`MAA sidecar expects schema 0017, got ${CURRENT_DATABASE_SCHEMA_VERSION}`);
  }

  const root = required("MAA_UAT_ROOT");
  const lpBase = required("MAA_LEARNING_PLANE_BASE_URL");
  const maaPort = Number(required("MAA_PORT"));
  const controlPort = Number(required("MAA_UAT_CONTROL_PORT"));
  const operatorToken = required("LEARNING_PLANE_OPERATOR_TOKEN");
  const host = process.env.MAA_HOST ?? "127.0.0.1";

  mkdirSync(join(root, "log"), { recursive: true });
  mkdirSync(join(root, "artifacts"), { recursive: true });
  mkdirSync(join(root, "secrets"), { recursive: true });
  mkdirSync(join(root, "backups"), { recursive: true });

  const secretFile = join(root, "secrets", "learning-plane-adapter.json");
  const repoRoot = findRepoRoot();
  const raw = ConfigSchema.parse({
    NODE_ENV: process.env.NODE_ENV ?? "test",
    MAA_CONFIG_PROFILE: "test",
    MAA_HOST: host,
    MAA_PORT: String(maaPort),
    MAA_DATABASE_PATH: process.env.MAA_DATABASE_PATH ?? join(root, "maa.sqlite"),
    MAA_ARTIFACT_ROOT: process.env.MAA_ARTIFACT_ROOT ?? join(root, "artifacts"),
    MAA_LOG_ROOT: process.env.MAA_LOG_ROOT ?? join(root, "log"),
    MAA_BACKUP_DIR: process.env.MAA_BACKUP_DIR ?? join(root, "backups"),
    MAA_LEARNING_PLANE_ENABLED: "true",
    MAA_LEARNING_PLANE_PUBLISH_ENABLED: "true",
    MAA_LEARNING_PLANE_RECEIVE_ENABLED: "true",
    MAA_LEARNING_PLANE_BASE_URL: lpBase,
    MAA_LEARNING_PLANE_CALLBACK_HOST: "127.0.0.1",
    MAA_LEARNING_PLANE_SECRET_FILE: secretFile,
    MAA_LEARNING_PLANE_GOVERNANCE_BRIDGE_ENABLED: "true",
    MAA_LEARNING_PLANE_GOVERNANCE_PUBLISH_ENABLED: "true",
    MAA_LEARNING_PLANE_GOVERNANCE_RECEIVE_ENABLED: "true",
    MAA_LEARNING_PLANE_VALIDATION_RECEIPT_ENABLED: "true",
    MAA_LEARNING_PLANE_ACTIVATION_RECEIPT_ENABLED: "true",
    MAA_LEARNING_PLANE_REPLAY_BRIDGE_ENABLED:
      process.env.MAA_LEARNING_PLANE_REPLAY_BRIDGE_ENABLED ?? "true",
    MAA_LEARNING_PLANE_REPLAY_EXECUTE_ENABLED:
      process.env.MAA_LEARNING_PLANE_REPLAY_EXECUTE_ENABLED ?? "true",
    MAA_LEARNING_PLANE_REPLAY_REPORT_ENABLED:
      process.env.MAA_LEARNING_PLANE_REPLAY_REPORT_ENABLED ?? "true",
    MAA_LEARNING_PLANE_GRANDFATHER_REGISTER_ENABLED: "true"
  });

  const resolved: ResolvedConfig = {
    raw,
    repoRoot,
    databasePath: raw.MAA_DATABASE_PATH,
    artifactRoot: raw.MAA_ARTIFACT_ROOT,
    logRoot: raw.MAA_LOG_ROOT,
    backupDir: raw.MAA_BACKUP_DIR,
    migrationsDir: resolve(repoRoot, "migrations")
  };

  const container: Container = createContainer(resolved, { startWorker: false });
  const app = createApp(container);
  const server = app.listen(maaPort, host);
  await new Promise<void>((resolveListen, reject) => {
    server.once("listening", () => resolveListen());
    server.once("error", reject);
  });
  const maaBase = `http://${host}:${maaPort}`;

  const bootstrapNeeded = !existsSync(secretFile);
  if (bootstrapNeeded) {
    const bootstrap = await fetch(`${maaBase}/v1/integrations/learning-plane/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operatorToken, learningPlaneBaseUrl: lpBase })
    });
    if (!bootstrap.ok) {
      throw new Error(`MAA bootstrap failed ${bootstrap.status} ${await bootstrap.text()}`);
    }
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
          if (req.method === "GET" && url.pathname === "/health") {
            return send(200, {
              status: "ok",
              serviceVersion: SERVICE_VERSION,
              schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
              maaBase,
              databasePath: raw.MAA_DATABASE_PATH,
              secretFilePresent: existsSync(secretFile)
            });
          }
          if (req.method === "POST" && url.pathname === "/uat/restart-workers") {
            container.learningPlane!.start();
            return send(200, { restarted: true });
          }
          if (req.method === "GET" && url.pathname === "/uat/gov-link") {
            const versionId = url.searchParams.get("versionId");
            if (!versionId) return send(400, { error: "versionId required" });
            const row = container.database.db
              .prepare(`SELECT * FROM lp_gov_bridge_links WHERE version_id = ?`)
              .get(versionId);
            return send(200, { link: row ?? null });
          }
          if (req.method === "GET" && url.pathname === "/uat/sql-count") {
            const table = url.searchParams.get("table");
            const allowed = new Set([
              "lp_gov_bridge_links",
              "lp_gov_bridge_outbox",
              "lp_gov_bridge_inbox",
              "lp_legacy_local_registrations",
              "procedural_rule_activations",
              "lp_replay_bridge_runs"
            ]);
            if (!table || !allowed.has(table)) {
              return send(400, { error: "disallowed table" });
            }
            const row = container.database.db
              .prepare(`SELECT COUNT(*) AS c FROM ${table}`)
              .get() as { c: number };
            return send(200, { table, count: row.c });
          }
          if (req.method === "POST" && url.pathname === "/uat/replay/tick-execute") {
            const n = Number(url.searchParams.get("limit") ?? "5");
            // UAT force: run accepted jobs even when production execute flag is off.
            const executed =
              container.learningPlane?.governanceBridge?.executeAcceptedReplayJobs(
                Number.isFinite(n) ? n : 5,
                { force: true }
              ) ?? 0;
            return send(200, { executed, forced: true });
          }
          if (req.method === "GET" && url.pathname === "/uat/replay/runs") {
            const replayJobId = url.searchParams.get("replayJobId");
            const rows = replayJobId
              ? container.database.db
                  .prepare(`SELECT * FROM lp_replay_bridge_runs WHERE replay_job_id = ?`)
                  .all(replayJobId)
              : container.database.db
                  .prepare(
                    `SELECT * FROM lp_replay_bridge_runs ORDER BY created_at DESC LIMIT 50`
                  )
                  .all();
            return send(200, { runs: rows });
          }
          if (req.method === "GET" && url.pathname === "/uat/active-version") {
            const ruleKey = url.searchParams.get("ruleKey");
            if (!ruleKey) return send(400, { error: "ruleKey required" });
            const active = container.typedProceduralService.getActiveVersion(
              ruleKey as Parameters<typeof container.typedProceduralService.getActiveVersion>[0]
            );
            return send(200, { active: active ?? null });
          }
          if (req.method === "POST" && url.pathname === "/uat/legacy-register") {
            const bodyText = Buffer.concat(chunks).toString("utf8");
            const body = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
            const reg = container.learningPlane!.governanceBridge!.registerLegacyLocal({
              localRuleId: String(body.localRuleId),
              localRuleVersionId: String(body.localRuleVersionId),
              localLifecycleStatus: String(body.localLifecycleStatus ?? "approved"),
              contentHash: String(body.contentHash),
              typedRuleKey: body.typedRuleKey
                ? (String(body.typedRuleKey) as
                    | "require_direct_customer_evidence"
                    | "require_format_normalization_for_pricing"
                    | "reject_review_count_as_sales"
                    | "require_evidence_refs_on_findings"
                    | "warn_stale_evidence")
                : undefined
            });
            return send(200, reg);
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
    control.once("listening", () => resolveListen());
    control.once("error", reject);
    control.listen(controlPort, "127.0.0.1");
  });

  console.log(
    `I4E_MAA_READY ${JSON.stringify({
      host,
      port: maaPort,
      controlPort,
      maaBase,
      serviceVersion: SERVICE_VERSION,
      schema: CURRENT_DATABASE_SCHEMA_VERSION
    })}`
  );

  const shutdown = async () => {
    await new Promise<void>((resolveClose) => control.close(() => resolveClose()));
    await new Promise<void>((resolveClose, rejectClose) =>
      server.close((err) => (err ? rejectClose(err) : resolveClose()))
    );
    await container.shutdown();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown());
  process.on("SIGINT", () => void shutdown());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
