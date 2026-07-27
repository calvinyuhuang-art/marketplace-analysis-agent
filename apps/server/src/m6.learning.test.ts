import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ConfigSchema } from "@maa/contracts";
import { CUSTOMER_EVIDENCE_REGRESSION_TEST_ID } from "@maa/learning";
import { runQualityGates } from "@maa/quality";
import {
  completeKdpFixture,
  listingsWithoutReviewsFixture
} from "../../../fixtures/evidence/kdp-fixtures";
import { createApp } from "./app";
import type { ResolvedConfig } from "./config/index";
import { findRepoRoot } from "./config/paths";
import { type Container, createContainer } from "./composition/container";

const CAPABILITY = {
  platform: "amazon",
  marketplace: "US",
  category: "books",
  productType: "adult_coloring_book"
};

async function waitForStatus(
  app: Express,
  runId: string,
  predicate: (status: string) => boolean,
  timeoutMs = 12_000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await request(app).get(`/v1/analysis-runs/${runId}`);
    if (res.status === 200 && predicate(res.body.status)) {
      return res.body.status as string;
    }
    await new Promise((r) => setTimeout(r, 40));
  }
  const final = await request(app).get(`/v1/analysis-runs/${runId}`);
  throw new Error(`Timeout waiting for status. Last status=${final.body.status}`);
}

describe("M6 learning and Error Book", () => {
  let container: Container;
  let app: Express;
  let artifactRoot: string;
  let logRoot: string;

  beforeAll(() => {
    const repoRoot = findRepoRoot();
    artifactRoot = mkdtempSync(join(tmpdir(), "maa-m6-art-"));
    logRoot = mkdtempSync(join(tmpdir(), "maa-m6-log-"));
    const config: ResolvedConfig = {
      raw: ConfigSchema.parse({
        NODE_ENV: "test",
        MAA_WORKER_POLL_MS: "20",
        MAA_HEARTBEAT_MS: "50",
        MAA_FAKE_PHASE_DELAY_MS: "5",
        MAA_STALE_EXECUTION_MS: "200"
      }),
      repoRoot,
      databasePath: ":memory:",
      artifactRoot,
      logRoot,
      backupDir: join(artifactRoot, "backups"),
      migrationsDir: resolve(repoRoot, "migrations")
    };
    container = createContainer(config, { startWorker: true });
    app = createApp(container);
  });

  afterAll(async () => {
    await container.shutdown();
    await new Promise((r) => setTimeout(r, 50));
    rmSync(artifactRoot, { recursive: true, force: true });
    rmSync(logRoot, { recursive: true, force: true });
  });

  it(
    "rejects unsupported customer finding into Error Book, approves rule, retrieves on future run",
    async () => {
      const pkgComplete = "evpkg_m6_complete";
      await request(app).post("/v1/evidence-packages").send(completeKdpFixture(pkgComplete));

      const first = await request(app)
        .post("/v1/analysis-requests")
        .send({
          client: "research-team",
          projectId: "proj_m6_learn",
          operation: "full_marketplace_analysis",
          capability: CAPABILITY,
          productContext: {
            name: "Learning Test Product",
            salesGoal: "avoid unsupported prefs",
            constraints: []
          },
          requestedAnalysis: ["market_structure", "pricing", "customer_evidence"],
          evidencePackageIds: [pkgComplete]
        });
      expect(first.status).toBe(202);
      await waitForStatus(app, first.body.runId, (s) =>
        ["completed", "partial"].includes(s)
      );

      // Accepting the run alone must not create causal lesson truth.
      const outcome = await request(app)
        .post(`/v1/analysis-runs/${first.body.runId}/outcome-review`)
        .send({ judgment: "helpful", reviewerId: "op-m6" });
      expect(outcome.status).toBe(201);
      expect(outcome.body.lessonCandidateId).toBeUndefined();
      const lessonsAfterAccept = await request(app).get(
        "/v1/projects/proj_m6_learn/lessons"
      );
      expect(lessonsAfterAccept.body.lessons).toHaveLength(0);

      const findings = await request(app).get(
        `/v1/analysis-runs/${first.body.runId}/findings`
      );
      const customerFinding =
        findings.body.findings.find(
          (f: { analysisArea: string }) => f.analysisArea === "customer_evidence"
        ) ?? findings.body.findings[0];
      expect(customerFinding).toBeTruthy();

      const reject = await request(app)
        .post(`/v1/findings/${customerFinding.findingId}/review`)
        .send({
          action: "reject",
          reasonCode: "unsupported_conclusion",
          notes: "No direct buyer language for this preference claim.",
          reviewerId: "op-m6"
        });
      expect(reject.status).toBe(200);
      expect(reject.body.learning?.errorBook?.errorClass).toBe(
        "unsupported_customer_claim"
      );
      expect(reject.body.learning?.errorBook?.regressionTestIds).toContain(
        CUSTOMER_EVIDENCE_REGRESSION_TEST_ID
      );
      expect(reject.body.learning?.proceduralRule?.status).toBe("proposed");

      const book = await request(app).get(
        "/v1/error-book?projectId=proj_m6_learn"
      );
      expect(book.status).toBe(200);
      expect(book.body.entries.length).toBeGreaterThan(0);
      expect(book.body.entries[0].recurrenceStatus).toBe("first_seen");

      const lessonId = reject.body.learning.lesson.lessonCandidateId as string;
      const approve = await request(app)
        .post(`/v1/lessons/${lessonId}/review`)
        .send({
          action: "approve",
          reviewerId: "op-m6",
          activateProceduralRule: true
        });
      expect(approve.status).toBe(200);
      expect(approve.body.status).toBe("approved");

      const rules = await request(app).get(
        "/v1/procedural-rules?projectId=proj_m6_learn&status=active"
      );
      expect(rules.body.rules.length).toBeGreaterThan(0);
      expect(rules.body.rules[0].authority).toBe("procedural_active");
      expect(rules.body.rules[0].requireDirectCustomerEvidence).toBe(true);

      // Linked regression test still enforces the correction.
      const gate = runQualityGates({
        output: {
          schemaVersion: "analysis-output.v1",
          summary: "Customers prefer thicker paper.",
          readyAreasAnalyzed: ["customer_evidence"],
          blockedAreasSkipped: [],
          findings: [
            {
              findingId: "fnd_bad",
              statement: "Customers prefer thicker paper based on star ratings alone.",
              analysisArea: "customer_evidence",
              classification: "observed_fact",
              scope: { subjectIds: ["B1"] },
              evidenceRefs: ["evid_listing_only"],
              memoryRefs: [],
              confidence: 0.95,
              freshness: {
                status: "current",
                evaluatedAt: "2026-07-20T12:00:00.000Z"
              },
              contradictions: [],
              downstreamImplications: [],
              validationStatus: "unreviewed",
              tags: ["from_rating_count_only"]
            }
          ],
          assumptions: [],
          unknowns: [],
          contradictions: [],
          nextActions: [],
          limitations: []
        },
        evidenceItems: [
          {
            evidenceId: "evid_listing_only",
            sourceType: "listing",
            platform: "amazon",
            marketplace: "US",
            subjectId: "B1",
            title: "Sample",
            fields: { price: 9.99 },
            provenance: {
              collector: "t",
              collectorVersion: "1",
              observedAt: "2026-07-20T12:00:00.000Z"
            },
            confidence: 1,
            validationStatus: "valid"
          }
        ],
        requestedAreas: ["customer_evidence"]
      });
      expect(gate.passed).toBe(false);

      // Future run without reviews: collection request, not invented prefs.
      const pkgNoReviews = "evpkg_m6_noreviews";
      await request(app)
        .post("/v1/evidence-packages")
        .send(listingsWithoutReviewsFixture(pkgNoReviews));

      const second = await request(app)
        .post("/v1/analysis-requests")
        .send({
          client: "research-team",
          projectId: "proj_m6_learn",
          operation: "full_marketplace_analysis",
          capability: CAPABILITY,
          productContext: {
            name: "Learning Test Product",
            salesGoal: "avoid unsupported prefs",
            constraints: []
          },
          requestedAnalysis: ["customer_evidence"],
          evidencePackageIds: [pkgNoReviews]
        });
      expect(second.status).toBe(202);
      const secondStatus = await waitForStatus(app, second.body.runId, (s) =>
        ["completed", "partial", "evidence_insufficient"].includes(s)
      );
      expect(["partial", "evidence_insufficient"]).toContain(secondStatus);

      const collections = await request(app).get(
        `/v1/analysis-runs/${second.body.runId}/collection-requests`
      );
      expect(collections.status).toBe(200);
      expect(collections.body.collectionRequests?.length ?? collections.body.length).toBeGreaterThan(
        0
      );

      const assembly = await request(app).get(
        `/v1/analysis-runs/${second.body.runId}/context-assembly`
      );
      expect(assembly.status).toBe(200);
      const procedural = (assembly.body.sections ?? []).find(
        (s: { name: string }) => s.name === "procedural_rules"
      );
      expect(procedural).toBeTruthy();
      expect(procedural.memoryIds.length).toBeGreaterThan(0);

      // Recurrence: reject another customer_evidence finding → recurrence_status recurring
      const customerFindings = (
        await request(app).get(`/v1/analysis-runs/${first.body.runId}/findings`)
      ).body.findings.filter(
        (f: { analysisArea: string; findingId: string }) =>
          f.analysisArea === "customer_evidence" && f.findingId !== customerFinding.findingId
      );
      if (customerFindings.length > 0) {
        await request(app)
          .post(`/v1/findings/${customerFindings[0].findingId}/review`)
          .send({
            action: "reject",
            reasonCode: "unsupported_conclusion",
            reviewerId: "op-m6"
          });
        const book2 = await request(app).get(
          "/v1/error-book?projectId=proj_m6_learn&errorClass=unsupported_customer_claim"
        );
        expect(book2.body.entries[0].occurrenceCount).toBeGreaterThan(1);
        expect(book2.body.entries[0].recurrenceStatus).toBe("recurring");
      } else {
        // Deterministic fallback: record a second rejection through the learning service.
        container.learningService.recordFindingRejection({
          projectId: "proj_m6_learn",
          runId: first.body.runId,
          findingId: "fnd_synthetic_m6",
          findingStatement: "Customers love X without evidence.",
          analysisArea: "customer_evidence",
          reasonCode: "unsupported_conclusion",
          platform: "amazon",
          marketplace: "US",
          category: "books",
          productType: "adult_coloring_book"
        });
        const book2 = await request(app).get(
          "/v1/error-book?projectId=proj_m6_learn&errorClass=unsupported_customer_claim"
        );
        expect(book2.body.entries[0].occurrenceCount).toBeGreaterThan(1);
        expect(book2.body.entries[0].recurrenceStatus).toBe("recurring");
      }
    },
    30_000
  );
});
