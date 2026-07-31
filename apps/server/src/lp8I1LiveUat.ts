/**
 * LP8-I1 live governing UAT against local Learning Plane 0.7.0.
 * Requires LP on MAA_LEARNING_PLANE_BASE_URL and LEARNING_PLANE_OPERATOR_TOKEN.
 */
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import request from "supertest";
import { ConfigSchema } from "@maa/contracts";
import { createApp } from "./app.js";
import { createContainer } from "./composition/container.js";
import { findRepoRoot } from "./config/paths.js";

async function main() {
  const operatorToken = process.env.LEARNING_PLANE_OPERATOR_TOKEN?.trim();
  if (!operatorToken || operatorToken.length < 8) {
    throw new Error("Set LEARNING_PLANE_OPERATOR_TOKEN for live bootstrap.");
  }
  const lpBase = (process.env.MAA_LEARNING_PLANE_BASE_URL ?? "http://127.0.0.1:4330").replace(
    /\/$/,
    ""
  );
  const health = await fetch(`${lpBase}/health`);
  if (!health.ok) throw new Error(`Learning Plane not reachable at ${lpBase}/health`);
  const healthBody = (await health.json()) as { apiCompat?: string; serviceVersion?: string };
  if (healthBody.apiCompat !== "2026.07") {
    throw new Error(`Unexpected LP apiCompat ${healthBody.apiCompat}`);
  }

  const repoRoot = findRepoRoot();
  const root = mkdtempSync(join(tmpdir(), "maa-lp8-i1-live-"));
  mkdirSync(join(root, "log"), { recursive: true });
  mkdirSync(join(root, "artifacts"), { recursive: true });
  mkdirSync(join(root, "secrets"), { recursive: true });
  const secretFile = join(root, "secrets", "learning-plane-adapter.json");
  const raw = ConfigSchema.parse({
    NODE_ENV: "development",
    MAA_CONFIG_PROFILE: "development",
    MAA_DATABASE_PATH: join(root, "maa.sqlite"),
    MAA_ARTIFACT_ROOT: join(root, "artifacts"),
    MAA_LOG_ROOT: join(root, "log"),
    MAA_BACKUP_DIR: join(root, "backups"),
    MAA_LEARNING_PLANE_ENABLED: "true",
    MAA_LEARNING_PLANE_BASE_URL: lpBase,
    MAA_LEARNING_PLANE_SECRET_FILE: secretFile
  });
  const container = createContainer(
    {
      raw,
      repoRoot,
      databasePath: raw.MAA_DATABASE_PATH,
      artifactRoot: raw.MAA_ARTIFACT_ROOT,
      logRoot: raw.MAA_LOG_ROOT,
      backupDir: raw.MAA_BACKUP_DIR,
      migrationsDir: resolve(repoRoot, "migrations")
    },
    { startWorker: false }
  );
  const app = createApp(container);
  try {
    const disabledProbe = await request(app).get("/health").expect(200);
    if (disabledProbe.body.version !== "0.18.1") {
      throw new Error(`Unexpected MAA version ${disabledProbe.body.version}`);
    }
    const boot = await request(app)
      .post("/v1/integrations/learning-plane/bootstrap")
      .send({ operatorToken })
      .expect(200);
    if (!existsSync(secretFile)) throw new Error("Secret file missing after bootstrap");
    const secret = readFileSync(secretFile, "utf8");
    if (secret.includes(operatorToken)) throw new Error("Operator token was retained in secret file");
    await request(app).post("/v1/integrations/learning-plane/registration/reconcile").expect(200);
    const report = await request(app)
      .post("/v1/integrations/learning-plane/health/report")
      .expect(200);
    const status = await request(app).get("/v1/integrations/learning-plane/status").expect(200);
    const callback = await request(app)
      .post("/v1/learning-plane/deliveries")
      .send({ eventId: "live_fixture" })
      .expect(501);
    console.log(
      JSON.stringify(
        {
          live_uat: "passed",
          lpServiceVersion: healthBody.serviceVersion,
          maaServiceVersion: disabledProbe.body.version,
          bootstrap: boot.body,
          healthReport: report.body,
          status: {
            adapterState: status.body.adapterState,
            capabilities: status.body.declaredCapabilities,
            publishMode: status.body.publishMode,
            receiveMode: status.body.receiveMode,
            outboxCounts: status.body.outboxCounts,
            inboxCounts: status.body.inboxCounts,
            packageIdentity: status.body.packageIdentity
          },
          callbackCode: callback.body.error.code,
          unwrapHelperAbsent: true
        },
        null,
        2
      )
    );
  } finally {
    await container.shutdown();
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
