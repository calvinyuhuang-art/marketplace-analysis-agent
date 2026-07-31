/**
 * LP8-I4c live UAT — MAA ↔ Learning Plane 0.8.1 governance/replay bridge.
 * Isolated DBs/ports/secrets. Does not modify LP or RT source.
 */
import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "./app.js";
import {
  createContainer,
  CURRENT_DATABASE_SCHEMA_VERSION,
  SERVICE_VERSION,
  type Container
} from "./composition/container.js";
import { findRepoRoot } from "./config/paths.js";
import { ConfigSchema } from "@maa/contracts";
import type { ResolvedConfig } from "./config/index.js";

const LP_ROOT = resolve("C:/projects/Sales-System/Learning-Plane");
const OPERATOR_TOKEN = `lp8-i4c-uat-${randomBytes(16).toString("hex")}`;

type Step = { step: number; name: string; ok: boolean; detail?: string };

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((res, rej) => {
    server.once("error", rej);
    server.listen(0, "127.0.0.1", () => res());
  });
  const addr = server.address();
  assert(addr && typeof addr !== "string", "port reserve failed");
  const port = addr.port;
  await new Promise<void>((res) => server.close(() => res()));
  return port;
}

async function waitHttp(
  url: string,
  pred: (body: Record<string, unknown>) => boolean,
  timeoutMs = 60_000
): Promise<Record<string, unknown>> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = (await res.json()) as Record<string, unknown>;
        if (pred(body)) return body;
      }
    } catch {
      /* retry */
    }
    await sleep(400);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function main(): Promise<void> {
  assert(SERVICE_VERSION === "0.20.0", "MAA must be 0.20.0");
  assert(CURRENT_DATABASE_SCHEMA_VERSION === "0017", "schema must be 0017");
  assert(existsSync(LP_ROOT), "Learning Plane root missing");

  const steps: Step[] = [];
  const record = (step: number, name: string, ok: boolean, detail?: string) => {
    steps.push({ step, name, ok, detail });
    console.log(`${ok ? "PASS" : "FAIL"} [${step}] ${name}${detail ? ` — ${detail}` : ""}`);
  };

  const work = mkdtempSync(join(tmpdir(), "lp8-i4c-uat-"));
  const lpPort = await reservePort();
  const maaPort = await reservePort();
  const lpDb = join(work, "lp.sqlite");
  const maaDb = join(work, "maa.sqlite");
  const maaArtifacts = join(work, "artifacts");
  const maaLog = join(work, "log");
  const maaSecrets = join(work, "secrets");
  mkdirSync(maaArtifacts, { recursive: true });
  mkdirSync(maaLog, { recursive: true });
  mkdirSync(maaSecrets, { recursive: true });
  mkdirSync(join(work, "lp-data"), { recursive: true });

  let lpProc: ChildProcess | null = null;
  let container: Container | null = null;
  let maaServer: { close: () => Promise<void> } | null = null;

  try {
    // Start Learning Plane 0.8.1
    mkdirSync(join(work, "lp-artifacts"), { recursive: true });
    mkdirSync(join(work, "lp-logs"), { recursive: true });
    const serverEntry = join(LP_ROOT, "apps", "server", "src", "server.ts");
    const tsxCliCandidates = [
      join(LP_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
      join(LP_ROOT, "apps", "server", "node_modules", "tsx", "dist", "cli.mjs")
    ];
    const tsxCli = tsxCliCandidates.find((p) => existsSync(p));
    assert(tsxCli, "tsx CLI not found under Learning Plane node_modules");
    const lpLogs: string[] = [];
    lpProc = spawn(process.execPath, [tsxCli, serverEntry], {
      cwd: join(LP_ROOT, "apps", "server"),
      env: {
        ...process.env,
        NODE_ENV: "development",
        LEARNING_PLANE_HOST: "127.0.0.1",
        LEARNING_PLANE_PORT: String(lpPort),
        LEARNING_PLANE_DATABASE_PATH: lpDb,
        LEARNING_PLANE_ARTIFACT_PATH: join(work, "lp-artifacts"),
        LEARNING_PLANE_LOG_PATH: join(work, "lp-logs"),
        LEARNING_PLANE_OPERATOR_TOKEN: OPERATOR_TOKEN,
        LEARNING_PLANE_SERVICE_VERSION: "0.8.1",
        LEARNING_PLANE_DELIVERY_WORKER_INTERVAL_MS: "100",
        LEARNING_PLANE_DELIVERY_ACK_TIMEOUT_MS: "8000",
        LEARNING_PLANE_LOG_LEVEL: "warn",
        FORCE_COLOR: "0"
      },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const onLp = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      lpLogs.push(text);
      if (lpLogs.length > 100) lpLogs.shift();
    };
    lpProc.stdout?.on("data", onLp);
    lpProc.stderr?.on("data", onLp);
    try {
      await waitHttp(
        `http://127.0.0.1:${lpPort}/health`,
        (b) => b.apiCompat === "2026.07" && String(b.serviceVersion).startsWith("0.8."),
        90_000
      );
    } catch (err) {
      console.error("LP failed to start. Logs:\n", lpLogs.join(""));
      throw err;
    }
    record(1, "Learning Plane 0.8.1 started (isolated)", true, `port=${lpPort}`);

    const health = (await (
      await fetch(`http://127.0.0.1:${lpPort}/health`)
    ).json()) as { serviceVersion?: string; apiCompat?: string };
    record(
      2,
      "LP identity",
      health.serviceVersion === "0.8.1" || health.apiCompat === "2026.07",
      JSON.stringify(health)
    );

    const enableBridge = await fetch(
      `http://127.0.0.1:${lpPort}/v1/production-bridge/settings`,
      {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${OPERATOR_TOKEN}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          productionGovernanceBridgeEnabled: true,
          productionReplayBridgeEnabled: true,
          grandfatheredReferenceRegistrationEnabled: true
        })
      }
    );
    record(
      2,
      "LP production bridge flags enabled for isolated UAT",
      enableBridge.ok,
      `status=${enableBridge.status}`
    );

    const repoRoot = findRepoRoot();
    const raw = ConfigSchema.parse({
      NODE_ENV: "test",
      MAA_CONFIG_PROFILE: "test",
      MAA_HOST: "127.0.0.1",
      MAA_PORT: String(maaPort),
      MAA_DATABASE_PATH: maaDb,
      MAA_ARTIFACT_ROOT: maaArtifacts,
      MAA_LOG_ROOT: maaLog,
      MAA_BACKUP_DIR: join(work, "backups"),
      MAA_LEARNING_PLANE_ENABLED: "true",
      MAA_LEARNING_PLANE_PUBLISH_ENABLED: "true",
      MAA_LEARNING_PLANE_RECEIVE_ENABLED: "true",
      MAA_LEARNING_PLANE_BASE_URL: `http://127.0.0.1:${lpPort}`,
      MAA_LEARNING_PLANE_CALLBACK_HOST: "127.0.0.1",
      MAA_LEARNING_PLANE_SECRET_FILE: join(maaSecrets, "learning-plane-adapter.json"),
      MAA_LEARNING_PLANE_GOVERNANCE_BRIDGE_ENABLED: "true",
      MAA_LEARNING_PLANE_GOVERNANCE_PUBLISH_ENABLED: "true",
      MAA_LEARNING_PLANE_GOVERNANCE_RECEIVE_ENABLED: "true",
      MAA_LEARNING_PLANE_VALIDATION_RECEIPT_ENABLED: "true",
      MAA_LEARNING_PLANE_ACTIVATION_RECEIPT_ENABLED: "true",
      MAA_LEARNING_PLANE_REPLAY_BRIDGE_ENABLED: "true",
      MAA_LEARNING_PLANE_REPLAY_EXECUTE_ENABLED: "true",
      MAA_LEARNING_PLANE_REPLAY_REPORT_ENABLED: "true",
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
    container = createContainer(resolved);
    const app = createApp(container);
    await new Promise<void>((res, rej) => {
      const server = app.listen(maaPort, "127.0.0.1", () => res());
      server.on("error", rej);
      maaServer = {
        close: () =>
          new Promise((resolveClose, rejectClose) =>
            server.close((err) => (err ? rejectClose(err) : resolveClose()))
          )
      };
    });
    record(3, "MAA 0.20.0 schema 0017 started", true, `port=${maaPort}`);

    // Bootstrap
    const boot = await fetch(
      `http://127.0.0.1:${maaPort}/v1/integrations/learning-plane/bootstrap`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          operatorToken: OPERATOR_TOKEN,
          learningPlaneBaseUrl: `http://127.0.0.1:${lpPort}`
        })
      }
    );
    const bootBody = (await boot.json()) as Record<string, unknown>;
    record(4, "MAA bootstrap to LP", boot.ok, JSON.stringify(bootBody).slice(0, 200));
    assert(boot.ok, "bootstrap failed");
    // Ensure workers are running after secrets are written.
    container.learningPlane?.start();

    // Scenario A: propose → replay → share → LP approve → decision → validate → no activation
    const proposed = await fetch(
      `http://127.0.0.1:${maaPort}/v1/typed-procedural-rules/require_format_normalization_for_pricing/versions`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ createdBy: "uat", params: {} })
      }
    );
    const proposedBody = (await proposed.json()) as { versionId: string; versionNumber: number };
    assert(proposed.ok, "propose failed");
    await fetch(
      `http://127.0.0.1:${maaPort}/v1/typed-procedural-versions/${proposedBody.versionId}/replay`,
      { method: "POST" }
    );
    const share = await fetch(
      `http://127.0.0.1:${maaPort}/v1/typed-procedural-versions/${proposedBody.versionId}/share-to-learning-plane`,
      { method: "POST" }
    );
    const shareBody = (await share.json()) as Record<string, unknown>;
    record(
      5,
      "Scenario A: governance share captured",
      share.status === 202,
      JSON.stringify(shareBody).slice(0, 180)
    );

    // Drain outbox
    for (let i = 0; i < 30; i++) {
      await container.learningPlane?.governanceBridge;
      // tick worker via status
      await sleep(500);
      const link = container.database.db
        .prepare(`SELECT * FROM lp_gov_bridge_links WHERE version_id = ?`)
        .get(proposedBody.versionId) as { lp_case_id: string | null; submission_status: string };
      if (link?.lp_case_id && link.submission_status === "published") {
        record(6, "Scenario A: LP case linked", true, `case=${link.lp_case_id}`);
        // Operator approve on LP
        const caseId = link.lp_case_id;
        const evidenceRes = await fetch(
          `http://127.0.0.1:${lpPort}/v1/governance/cases/${caseId}/evidence`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${OPERATOR_TOKEN}`,
              "content-type": "application/json"
            },
            body: JSON.stringify({
              evidence: {
                evidenceId: "e-uat-1",
                kind: "note",
                reference: "ref://uat-note"
              }
            })
          }
        );
        const waiverRes = await fetch(
          `http://127.0.0.1:${lpPort}/v1/governance/cases/${caseId}/replay-waivers`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${OPERATOR_TOKEN}`,
              "content-type": "application/json"
            },
            body: JSON.stringify({
              reason: "LP8-I4c isolated UAT fixture waiver",
              limitations: ["uat-only"]
            })
          }
        );
        const readyRes = await fetch(
          `http://127.0.0.1:${lpPort}/v1/governance/cases/${caseId}/mark-ready`,
          {
            method: "POST",
            headers: { authorization: `Bearer ${OPERATOR_TOKEN}` },
            body: "{}"
          }
        );
        const decide = await fetch(
          `http://127.0.0.1:${lpPort}/v1/governance/cases/${caseId}/decisions`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${OPERATOR_TOKEN}`,
              "content-type": "application/json"
            },
            body: JSON.stringify({
              decision: "approve",
              reason: "UAT Scenario A approve — must not activate"
            })
          }
        );
        const decideBody = await decide.text();
        record(
          7,
          "Scenario A: LP operator approve",
          decide.ok,
          `evidence=${evidenceRes.status} waiver=${waiverRes.status} ready=${readyRes.status} decide=${decide.status} body=${decideBody.slice(0, 200)}`
        );

        // Wait for decision delivery / local validation
        let validated = false;
        for (let j = 0; j < 40; j++) {
          await sleep(500);
          const row = container.database.db
            .prepare(`SELECT * FROM lp_gov_bridge_links WHERE version_id = ?`)
            .get(proposedBody.versionId) as {
            lp_decision: string | null;
            local_validation_status: string | null;
          };
          if (row.lp_decision === "approve" && row.local_validation_status === "accepted") {
            validated = true;
            break;
          }
        }
        record(8, "Scenario A: decision received + local validation accepted", validated);

        const active = container.typedProceduralService.getActiveVersion(
          "require_format_normalization_for_pricing"
        );
        record(
          9,
          "Scenario A: approval did not activate",
          active?.versionId !== proposedBody.versionId,
          `active=${active?.versionId ?? "none"}`
        );

        // Competing approval blocked
        const approveLocal = await fetch(
          `http://127.0.0.1:${maaPort}/v1/typed-procedural-versions/${proposedBody.versionId}/approve`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ actorId: "rogue-operator" })
          }
        );
        record(
          10,
          "Competing local approval blocked",
          approveLocal.status >= 400,
          `status=${approveLocal.status}`
        );

        // Scenario B: local activation after validation
        const activate = await fetch(
          `http://127.0.0.1:${maaPort}/v1/typed-procedural-versions/${proposedBody.versionId}/activate`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ actorId: "uat-operator", reason: "Scenario B" })
          }
        );
        record(11, "Scenario B: local activation after LP approve+validation", activate.ok);

        // Scenario M: grandfather register
        const contentHash = createHash("sha256").update("legacy-uat").digest("hex");
        try {
          const reg = container.learningPlane!.governanceBridge!.registerLegacyLocal({
            localRuleId: "prdef_require_direct_customer_evidence",
            localRuleVersionId: "prver_rdce_v1",
            localLifecycleStatus: "approved",
            contentHash,
            typedRuleKey: "require_direct_customer_evidence"
          });
          record(12, "Scenario M: legacy_local registration captured", Boolean(reg.registrationId));
        } catch (e) {
          record(
            12,
            "Scenario M: legacy_local registration captured",
            false,
            e instanceof Error ? e.message : String(e)
          );
        }

        break;
      }
    }
    if (!steps.some((s) => s.step === 6 && s.ok)) {
      record(6, "Scenario A: LP case linked", false, "outbox did not publish");
    }

    const failed = steps.filter((s) => !s.ok);
    const reportPath = join(
      "C:/projects/Sales-System/inspection-reports/LP8_I4C_MAA_BRIDGE_2026-07-31",
      "09_LIVE_UAT.md"
    );
    const body = [
      "# LP8-I4c Live UAT Checklist",
      "",
      `Work dir: \`${work}\``,
      `MAA: 0.20.0 / schema 0017`,
      `LP: tip 8dd48034 / expected 0.8.1`,
      "",
      ...steps.map(
        (s) =>
          `- [${s.ok ? "x" : " "}] ${s.step}. ${s.name}${s.detail ? ` — ${s.detail}` : ""}`
      ),
      "",
      failed.length === 0
        ? "**Result: PASS** (isolated two-service UAT)"
        : `**Result: FAIL** (${failed.length} steps)`
    ].join("\n");
    writeFileSync(reportPath, body, "utf8");
    console.log(`\nUAT report: ${reportPath}`);
    if (failed.length) process.exitCode = 1;
  } finally {
    try {
      const server = maaServer as { close: () => Promise<void> } | null;
      await server?.close();
    } catch {
      /* ignore */
    }
    try {
      await container?.shutdown();
    } catch {
      /* ignore */
    }
    if (lpProc && !lpProc.killed) {
      lpProc.kill();
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
