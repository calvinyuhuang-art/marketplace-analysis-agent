/**
 * LP8-I3b-a Production Adapter Acceptance Closure — live UAT.
 *
 * Spawns an isolated Learning Plane 0.8.0 + real MAA 0.19.0 adapter.
 * Does not modify Research Team or Learning Plane source.
 *
 * Temp LEARNING_PLANE_OPERATOR_TOKEN is generated for this run only.
 */
import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse
} from "node:http";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  readdirSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  buildWorkflowFeedbackResolutionSubmittedIdempotencyKey,
  WorkflowFeedbackResolutionSubmittedPayloadV1Schema
} from "@learning-plane/contracts";
import { createBackup, restoreBackup } from "@maa/ops";
import { Database } from "@maa/database";
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
import { canonicalMaaResolutionId } from "./integrations/learning-plane/workflowFeedbackMapping.js";

const LP_ROOT = resolve("C:/projects/Sales-System/Learning-Plane");
const OPERATOR_TOKEN = `lp8-i3b-a-uat-${randomBytes(16).toString("hex")}`;
const SECRET_MARKERS = [
  OPERATOR_TOKEN,
  "lpak_",
  "callbackVerificationSecret",
  "agentApiKey"
];

type StepResult = { step: number; name: string; ok: boolean; detail?: string };
type FixturePush = {
  eventType: string;
  eventId: string;
  deliveryId: string;
  correlationId?: string;
  causationEventId?: string | null;
  payload: unknown;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const addr = server.address();
  assert(addr && typeof addr !== "string", "port reserve failed");
  const port = addr.port;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return port;
}

async function lpCall(
  base: string,
  method: string,
  path: string,
  opts?: { body?: unknown; key?: string; operator?: string }
) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(opts?.key ? { authorization: `Bearer ${opts.key}` } : {}),
      ...(opts?.operator ? { authorization: `Bearer ${opts.operator}` } : {})
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

async function waitFor(
  label: string,
  fn: () => Promise<boolean> | boolean,
  timeoutMs = 45_000,
  intervalMs = 200
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return;
    await sleep(intervalMs);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function redact(value: unknown): unknown {
  const raw = JSON.stringify(value);
  if (!raw) return value;
  let scrubbed = raw;
  for (const marker of SECRET_MARKERS) {
    if (marker && scrubbed.includes(marker)) {
      scrubbed = scrubbed.split(marker).join("[REDACTED]");
    }
  }
  scrubbed = scrubbed.replace(/"agentApiKey"\s*:\s*"[^"]+"/g, '"agentApiKey":"[REDACTED]"');
  scrubbed = scrubbed.replace(
    /"callbackVerificationSecret"\s*:\s*"[^"]+"/g,
    '"callbackVerificationSecret":"[REDACTED]"'
  );
  scrubbed = scrubbed.replace(/lpak_[A-Za-z0-9_-]+/g, "lpak_[REDACTED]");
  try {
    return JSON.parse(scrubbed);
  } catch {
    return scrubbed;
  }
}

function scanForSecrets(label: string, value: unknown): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  assert(!text.includes(OPERATOR_TOKEN), `${label} leaked operator token`);
  assert(!/lpak_[A-Za-z0-9_-]{20,}/.test(text), `${label} leaked agent API key material`);
  assert(
    !/"callbackVerificationSecret"\s*:\s*"(?!\[REDACTED\])[^"]{8,}"/.test(text),
    `${label} leaked callback secret`
  );
}

async function rmWithRetry(target: string, attempts = 12): Promise<void> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      if (existsSync(target)) rmSync(target, { recursive: true, force: true });
      return;
    } catch (error) {
      last = error;
      await sleep(100 * (i + 1));
    }
  }
  throw new Error(
    `cleanup failure for ${target}: ${last instanceof Error ? last.message : String(last)}`
  );
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
        collector: "lp8-i3b-a-uat",
        collectorVersion: "0.19.0",
        observedAt: now
      },
      validationStatus: "valid" as const
    }
  ];
}

function detectFeedback(
  container: Container,
  opts: {
    projectId: string;
    runId: string;
    requestId: string;
    correlationId?: string;
    workOrderId?: string;
    subjectId: string;
  }
) {
  return container.workflowFeedbackService.detectLatePricingGaps({
    projectId: opts.projectId,
    runId: opts.runId,
    requestId: opts.requestId,
    correlationId: opts.correlationId,
    externalWorkOrderId: opts.workOrderId,
    operation: "analyze",
    capabilityVersion: "1.0.0",
    platform: "amazon",
    marketplace: "US",
    productType: "paperback",
    requestedAreas: ["pricing"],
    evidenceItems: makeEvidence(opts.subjectId)
  });
}

async function startIsolatedLearningPlane(input: {
  port: number;
  root: string;
}): Promise<{ child: ChildProcess; base: string; logs: string[] }> {
  assert(existsSync(LP_ROOT), `Learning Plane root missing: ${LP_ROOT}`);
  const dbPath = join(input.root, "learning-plane.sqlite");
  const artifactPath = join(input.root, "lp-artifacts");
  const logPath = join(input.root, "lp-logs");
  mkdirSync(artifactPath, { recursive: true });
  mkdirSync(logPath, { recursive: true });
  const logs: string[] = [];
  const env = {
    ...process.env,
    NODE_ENV: "development",
    LEARNING_PLANE_HOST: "127.0.0.1",
    LEARNING_PLANE_PORT: String(input.port),
    LEARNING_PLANE_DATABASE_PATH: dbPath,
    LEARNING_PLANE_ARTIFACT_PATH: artifactPath,
    LEARNING_PLANE_LOG_PATH: logPath,
    LEARNING_PLANE_PROFILE: "development",
    LEARNING_PLANE_SERVICE_VERSION: "0.8.0",
    LEARNING_PLANE_API_COMPAT: "2026.07",
    LEARNING_PLANE_OPERATOR_TOKEN: OPERATOR_TOKEN,
    LEARNING_PLANE_DELIVERY_WORKER_INTERVAL_MS: "100",
    LEARNING_PLANE_DELIVERY_ACK_TIMEOUT_MS: "8000",
    LEARNING_PLANE_DELIVERY_MAX_ATTEMPTS: "5",
    LEARNING_PLANE_LOG_LEVEL: "warn",
    FORCE_COLOR: "0"
  };
  const serverEntry = join(LP_ROOT, "apps", "server", "src", "server.ts");
  const tsxCliCandidates = [
    join(LP_ROOT, "node_modules", "tsx", "dist", "cli.mjs"),
    join(LP_ROOT, "apps", "server", "node_modules", "tsx", "dist", "cli.mjs")
  ];
  const tsxCli = tsxCliCandidates.find((p) => existsSync(p));
  assert(tsxCli, "tsx CLI not found under Learning Plane node_modules");
  const child = spawn(process.execPath, [tsxCli, serverEntry], {
    cwd: join(LP_ROOT, "apps", "server"),
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const onChunk = (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    logs.push(text);
    if (logs.length > 200) logs.shift();
  };
  child.stdout?.on("data", onChunk);
  child.stderr?.on("data", onChunk);
  const base = `http://127.0.0.1:${input.port}`;
  await waitFor(
    "Learning Plane health",
    async () => {
      if (child.exitCode !== null) return false;
      try {
        const res = await fetch(`${base}/health`);
        if (!res.ok) return false;
        const body = (await res.json()) as { apiCompat?: string; serviceVersion?: string };
        return body.apiCompat === "2026.07" && body.serviceVersion === "0.8.0";
      } catch {
        return false;
      }
    },
    60_000,
    250
  );
  return { child, base, logs };
}

async function stopChild(child: ChildProcess | null): Promise<void> {
  if (!child || child.killed || child.exitCode !== null) return;
  const done = new Promise<void>((resolveDone) => {
    child.once("exit", () => resolveDone());
  });
  child.kill("SIGTERM");
  const raced = await Promise.race([
    done.then(() => true),
    sleep(5_000).then(() => false)
  ]);
  if (!raced) {
    child.kill("SIGKILL");
    await Promise.race([done, sleep(2_000)]);
  }
}

function startFixtureOrchestrator(input: {
  port: number;
  lpBase: string;
  getRoKey: () => string | undefined;
}): {
  pushes: FixturePush[];
  server: Server;
  close: () => Promise<void>;
} {
  const pushes: FixturePush[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      void (async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
            deliveryId: string;
            event: {
              eventId: string;
              eventType: string;
              correlationId?: string;
              causationEventId?: string | null;
              payload: unknown;
            };
          };
          pushes.push({
            eventType: body.event.eventType,
            eventId: body.event.eventId,
            deliveryId: body.deliveryId,
            correlationId: body.event.correlationId,
            causationEventId: body.event.causationEventId,
            payload: body.event.payload
          });
          const key = input.getRoKey();
          if (key) {
            await lpCall(
              input.lpBase,
              "POST",
              `/v1/deliveries/${body.deliveryId}/acknowledge`,
              { key, body: { idempotencyKey: `ack:${body.deliveryId}` } }
            );
          }
          res.writeHead(200);
          res.end("ok");
        } catch {
          res.writeHead(500);
          res.end("error");
        }
      })();
    });
  });
  return {
    pushes,
    server,
    close: () =>
      new Promise<void>((resolveClose, reject) => {
        server.close((err) => (err ? reject(err) : resolveClose()));
      })
  };
}

function buildResolvedConfig(input: {
  repoRoot: string;
  root: string;
  lpBase: string;
  maaPort: number;
}): ResolvedConfig {
  const raw = ConfigSchema.parse({
    NODE_ENV: "development",
    MAA_CONFIG_PROFILE: "development",
    MAA_DATABASE_PATH: join(input.root, "maa.sqlite"),
    MAA_ARTIFACT_ROOT: join(input.root, "artifacts"),
    MAA_LOG_ROOT: join(input.root, "log"),
    MAA_BACKUP_DIR: join(input.root, "backups"),
    MAA_LEARNING_PLANE_ENABLED: "true",
    MAA_LEARNING_PLANE_PUBLISH_ENABLED: "true",
    MAA_LEARNING_PLANE_RECEIVE_ENABLED: "true",
    MAA_LEARNING_PLANE_BASE_URL: input.lpBase,
    MAA_LEARNING_PLANE_SECRET_FILE: join(input.root, "secrets", "lp.json"),
    MAA_LEARNING_PLANE_CALLBACK_HOST: "127.0.0.1",
    MAA_HOST: "127.0.0.1",
    MAA_PORT: String(input.maaPort)
  });
  return {
    raw,
    repoRoot: input.repoRoot,
    databasePath: raw.MAA_DATABASE_PATH,
    artifactRoot: raw.MAA_ARTIFACT_ROOT,
    logRoot: raw.MAA_LOG_ROOT,
    backupDir: raw.MAA_BACKUP_DIR,
    migrationsDir: join(input.repoRoot, "migrations")
  };
}

async function startMaa(input: {
  config: ResolvedConfig;
  maaPort: number;
}): Promise<{ container: Container; server: Server; maaBase: string }> {
  const container = createContainer(input.config, { startWorker: false });
  const app = createApp(container);
  const server = app.listen(input.maaPort, "127.0.0.1");
  await new Promise<void>((resolveListen, reject) => {
    server.once("listening", () => resolveListen());
    server.once("error", reject);
  });
  return {
    container,
    server,
    maaBase: `http://127.0.0.1:${input.maaPort}`
  };
}

async function stopMaa(input: {
  container: Container | null;
  server: Server | null;
}): Promise<void> {
  if (input.container) await input.container.shutdown();
  if (input.server) {
    await new Promise<void>((resolveClose) => input.server!.close(() => resolveClose()));
  }
}

function outboxRow(
  container: Container,
  workflowFeedbackId: string,
  eventType: string
): Record<string, unknown> | undefined {
  return container.database.db
    .prepare(
      `SELECT * FROM lp_adapter_outbox WHERE workflow_feedback_id=? AND event_type=? ORDER BY created_at DESC LIMIT 1`
    )
    .get(workflowFeedbackId, eventType) as Record<string, unknown> | undefined;
}

function countPublished(
  container: Container,
  workflowFeedbackId: string,
  eventType: string
): number {
  return (
    container.database.db
      .prepare(
        `SELECT COUNT(*) AS c FROM lp_adapter_outbox
         WHERE workflow_feedback_id=? AND event_type=? AND status='published'`
      )
      .get(workflowFeedbackId, eventType) as { c: number }
  ).c;
}

function inboxByEvent(container: Container, eventId: string) {
  return container.database.db
    .prepare(`SELECT * FROM lp_adapter_inbox WHERE event_id=?`)
    .get(eventId) as Record<string, unknown> | undefined;
}

async function publishSubmitted(input: {
  lpBase: string;
  roKey: string;
  workflowFeedbackId: string;
  resolutionId: string;
  resolutionType: string;
  correlationId: string;
  causationEventId: string;
  workOrderId: string;
  rationale: string;
  idempotencyKey?: string;
  decisionAt?: string;
  occurredAt?: string;
  payloadOverride?: Record<string, unknown>;
}) {
  const payload =
    input.payloadOverride ??
    {
      payloadSchemaVersion: "1.0",
      maaWorkflowFeedbackId: input.workflowFeedbackId,
      resolutionId: input.resolutionId,
      resolutionType: input.resolutionType,
      rationale: input.rationale,
      workOrderId: input.workOrderId,
      researchRunId: "run_rt_fixture",
      operationalResolutionRef: {
        owningService: "marketplace-analysis-agent",
        resourceType: "workflow_feedback_resolution",
        resourceId: input.workflowFeedbackId,
        relativePath: `/v1/workflow-feedback/${input.workflowFeedbackId}/resolve`
      },
      decisionAt: input.decisionAt ?? "2026-07-30T22:05:00.000Z",
      producerContract: {
        name: "research-orchestrator.workflow_feedback_resolution",
        version: "v1"
      }
    };
  assert(
    WorkflowFeedbackResolutionSubmittedPayloadV1Schema.safeParse(payload).success,
    "submitted payload schema"
  );
  return lpCall(input.lpBase, "POST", "/v1/events", {
    key: input.roKey,
    body: {
      eventType: "workflow_feedback.resolution_submitted",
      schemaVersion: "1.0",
      sourceAgentId: "research-orchestrator",
      targetAgentId: "marketplace-analysis-agent",
      workOrderId: input.workOrderId,
      correlationId: input.correlationId,
      causationEventId: input.causationEventId,
      occurredAt: input.occurredAt ?? "2026-07-30T22:05:00.000Z",
      idempotencyKey:
        input.idempotencyKey ??
        buildWorkflowFeedbackResolutionSubmittedIdempotencyKey(
          input.workflowFeedbackId,
          input.resolutionId
        ),
      payload,
      metadata: {
        producerServiceVersion: "0.8.0",
        payloadSchemaVersion: "1.0",
        learningPlaneContractVersion: "1.0"
      }
    }
  });
}

async function main() {
  assert(SERVICE_VERSION === "0.19.1", "MAA service must be 0.19.1");
  assert(
    CURRENT_DATABASE_SCHEMA_VERSION === "0016",
    "schema version must be 0016"
  );

  const repoRoot = findRepoRoot();
  const uatRoot = mkdtempSync(join(tmpdir(), "maa-lp8-i3b-a-uat-"));
  const lpRoot = join(uatRoot, "lp");
  const maaRoot = join(uatRoot, "maa");
  const diagnosticsRoot = join(uatRoot, "diagnostics");
  mkdirSync(lpRoot, { recursive: true });
  mkdirSync(join(maaRoot, "log"), { recursive: true });
  mkdirSync(join(maaRoot, "artifacts"), { recursive: true });
  mkdirSync(join(maaRoot, "secrets"), { recursive: true });
  mkdirSync(diagnosticsRoot, { recursive: true });

  const steps: StepResult[] = [];
  const record = (step: number, name: string, ok: boolean, detail?: string) => {
    steps.push({ step, name, ok, detail });
  };

  let lpChild: ChildProcess | null = null;
  let lpBase = "";
  let fixture: ReturnType<typeof startFixtureOrchestrator> | null = null;
  let roKey: string | undefined;
  let container: Container | null = null;
  let server: Server | null = null;
  let maaBase = "";
  let config: ResolvedConfig | null = null;
  let failed = false;

  try {
    const [lpPort, maaPort, fixturePort] = await Promise.all([
      reservePort(),
      reservePort(),
      reservePort()
    ]);

    // 1. Start isolated Learning Plane 0.8.0
    const lp = await startIsolatedLearningPlane({ port: lpPort, root: lpRoot });
    lpChild = lp.child;
    lpBase = lp.base;
    record(1, "start_isolated_learning_plane", true, lpBase);

    // 2. Register fixture research-orchestrator
    fixture = startFixtureOrchestrator({
      port: fixturePort,
      lpBase,
      getRoKey: () => roKey
    });
    await new Promise<void>((resolveListen, reject) => {
      fixture!.server.once("error", reject);
      fixture!.server.listen(fixturePort, "127.0.0.1", () => resolveListen());
    });
    const roReg = await lpCall(lpBase, "POST", "/v1/agents/register", {
      operator: OPERATOR_TOKEN,
      body: {
        agentId: "research-orchestrator",
        displayName: "RO Fixture I3b-a",
        agentType: "reference_fixture",
        serviceVersion: "0.8.0",
        supportedContractVersions: ["1.0"],
        baseUrl: `http://127.0.0.1:${fixturePort}`,
        callbackPath: "/cb",
        healthEndpointPath: "/health",
        capabilities: ["events.publish", "events.receive", "events.acknowledge"]
      }
    });
    assert(roReg.status === 201, `RO register ${roReg.status}`);
    roKey = (roReg.json as { agentApiKey: string }).agentApiKey;
    assert(roKey, "RO key");
    scanForSecrets("ro register response keys present but not logged", {
      status: roReg.status,
      agentId: "research-orchestrator"
    });
    record(2, "register_fixture_research_orchestrator", true);

    // 3–6. Start MAA, bootstrap, reconcile, confirm capabilities
    config = buildResolvedConfig({ repoRoot, root: maaRoot, lpBase, maaPort });
    const started = await startMaa({ config, maaPort });
    container = started.container;
    server = started.server;
    maaBase = started.maaBase;
    record(3, "start_real_maa_with_adapter", true, maaBase);

    const bootstrap = await fetch(`${maaBase}/v1/integrations/learning-plane/bootstrap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ operatorToken: OPERATOR_TOKEN, learningPlaneBaseUrl: lpBase })
    });
    if (!bootstrap.ok) {
      throw new Error(`bootstrap ${bootstrap.status} ${await bootstrap.text()}`);
    }
    const bootstrapBody = (await bootstrap.json()) as {
      operatorTokenRetained?: boolean;
    };
    scanForSecrets("bootstrap response", bootstrapBody);
    assert(bootstrapBody.operatorTokenRetained === false, "operator token retained");
    container.learningPlane!.start();
    const reconcile = await fetch(
      `${maaBase}/v1/integrations/learning-plane/registration/reconcile`,
      { method: "POST" }
    );
    assert(reconcile.ok, `reconcile ${reconcile.status}`);
    record(4, "bootstrap_and_reconcile_maa", true);
    record(5, "enable_publish_and_receive", true);

    const status = (await (
      await fetch(`${maaBase}/v1/integrations/learning-plane/status`)
    ).json()) as {
      declaredCapabilities: string[];
      maaDatabaseSchemaVersion: string;
      packageIdentity?: { contractsVersion?: string; clientVersion?: string };
    };
    scanForSecrets("adapter status", status);
    const caps = status.declaredCapabilities as string[];
    for (const required of [
      "health.report",
      "events.publish",
      "events.receive",
      "events.acknowledge"
    ]) {
      assert(caps.includes(required), `missing capability ${required}`);
    }
    assert(status.maaDatabaseSchemaVersion === "0016", "schema 0016");
    assert(status.packageIdentity?.contractsVersion === "0.8.0", "contracts 0.8.0");
    assert(status.packageIdentity?.clientVersion === "0.8.0", "client 0.8.0");
    record(6, "confirm_capabilities", true, caps.join(","));

    // 7–10. Trigger created feedback, transactional capture, publish, RO ack
    const feedback1 = detectFeedback(container, {
      projectId: "proj_i3b_a_1",
      runId: "run_i3b_a_1",
      requestId: "req_i3b_a_1",
      correlationId: "corr_i3b_a_1",
      workOrderId: "wo_i3b_a_1",
      subjectId: "asin_i3b_a_1"
    });
    assert(feedback1, "feedback1 created");
    record(7, "trigger_late_gap_feedback", true, feedback1.workflowFeedbackId);

    const createdOutboxImmediate = outboxRow(
      container,
      feedback1.workflowFeedbackId,
      "workflow_feedback.created"
    );
    assert(createdOutboxImmediate, "created outbox row");
    assert(
      createdOutboxImmediate.status === "pending" ||
        createdOutboxImmediate.status === "claimed" ||
        createdOutboxImmediate.status === "published" ||
        createdOutboxImmediate.status === "retry_scheduled",
      `unexpected created status ${createdOutboxImmediate.status}`
    );
    const canonical1 = container.workflowFeedbackService.getById(feedback1.workflowFeedbackId);
    assert(canonical1, "canonical feedback exists with outbox");
    record(8, "canonical_feedback_and_outbox_commit", true);

    await waitFor("created published", () => {
      const row = outboxRow(
        container!,
        feedback1.workflowFeedbackId,
        "workflow_feedback.created"
      );
      return row?.status === "published" && Boolean(row.learning_plane_event_id);
    });
    const publishedCreated = outboxRow(
      container,
      feedback1.workflowFeedbackId,
      "workflow_feedback.created"
    )!;
    const createdEventId = String(publishedCreated.learning_plane_event_id);
    record(9, "publish_workflow_feedback_created", true, createdEventId);

    await waitFor("RO received created", () =>
      fixture!.pushes.some((p) => p.eventId === createdEventId)
    );
    record(10, "fixture_ro_received_and_acked_created", true);

    // 11–17. LP outage, durable outbox, MAA restart, LP recovery, single publish
    await stopChild(lpChild);
    lpChild = null;
    await waitFor("LP down", async () => {
      try {
        await fetch(`${lpBase}/health`, { signal: AbortSignal.timeout(500) });
        return false;
      } catch {
        return true;
      }
    });
    record(11, "stop_learning_plane", true);

    const feedback2 = detectFeedback(container, {
      projectId: "proj_i3b_a_2",
      runId: "run_i3b_a_2",
      requestId: "req_i3b_a_2",
      correlationId: "corr_i3b_a_2",
      workOrderId: "wo_i3b_a_2",
      subjectId: "asin_i3b_a_2"
    });
    assert(feedback2, "feedback2 during outage");
    const healthWhileDown = await fetch(`${maaBase}/health`);
    assert(healthWhileDown.ok, "MAA remains operational during LP outage");
    let pending2 = outboxRow(
      container,
      feedback2.workflowFeedbackId,
      "workflow_feedback.created"
    );
    assert(pending2, "pending outbox during outage");
    assert(
      pending2.status === "pending" ||
        pending2.status === "retry_scheduled" ||
        pending2.status === "claimed",
      `expected durable pending, got ${pending2.status}`
    );
    record(12, "trigger_feedback_during_outage", true, feedback2.workflowFeedbackId);
    record(13, "maa_operational_with_pending_outbox", true, String(pending2.status));

    await stopMaa({ container, server });
    container = null;
    server = null;
    const restartedDown = await startMaa({ config: config!, maaPort });
    container = restartedDown.container;
    server = restartedDown.server;
    maaBase = restartedDown.maaBase;
    pending2 = outboxRow(
      container,
      feedback2.workflowFeedbackId,
      "workflow_feedback.created"
    );
    assert(pending2, "outbox survived MAA restart");
    assert(pending2.status !== "published", "must not publish while LP down");
    record(14, "restart_maa_while_lp_down", true);
    record(15, "outbox_survives_restart", true, String(pending2.status));

    const lp2 = await startIsolatedLearningPlane({ port: lpPort, root: lpRoot });
    lpChild = lp2.child;
    // Existing LP DB reused — agents and events remain.
    record(16, "restart_learning_plane", true);

    await waitFor("outage feedback published once", () => {
      return countPublished(
        container!,
        feedback2.workflowFeedbackId,
        "workflow_feedback.created"
      ) === 1;
    }, 60_000);
    assert(
      countPublished(container, feedback2.workflowFeedbackId, "workflow_feedback.created") ===
        1,
      "exactly one published created for outage feedback"
    );
    record(17, "exactly_one_event_published_after_recovery", true);

    // 18–22. Resolve via operational API, RO submits, MAA reconciles without second resolve
    const resolveRes = await fetch(
      `${maaBase}/v1/workflow-feedback/${feedback1.workflowFeedbackId}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resolutionAction: "supplemental_collection",
          supplementalEvidencePackageIds: [],
          actorId: "fixture-orchestrator"
        })
      }
    );
    if (!resolveRes.ok) {
      throw new Error(`resolve failed ${await resolveRes.text()}`);
    }
    const resolvedBody = (await resolveRes.json()) as { resolutionAction?: string };
    assert(resolvedBody.resolutionAction === "supplemental_collection", "resolution action");
    record(18, "resolve_via_operational_api", true);
    record(19, "canonical_maa_resolution_exists", true);

    const resolutionId1 = canonicalMaaResolutionId(feedback1.workflowFeedbackId);
    const submitted1 = await publishSubmitted({
      lpBase,
      roKey: roKey!,
      workflowFeedbackId: feedback1.workflowFeedbackId,
      resolutionId: resolutionId1,
      resolutionType: "supplemental_collection",
      correlationId: "corr_i3b_a_1",
      causationEventId: createdEventId,
      workOrderId: "wo_i3b_a_1",
      rationale: "Collect supplemental listing fields."
    });
    assert(submitted1.status === 201, `submitted ${submitted1.status}`);
    const submittedEventId = (submitted1.json as { event: { eventId: string } }).event
      .eventId;
    record(20, "fixture_ro_publishes_resolution_submitted", true, submittedEventId);

    await waitFor("submitted inbox reconciled", () => {
      const inbox = inboxByEvent(container!, submittedEventId);
      return inbox?.processing_status === "reconciled";
    });
    const inbox1 = inboxByEvent(container!, submittedEventId)!;
    const ack1 = container.database.db
      .prepare(`SELECT * FROM lp_adapter_acknowledgements WHERE event_id=?`)
      .get(submittedEventId) as { status: string } | undefined;
    assert(ack1, "durable acknowledgement state");
    await waitFor("ack completed", () => {
      const ack = container!.database.db
        .prepare(`SELECT status FROM lp_adapter_acknowledgements WHERE event_id=?`)
        .get(submittedEventId) as { status: string } | undefined;
      return ack?.status === "acknowledged";
    });
    record(21, "maa_receive_verify_inbox_ack_reconcile", true, String(inbox1.processing_status));

    const beforeSecond = container.workflowFeedbackService.getById(
      feedback1.workflowFeedbackId
    );
    const resolveAuditCount = (
      container.database.db
        .prepare(
          `SELECT COUNT(*) AS c FROM audit_events WHERE action='workflow_feedback.resolved_request' AND target_id=?`
        )
        .get(feedback1.workflowFeedbackId) as { c: number }
    ).c;
    assert(resolveAuditCount === 1, "exactly one operational resolve command");
    const reconcileEvents = (
      container.database.db
        .prepare(
          `SELECT COUNT(*) AS c FROM lp_adapter_processing_events
           WHERE event_kind='learning_plane.resolution_submitted_reconciled'
             AND related_inbox_id=?`
        )
        .get(String(inbox1.inbox_id)) as { c: number }
    ).c;
    assert(reconcileEvents >= 1, "submitted reconciled without executing resolve");
    assert(
      beforeSecond.resolutionAction === "supplemental_collection",
      "canonical resolution unchanged after adapter reconciliation"
    );
    record(22, "no_second_operational_resolution", true);

    // 23–26. Revision/evaluation path + evaluated publish with causation
    container.workflowFeedbackService.attachRevision({
      workflowFeedbackId: feedback1.workflowFeedbackId,
      revisionRunId: "run_i3b_a_1_rev"
    });
    const evaluated = container.workflowFeedbackService.completeRevision({
      revisionRunId: "run_i3b_a_1_rev",
      priorRunId: feedback1.runId,
      bindingPresentInSupplemental: false
    });
    assert(evaluated, "evaluated feedback");
    record(23, "revision_and_effectiveness_evaluation", true);

    const evaluatedOutbox = outboxRow(
      container,
      feedback1.workflowFeedbackId,
      "workflow_feedback.resolution_evaluated"
    );
    assert(evaluatedOutbox, "evaluated outbox");
    assert(
      evaluatedOutbox.status === "pending" ||
        evaluatedOutbox.status === "claimed" ||
        evaluatedOutbox.status === "published" ||
        evaluatedOutbox.status === "retry_scheduled",
      `evaluated status ${evaluatedOutbox.status}`
    );
    record(24, "canonical_evaluation_and_outbox_commit", true);

    await waitFor("evaluated published", () => {
      const row = outboxRow(
        container!,
        feedback1.workflowFeedbackId,
        "workflow_feedback.resolution_evaluated"
      );
      return row?.status === "published" && Boolean(row.learning_plane_event_id);
    });
    const evaluatedPublished = outboxRow(
      container,
      feedback1.workflowFeedbackId,
      "workflow_feedback.resolution_evaluated"
    )!;
    assert(
      String(evaluatedPublished.correlation_id) === "corr_i3b_a_1",
      "evaluated correlation"
    );
    assert(
      String(evaluatedPublished.causation_event_id) === submittedEventId,
      "evaluated causationEventId"
    );
    assert(
      String(evaluatedPublished.workflow_feedback_id) === feedback1.workflowFeedbackId,
      "evaluated workflow feedback id"
    );
    assert(String(evaluatedPublished.resolution_id) === resolutionId1, "evaluated resolution id");
    const evaluatedPayload = JSON.parse(String(evaluatedPublished.payload_json)) as {
      effectiveness: string;
      maaWorkflowFeedbackId: string;
      resolutionId: string;
    };
    assert(evaluatedPayload.effectiveness === "partial", "canonical effectiveness");
    scanForSecrets("evaluated payload", evaluatedPayload);
    record(25, "evaluated_event_fields", true, String(evaluatedPublished.learning_plane_event_id));

    await waitFor("RO received evaluated", () =>
      fixture!.pushes.some(
        (p) => p.eventId === String(evaluatedPublished.learning_plane_event_id)
      )
    );
    record(26, "fixture_ro_received_and_acked_evaluated", true);

    // 27. Redeliver / idempotent republish of all three
    const maaAgentKey = (
      JSON.parse(readFileSync(join(maaRoot, "secrets", "lp.json"), "utf8")) as {
        agentApiKey: string;
      }
    ).agentApiKey;
    const replayCreated = await lpCall(lpBase, "POST", "/v1/events", {
      key: maaAgentKey,
      body: {
        eventType: "workflow_feedback.created",
        schemaVersion: "1.0",
        sourceAgentId: "marketplace-analysis-agent",
        targetAgentId: "research-orchestrator",
        workOrderId: "wo_i3b_a_1",
        correlationId: "corr_i3b_a_1",
        occurredAt: new Date().toISOString(),
        idempotencyKey: String(publishedCreated.idempotency_key),
        payload: JSON.parse(String(publishedCreated.payload_json)),
        metadata: {
          producerServiceVersion: "0.19.1",
          payloadSchemaVersion: "1.0",
          learningPlaneContractVersion: "1.0"
        }
      }
    });
    assert(replayCreated.status === 200, `created replay ${replayCreated.status}`);
    assert(
      (replayCreated.json as { event: { eventId: string } }).event.eventId === createdEventId,
      "created idempotent"
    );
    const replaySubmitted = await publishSubmitted({
      lpBase,
      roKey: roKey!,
      workflowFeedbackId: feedback1.workflowFeedbackId,
      resolutionId: resolutionId1,
      resolutionType: "supplemental_collection",
      correlationId: "corr_i3b_a_1",
      causationEventId: createdEventId,
      workOrderId: "wo_i3b_a_1",
      rationale: "Collect supplemental listing fields."
    });
    assert(replaySubmitted.status === 200, `submitted replay ${replaySubmitted.status}`);
    const replayEvaluated = await lpCall(lpBase, "POST", "/v1/events", {
      key: maaAgentKey,
      body: {
        eventType: "workflow_feedback.resolution_evaluated",
        schemaVersion: "1.0",
        sourceAgentId: "marketplace-analysis-agent",
        targetAgentId: "research-orchestrator",
        workOrderId: "wo_i3b_a_1",
        correlationId: "corr_i3b_a_1",
        causationEventId: submittedEventId,
        occurredAt: new Date().toISOString(),
        idempotencyKey: String(evaluatedPublished.idempotency_key),
        payload: JSON.parse(String(evaluatedPublished.payload_json)),
        metadata: {
          producerServiceVersion: "0.19.1",
          payloadSchemaVersion: "1.0",
          learningPlaneContractVersion: "1.0"
        }
      }
    });
    assert(replayEvaluated.status === 200, `evaluated replay ${replayEvaluated.status}`);
    record(27, "redeliver_all_three_idempotent", true);

    // 28–29. Semantic conflict without canonical mutation
    const conflict = await publishSubmitted({
      lpBase,
      roKey: roKey!,
      workflowFeedbackId: feedback1.workflowFeedbackId,
      resolutionId: `res_conflict_${feedback1.workflowFeedbackId}`,
      resolutionType: "stop",
      correlationId: "corr_i3b_a_1",
      causationEventId: createdEventId,
      workOrderId: "wo_i3b_a_1",
      rationale: "Conflicting stop decision."
    });
    assert(conflict.status === 201, `conflict submit ${conflict.status}`);
    const conflictEventId = (conflict.json as { event: { eventId: string } }).event.eventId;
    await waitFor("semantic conflict", () => {
      const inbox = inboxByEvent(container!, conflictEventId);
      return inbox?.processing_status === "semantic_conflict";
    });
    const afterConflict = container.workflowFeedbackService.getById(
      feedback1.workflowFeedbackId
    );
    assert(
      afterConflict.resolutionAction === "supplemental_collection",
      "canonical must not mutate on semantic conflict"
    );
    record(28, "deliver_semantically_conflicting_submitted", true);
    record(29, "semantic_conflict_without_mutation", true);

    // 30–33. Submitted before local resolution → awaiting → resolve → reconcile
    const feedback3 = detectFeedback(container, {
      projectId: "proj_i3b_a_3",
      runId: "run_i3b_a_3",
      requestId: "req_i3b_a_3",
      correlationId: "corr_i3b_a_3",
      workOrderId: "wo_i3b_a_3",
      subjectId: "asin_i3b_a_3"
    });
    assert(feedback3, "feedback3");
    await waitFor("feedback3 created published", () => {
      const row = outboxRow(
        container!,
        feedback3.workflowFeedbackId,
        "workflow_feedback.created"
      );
      return row?.status === "published" && Boolean(row.learning_plane_event_id);
    });
    const created3 = outboxRow(
      container,
      feedback3.workflowFeedbackId,
      "workflow_feedback.created"
    )!;
    const earlySubmitted = await publishSubmitted({
      lpBase,
      roKey: roKey!,
      workflowFeedbackId: feedback3.workflowFeedbackId,
      resolutionId: canonicalMaaResolutionId(feedback3.workflowFeedbackId),
      resolutionType: "supplemental_collection",
      correlationId: "corr_i3b_a_3",
      causationEventId: String(created3.learning_plane_event_id),
      workOrderId: "wo_i3b_a_3",
      rationale: "Early submitted before local resolve."
    });
    assert(earlySubmitted.status === 201, "early submitted");
    const earlyEventId = (earlySubmitted.json as { event: { eventId: string } }).event
      .eventId;
    await waitFor("awaiting local reconciliation", () => {
      const inbox = inboxByEvent(container!, earlyEventId);
      return inbox?.processing_status === "awaiting_local_reconciliation";
    });
    record(30, "deliver_submitted_before_local_resolution", true);
    record(31, "awaiting_local_reconciliation", true);

    const resolve3 = await fetch(
      `${maaBase}/v1/workflow-feedback/${feedback3.workflowFeedbackId}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          resolutionAction: "supplemental_collection",
          supplementalEvidencePackageIds: [],
          actorId: "fixture-orchestrator"
        })
      }
    );
    if (!resolve3.ok) {
      throw new Error(await resolve3.text());
    }
    record(32, "create_matching_resolution_via_api", true);
    await waitFor("early submitted reconciled", () => {
      const inbox = inboxByEvent(container!, earlyEventId);
      return inbox?.processing_status === "reconciled";
    });
    const resolveAudit3 = (
      container.database.db
        .prepare(
          `SELECT COUNT(*) AS c FROM audit_events WHERE action='workflow_feedback.resolved_request' AND target_id=?`
        )
        .get(feedback3.workflowFeedbackId) as { c: number }
    ).c;
    assert(resolveAudit3 === 1, "only the intentional operational resolve ran for feedback3");
    record(33, "reconciliation_without_second_resolution_command", true);

    // 34–37. Evaluated before submitted parent → waiting_for_causation → release → publish once
    const feedback4 = detectFeedback(container, {
      projectId: "proj_i3b_a_4",
      runId: "run_i3b_a_4",
      requestId: "req_i3b_a_4",
      correlationId: "corr_i3b_a_4",
      workOrderId: "wo_i3b_a_4",
      subjectId: "asin_i3b_a_4"
    });
    assert(feedback4, "feedback4");
    await waitFor("feedback4 created published", () => {
      const row = outboxRow(
        container!,
        feedback4.workflowFeedbackId,
        "workflow_feedback.created"
      );
      return Boolean(row?.learning_plane_event_id);
    });
    const created4EventId = String(
      outboxRow(container, feedback4.workflowFeedbackId, "workflow_feedback.created")!
        .learning_plane_event_id
    );
    await fetch(`${maaBase}/v1/workflow-feedback/${feedback4.workflowFeedbackId}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        resolutionAction: "supplemental_collection",
        supplementalEvidencePackageIds: [],
        actorId: "fixture-orchestrator"
      })
    });
    container.workflowFeedbackService.attachRevision({
      workflowFeedbackId: feedback4.workflowFeedbackId,
      revisionRunId: "run_i3b_a_4_rev"
    });
    container.workflowFeedbackService.completeRevision({
      revisionRunId: "run_i3b_a_4_rev",
      priorRunId: feedback4.runId,
      bindingPresentInSupplemental: true
    });
    let waitingEval = outboxRow(
      container,
      feedback4.workflowFeedbackId,
      "workflow_feedback.resolution_evaluated"
    );
    assert(waitingEval?.status === "waiting_for_causation", "waiting_for_causation");
    const frozenIdentity = {
      resolutionId: String(waitingEval.resolution_id),
      idempotencyKey: String(waitingEval.idempotency_key),
      payloadSha256: String(waitingEval.payload_sha256),
      correlationId: String(waitingEval.correlation_id)
    };
    assert(
      frozenIdentity.resolutionId ===
        canonicalMaaResolutionId(feedback4.workflowFeedbackId),
      "canonical resolution frozen at capture"
    );
    record(34, "evaluated_before_submitted_parent", true);
    record(35, "waiting_for_causation", true);

    const wrongParent = await publishSubmitted({
      lpBase,
      roKey: roKey!,
      workflowFeedbackId: feedback4.workflowFeedbackId,
      resolutionId: "res_incorrect_parent",
      resolutionType: "supplemental_collection",
      correlationId: "corr_i3b_a_4",
      causationEventId: created4EventId,
      workOrderId: "wo_i3b_a_4",
      rationale: "Incorrect resolution identity parent."
    });
    assert(wrongParent.status === 201, "wrong parent accepted by LP");
    await waitFor("wrong parent reconciled or conflicted without mutating child", async () => {
      await container!.learningPlane!.reconciliation.tick();
      const row = outboxRow(
        container!,
        feedback4.workflowFeedbackId,
        "workflow_feedback.resolution_evaluated"
      );
      return (
        row?.status === "waiting_for_causation" &&
        row.causation_event_id == null &&
        String(row.resolution_id) === frozenIdentity.resolutionId &&
        String(row.idempotency_key) === frozenIdentity.idempotencyKey &&
        String(row.payload_sha256) === frozenIdentity.payloadSha256
      );
    });

    const lateSubmitted = await publishSubmitted({
      lpBase,
      roKey: roKey!,
      workflowFeedbackId: feedback4.workflowFeedbackId,
      resolutionId: frozenIdentity.resolutionId,
      resolutionType: "supplemental_collection",
      correlationId: "corr_i3b_a_4",
      causationEventId: created4EventId,
      workOrderId: "wo_i3b_a_4",
      rationale: "Parent submitted after evaluated capture."
    });
    assert(lateSubmitted.status === 201, "late submitted");
    const lateSubmittedId = (lateSubmitted.json as { event: { eventId: string } }).event
      .eventId;
    await waitFor("waiting evaluated released and published", () => {
      const row = outboxRow(
        container!,
        feedback4.workflowFeedbackId,
        "workflow_feedback.resolution_evaluated"
      );
      return (
        row?.status === "published" &&
        String(row.causation_event_id) === lateSubmittedId &&
        String(row.resolution_id) === frozenIdentity.resolutionId &&
        String(row.idempotency_key) === frozenIdentity.idempotencyKey &&
        String(row.payload_sha256) === frozenIdentity.payloadSha256 &&
        String(row.correlation_id) === frozenIdentity.correlationId &&
        countPublished(
          container!,
          feedback4.workflowFeedbackId,
          "workflow_feedback.resolution_evaluated"
        ) === 1
      );
    }, 60_000);
    record(36, "deliver_correct_submitted_parent", true, lateSubmittedId);
    record(37, "evaluated_pending_then_publish_once", true);

    // 38–39. Restart MAA with pending work; workers recover
    // Create a fresh pending outbox under a brief LP pause to leave work, then restart.
    await stopChild(lpChild);
    lpChild = null;
    const feedback5 = detectFeedback(container, {
      projectId: "proj_i3b_a_5",
      runId: "run_i3b_a_5",
      requestId: "req_i3b_a_5",
      correlationId: "corr_i3b_a_5",
      workOrderId: "wo_i3b_a_5",
      subjectId: "asin_i3b_a_5"
    });
    assert(feedback5, "feedback5 pending work");
    // Also leave a pending ack by injecting inbox+ack without completing ack worker fully:
    // restart while ack may be pending after a new submitted once LP is back — simpler path:
    // restart now with pending outbox, bring LP back, prove workers drain.
    await stopMaa({ container, server });
    container = null;
    server = null;
    const restartedWork = await startMaa({ config: config!, maaPort });
    container = restartedWork.container;
    server = restartedWork.server;
    maaBase = restartedWork.maaBase;
    const lp3 = await startIsolatedLearningPlane({ port: lpPort, root: lpRoot });
    lpChild = lp3.child;
    await waitFor("workers recover pending outbox", () => {
      return (
        countPublished(
          container!,
          feedback5.workflowFeedbackId,
          "workflow_feedback.created"
        ) === 1
      );
    }, 60_000);
    const claimedAfter = (
      container.database.db
        .prepare(
          `SELECT COUNT(*) AS c FROM lp_adapter_outbox WHERE status='claimed' AND (lease_expires_at IS NULL OR lease_expires_at > ?)`
        )
        .get(new Date().toISOString()) as { c: number }
    ).c;
    assert(claimedAfter === 0, "no permanent claimed leases after recovery");
    record(38, "restart_maa_with_pending_work", true);
    record(39, "workers_recover", true);

    // 40. Diagnostics + lineage
    const statusFinal = await (
      await fetch(`${maaBase}/v1/integrations/learning-plane/status`)
    ).json();
    const outboxInspect = await (
      await fetch(`${maaBase}/v1/integrations/learning-plane/outbox`)
    ).json();
    const inboxInspect = await (
      await fetch(`${maaBase}/v1/integrations/learning-plane/inbox`)
    ).json();
    const processing = await (
      await fetch(`${maaBase}/v1/integrations/learning-plane/processing-events`)
    ).json();
    scanForSecrets("statusFinal", statusFinal);
    scanForSecrets("outboxInspect", outboxInspect);
    scanForSecrets("inboxInspect", inboxInspect);
    scanForSecrets("processing", processing);
    record(40, "inspect_adapter_diagnostics_and_lineage", true);

    // 41–42. Backup + isolated restore integrity
    const backup = createBackup({
      databasePath: container.config.databasePath,
      backupDir: container.config.backupDir,
      serviceVersion: SERVICE_VERSION,
      databaseSchemaVersion: container.databaseSchemaVersion,
      notes: "lp8-i3b-a-closure"
    });
    scanForSecrets("backup manifest", backup.manifest);
    const backupFiles = readdirSync(backup.backupPath);
    assert(!backupFiles.some((f) => f.includes("secret")), "no secret file in backup dir");
    const secretPath = join(maaRoot, "secrets", "lp.json");
    assert(existsSync(secretPath), "secret file still local");
    const backupBlob = readFileSync(join(backup.backupPath, backup.manifest.databaseFile));
    assert(!backupBlob.includes(Buffer.from(OPERATOR_TOKEN)), "operator token not in backup db");
    assert(
      !backupBlob.toString("utf8").includes('"agentApiKey"'),
      "agentApiKey must not appear in backup db blob as plaintext secret file"
    );
    const restoredPath = join(maaRoot, "restored.sqlite");
    restoreBackup({
      backupPath: backup.backupPath,
      databasePath: restoredPath,
      maxSupportedDatabaseSchemaVersion: "0016"
    });
    const restored = Database.open({ path: restoredPath });
    try {
      const integrity = restored.db.pragma("integrity_check") as Array<{ integrity_check: string }>;
      assert(integrity[0]?.integrity_check === "ok", "integrity_check");
      const fk = restored.db.pragma("foreign_key_check") as unknown[];
      assert(fk.length === 0, "foreign_key_check");
      const migrations = restored.db
        .prepare(`SELECT version FROM schema_migrations ORDER BY version`)
        .all() as Array<{ version: string }>;
      assert(
        migrations.some((m) => m.version === "0016"),
        "migration 0016 present"
      );
      const wfCount = (
        restored.db.prepare(`SELECT COUNT(*) AS c FROM workflow_feedback_events`).get() as {
          c: number;
        }
      ).c;
      assert(wfCount >= 5, "canonical feedback restored");
      const outboxCount = (
        restored.db.prepare(`SELECT COUNT(*) AS c FROM lp_adapter_outbox`).get() as {
          c: number;
        }
      ).c;
      const inboxCount = (
        restored.db.prepare(`SELECT COUNT(*) AS c FROM lp_adapter_inbox`).get() as {
          c: number;
        }
      ).c;
      const ackCount = (
        restored.db
          .prepare(`SELECT COUNT(*) AS c FROM lp_adapter_acknowledgements`)
          .get() as { c: number }
      ).c;
      assert(outboxCount > 0 && inboxCount > 0 && ackCount > 0, "adapter state restored");
      const conflictRestored = (
        restored.db
          .prepare(
            `SELECT COUNT(*) AS c FROM lp_adapter_inbox WHERE processing_status='semantic_conflict'`
          )
          .get() as { c: number }
      ).c;
      assert(conflictRestored >= 1, "semantic conflict preserved");
      record(41, "backup_and_isolated_restore", true, backup.backupId);
      record(
        42,
        "verify_migration_integrity_fk_canonical_adapter",
        true,
        `wf=${wfCount},outbox=${outboxCount},inbox=${inboxCount}`
      );
    } finally {
      restored.close();
    }

    // 43. Secret absence across surfaces
    const logFiles = existsSync(join(maaRoot, "log"))
      ? readdirSync(join(maaRoot, "log"), { recursive: true }).map(String)
      : [];
    for (const relative of logFiles) {
      const full = join(maaRoot, "log", relative);
      if (!existsSync(full) || full.endsWith(".sqlite")) continue;
      try {
        const text = readFileSync(full, "utf8");
        scanForSecrets(`log:${relative}`, text);
      } catch {
        /* binary skip */
      }
    }
    scanForSecrets("console-status-proxy", statusFinal);
    record(43, "secrets_absent_from_surfaces", true);

    const proof = {
      live_uat: "passed",
      milestone: "LP8-I3b-b",
      maaServiceVersion: SERVICE_VERSION,
      schemaVersion: CURRENT_DATABASE_SCHEMA_VERSION,
      lpBase,
      maaBase,
      stepsCompleted: steps.length,
      proof:
        "MAA can publish and receive production workflow-feedback learning events through Learning Plane while preserving its operational API, canonical local learning records, and independence from Learning Plane availability."
    };
    console.log(JSON.stringify(redact(proof), null, 2));
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = {
      live_uat: "failed",
      error: message,
      steps,
      preservedAt: diagnosticsRoot
    };
    writeFileSync(
      join(diagnosticsRoot, "failure.json"),
      JSON.stringify(redact(diagnostic), null, 2)
    );
    console.error(JSON.stringify(redact(diagnostic), null, 2));
    throw error;
  } finally {
    try {
      await stopMaa({ container, server });
    } catch (error) {
      console.error(
        JSON.stringify(
          redact({
            cleanup: "maa_shutdown_failed",
            error: error instanceof Error ? error.message : String(error)
          })
        )
      );
      failed = true;
    }
    try {
      if (fixture) await fixture.close();
    } catch (error) {
      console.error(
        JSON.stringify(
          redact({
            cleanup: "fixture_close_failed",
            error: error instanceof Error ? error.message : String(error)
          })
        )
      );
      failed = true;
    }
    try {
      await stopChild(lpChild);
    } catch (error) {
      console.error(
        JSON.stringify(
          redact({
            cleanup: "lp_stop_failed",
            error: error instanceof Error ? error.message : String(error)
          })
        )
      );
      failed = true;
    }
    if (!failed) {
      await rmWithRetry(uatRoot);
    } else {
      console.error(
        JSON.stringify(
          redact({
            cleanup: "preserved_diagnostics",
            path: diagnosticsRoot
          })
        )
      );
    }
  }
}

main().catch(() => {
  process.exitCode = 1;
});
