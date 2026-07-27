/**
 * One-shot live DeepSeek acceptance smoke.
 * Run from repo root: pnpm exec tsx scripts/live-deepseek-smoke.ts
 */
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { completeKdpFixture } from "../fixtures/evidence/kdp-fixtures";
import { loadConfig } from "../apps/server/src/config/index";
import { createContainer } from "../apps/server/src/composition/container";
import { createApp } from "../apps/server/src/app";

async function waitForTerminal(baseUrl: string, runId: string, ms = 180_000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    const res = await fetch(`${baseUrl}/v1/analysis-runs/${runId}`);
    if (res.ok) {
      const body = (await res.json()) as { status: string };
      if (
        ["completed", "partial", "failed", "evidence_insufficient", "cancelled"].includes(
          body.status
        )
      ) {
        return body as Record<string, unknown>;
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Timed out waiting for live DeepSeek run");
}

async function main() {
  const base = loadConfig();
  if (!base.raw.MAA_DEEPSEEK_ENABLED || !base.raw.DEEPSEEK_API_KEY.trim()) {
    throw new Error("DeepSeek is not enabled. Set MAA_DEEPSEEK_ENABLED=true and DEEPSEEK_API_KEY.");
  }

  const keep = process.env.MAA_LIVE_KEEP_ARTIFACTS === "1";
  const artifactRoot = mkdtempSync(join(tmpdir(), "maa-live-art-"));
  const logRoot = mkdtempSync(join(tmpdir(), "maa-live-log-"));
  console.log(`artifactRoot=${artifactRoot}`);
  const config = {
    ...base,
    databasePath: join(artifactRoot, "live.sqlite"),
    artifactRoot,
    logRoot,
    migrationsDir: resolve(base.repoRoot, "migrations"),
    raw: {
      ...base.raw,
      NODE_ENV: "development" as const,
      MAA_DEFAULT_MODEL_PROFILE: base.raw.MAA_DEFAULT_MODEL_PROFILE.includes("deepseek")
        ? base.raw.MAA_DEFAULT_MODEL_PROFILE
        : "budget-deepseek",
      MAA_WORKER_POLL_MS: 200,
      MAA_FAKE_PHASE_DELAY_MS: 20
    }
  };

  const container = createContainer(config, { startWorker: true });
  const app = createApp(container);
  const server = createServer(app);
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("Failed to bind smoke server");
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    if (!container.providers.deepseek) {
      throw new Error("DeepSeek provider was not registered on the container.");
    }

    const pkgId = `evpkg_live_${Date.now()}`;
    const reg = await fetch(`${baseUrl}/v1/evidence-packages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(completeKdpFixture(pkgId))
    });
    if (!reg.ok) throw new Error(`Evidence register failed: ${reg.status}`);

    const createdRes = await fetch(`${baseUrl}/v1/analysis-requests`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client: "live-smoke",
        projectId: `proj_live_${Date.now()}`,
        operation: "full_marketplace_analysis",
        capability: {
          platform: "amazon",
          marketplace: "US",
          category: "books",
          productType: "adult_coloring_book"
        },
        productContext: {
          name: "Live Smoke Product",
          salesGoal: "Validate DeepSeek structured analysis path",
          constraints: ["cost-capped smoke"]
        },
        requestedAnalysis: ["market_structure", "pricing", "customer_evidence"],
        evidencePackageIds: [pkgId],
        costCapUsd: 0.5
      })
    });
    const created = (await createdRes.json()) as { runId?: string; error?: unknown };
    if (createdRes.status !== 202 || !created.runId) {
      throw new Error(`Create failed: ${createdRes.status} ${JSON.stringify(created)}`);
    }

    console.log(`runId=${created.runId}`);
    const run = await waitForTerminal(baseUrl, created.runId);
    console.log(
      `status=${run.status} provider=${run.provider} model=${run.model}`
    );
    console.log(
      `tokens_in=${run.tokenInput} tokens_out=${run.tokenOutput} cost_usd=${run.costUsd}`
    );

    const callsRes = await fetch(`${baseUrl}/v1/analysis-runs/${created.runId}/model-calls`);
    const calls = (await callsRes.json()) as {
      modelCalls?: Array<{
        provider: string;
        purpose: string;
        status: string;
        tokenInput: number;
        tokenOutput: number;
        validationErrors?: string[];
        outputArtifactId?: string;
      }>;
    };
    console.log(`model_calls=${calls.modelCalls?.length ?? 0}`);
    for (const c of calls.modelCalls ?? []) {
      console.log(
        `  call provider=${c.provider} purpose=${c.purpose} status=${c.status} in=${c.tokenInput} out=${c.tokenOutput}`
      );
      if (c.validationErrors?.length) {
        console.log(`  validationErrors=${JSON.stringify(c.validationErrors)}`);
      }
    }

    if (run.status === "failed") {
      console.error(`failure=${run.failureCode}: ${run.failureMessage}`);
      process.exitCode = 1;
      return;
    }

    const findingsRes = await fetch(`${baseUrl}/v1/analysis-runs/${created.runId}/findings`);
    const findings = (await findingsRes.json()) as { findings?: unknown[] };
    console.log(`findings=${findings.findings?.length ?? 0}`);

    const deepseekUsed = (calls.modelCalls ?? []).some((c) => c.provider === "deepseek");
    if (!deepseekUsed) {
      console.error("No DeepSeek model call recorded.");
      process.exitCode = 1;
      return;
    }

    console.log("LIVE_DEEPSEEK_SMOKE_OK");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await container.shutdown();
    await new Promise((r) => setTimeout(r, 100));
    if (!keep) {
      rmSync(artifactRoot, { recursive: true, force: true });
      rmSync(logRoot, { recursive: true, force: true });
    } else {
      console.log(`kept artifacts under ${artifactRoot}`);
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
