import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "@maa/artifacts";
import {
  AnalysisOutputsRepository,
  ArtifactsRepository,
  Database,
  FindingsRepository,
  ModelCallsRepository,
  runMigrations
} from "@maa/database";
import { FakeProvider } from "@maa/model-router";
import { findRepoRoot } from "../../../apps/server/src/config/paths";
import {
  generateFromEvidence,
  planAnalysis,
  registerAnalysisFixtures,
  runStructuredAnalysis
} from "./index";
import type { AnalysisPromptPayload } from "./prompt";
import { REQUIRED_OUTPUT_EXAMPLE } from "./prompt";

describe("analysis planner and fixtures", () => {
  it("plans only ready areas", () => {
    const plan = planAnalysis({
      requestedAreas: ["pricing", "customer_evidence"],
      operation: "full_marketplace_analysis",
      readiness: {
        overallStatus: "partial",
        readyAreas: ["pricing"],
        blockedAreas: ["customer_evidence"],
        areas: [
          {
            area: "pricing",
            status: "ready",
            score: 1,
            required: [],
            availableEvidenceRefs: [],
            warnings: [],
            gaps: [],
            allowedOutputLevel: "complete"
          },
          {
            area: "customer_evidence",
            status: "insufficient",
            score: 0,
            required: [],
            availableEvidenceRefs: [],
            warnings: [],
            gaps: [],
            allowedOutputLevel: "none"
          }
        ],
        warnings: [],
        packageIds: [],
        evaluatedAt: "2026-07-20T12:00:00.000Z"
      }
    });
    expect(plan.areasToAnalyze).toEqual(["pricing"]);
    expect(plan.areasToSkip).toEqual(["customer_evidence"]);
  });

  it("generateFromEvidence cites listing evidence", () => {
    const payload: AnalysisPromptPayload = {
      operation: "full_marketplace_analysis",
      productContext: {
        name: "Test Product",
        salesGoal: "price",
        constraints: []
      },
      requestedAreas: ["market_structure", "pricing"],
      plan: {
        promptVersion: "full-analysis.v1",
        schemaVersion: "analysis-output.v1",
        areasToAnalyze: ["market_structure", "pricing"],
        areasToSkip: [],
        fixtureKey: "analysis.v1.from-evidence"
      },
      evidenceItems: [
        {
          evidenceId: "evid_a",
          sourceType: "listing",
          subjectId: "B1",
          title: "A",
          fields: { price: 9.99, format: "paperback", currency: "USD" },
          observedAt: "2026-07-20T12:00:00.000Z"
        }
      ],
      approvedMemory: [],
      failureCorrections: [],
      proceduralRules: [],
      outputSchemaVersion: "analysis-output.v1",
      requiredOutputExample: REQUIRED_OUTPUT_EXAMPLE
    };
    const out = generateFromEvidence(payload);
    expect(out.findings.length).toBeGreaterThan(0);
    for (const f of out.findings) {
      if (f.classification === "observed_fact") {
        expect(f.evidenceRefs.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("runStructuredAnalysis", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs.splice(0)) {
      rmSync(d, { recursive: true, force: true });
    }
  });

  it("persists findings from fake provider and repairs invalid output", async () => {
    const repoRoot = findRepoRoot();
    const artifactRoot = mkdtempSync(join(tmpdir(), "maa-analysis-"));
    dirs.push(artifactRoot);
    const db = Database.open({ path: ":memory:" });
    runMigrations(db.db, join(repoRoot, "migrations"));

    const provider = new FakeProvider();
    registerAnalysisFixtures(provider);

    const deps = {
      provider,
      model: "fake-structured",
      artifacts: new ArtifactsRepository(db.db),
      artifactStore: new ArtifactStore(artifactRoot),
      findings: new FindingsRepository(db.db),
      outputs: new AnalysisOutputsRepository(db.db),
      modelCalls: new ModelCallsRepository(db.db),
      maxRepairAttempts: 1
    };

    const now = "2026-07-20T12:00:00.000Z";
    db.db
      .prepare(
        `INSERT INTO analysis_projects
          (project_id, external_project_id, name, platform, marketplace, category,
           product_type, product_context_json, status, created_at, updated_at)
         VALUES ('proj_a', null, 'P', 'amazon', 'US', 'books', 'adult_coloring_book', '{}', 'active', ?, ?)`
      )
      .run(now, now);
    db.db
      .prepare(
        `INSERT INTO analysis_requests
          (request_id, project_id, client, operation, requested_analysis_json,
           capability_id, model_profile_id, status, created_at, updated_at)
         VALUES ('req_a', 'proj_a', 't', 'full_marketplace_analysis', '["pricing"]',
           'amazon-kdp', 'mock-only', 'accepted', ?, ?)`
      )
      .run(now, now);
    db.db
      .prepare(
        `INSERT INTO analysis_runs
          (run_id, request_id, attempt_number, status, current_phase,
           token_input, token_output, cost_usd, created_at, updated_at)
         VALUES ('run_a', 'req_a', 1, 'analyzing', 'analyzing', 0, 0, 0, ?, ?)`
      )
      .run(now, now);

    const evidenceItem = {
      evidenceId: "evid_a",
      sourceType: "listing" as const,
      platform: "amazon",
      marketplace: "US",
      subjectId: "B1",
      title: "A",
      textContent: undefined,
      fields: { price: 11.5, format: "paperback", currency: "USD" },
      provenance: {
        collector: "f",
        collectorVersion: "1",
        observedAt: now,
        sourceUrl: "https://example.com"
      },
      confidence: 1,
      validationStatus: "valid" as const
    };

    const result = await runStructuredAnalysis(deps, {
      runId: "run_a",
      requestId: "req_a",
      operation: "full_marketplace_analysis",
      productContext: { name: "P", salesGoal: "g", constraints: [] },
      requestedAreas: ["pricing"],
      evidenceItems: [evidenceItem]
    });

    expect(result.quality.passed).toBe(true);
    expect(result.output.findings.length).toBeGreaterThan(0);
    expect(deps.findings.listByRun("run_a").length).toBe(result.output.findings.length);
    expect(deps.modelCalls.listByRun("run_a").length).toBeGreaterThan(0);

    db.db
      .prepare(
        `INSERT INTO analysis_runs
          (run_id, request_id, attempt_number, status, current_phase,
           token_input, token_output, cost_usd, created_at, updated_at)
         VALUES ('run_b', 'req_a', 2, 'analyzing', 'analyzing', 0, 0, 0, ?, ?)`
      )
      .run(now, now);

    const repaired = await runStructuredAnalysis(deps, {
      runId: "run_b",
      requestId: "req_a",
      operation: "full_marketplace_analysis",
      productContext: { name: "P", salesGoal: "g", constraints: [] },
      requestedAreas: ["pricing"],
      evidenceItems: [],
      fixtureKey: "analysis.v1.invalid-then-repair"
    });
    expect(repaired.quality.passed).toBe(true);
    expect(deps.modelCalls.listByRun("run_b").some((c) => c.purpose === "analysis_repair")).toBe(
      true
    );

    db.close();
  });
});
