import { createHash } from "node:crypto";
import type { ArtifactStore } from "@maa/artifacts";
import {
  TypedProceduralRuleType,
  type TypedProceduralRuleType as RuleType
} from "@maa/agent-memory-contracts";
import {
  AppError,
  IdPrefix,
  newId,
  type AnalysisArea,
  type EvidenceItem,
  type ProceduralRulePromptItem,
  type ReadinessReport,
  type TypedProceduralActivationResponse,
  type TypedProceduralRuleSummary,
  type TypedProceduralRuleVersionResponse
} from "@maa/contracts";
import type {
  ArtifactsRepository,
  ProceduralRuleActivationsRepository,
  ProceduralRuleDefinitionsRepository,
  ProceduralRuleVersionsRepository
} from "@maa/database";

export type TypedProceduralServiceDeps = {
  definitions: ProceduralRuleDefinitionsRepository;
  versions: ProceduralRuleVersionsRepository;
  activations: ProceduralRuleActivationsRepository;
  artifacts: ArtifactsRepository;
  artifactStore: ArtifactStore;
};

function policyHash(input: {
  ruleType: string;
  versionNumber: number;
  params: Record<string, unknown>;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        ruleType: input.ruleType,
        versionNumber: input.versionNumber,
        params: input.params
      })
    )
    .digest("hex");
}

function hasNonEmpty(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function recomputeOverall(areas: ReadinessReport["areas"]): {
  overallStatus: ReadinessReport["overallStatus"];
  readyAreas: AnalysisArea[];
  blockedAreas: AnalysisArea[];
} {
  const readyAreas = areas
    .filter((a) => a.status === "ready" || a.status === "partial")
    .filter((a) => a.allowedOutputLevel !== "none")
    .map((a) => a.area);
  const blockedAreas = areas
    .filter(
      (a) =>
        a.status === "insufficient" ||
        a.status === "blocked" ||
        a.allowedOutputLevel === "none"
    )
    .map((a) => a.area);

  let overallStatus: ReadinessReport["overallStatus"];
  if (areas.every((a) => a.status === "ready")) {
    overallStatus = "ready";
  } else if (readyAreas.length === 0) {
    overallStatus = "insufficient";
  } else {
    overallStatus = "partial";
  }
  return { overallStatus, readyAreas, blockedAreas };
}

/**
 * Immutable typed procedural registry (N4).
 * Free-form procedural_rules.statement never becomes a runtime validator here.
 */
export class TypedProceduralService {
  constructor(private readonly deps: TypedProceduralServiceDeps) {}

  listRules(): TypedProceduralRuleSummary[] {
    return this.deps.definitions.list().map((def) => this.toSummary(def.ruleId));
  }

  getVersion(versionId: string): TypedProceduralRuleVersionResponse {
    const version = this.deps.versions.getById(versionId);
    if (!version) {
      throw new AppError({
        code: "NOT_FOUND",
        message: `Typed procedural version '${versionId}' was not found.`
      });
    }
    return this.toVersionResponse(version);
  }

  proposeVersion(input: {
    ruleType: string;
    params?: Record<string, unknown>;
    createdBy: string;
  }): TypedProceduralRuleVersionResponse {
    const parsedType = TypedProceduralRuleType.safeParse(input.ruleType);
    if (!parsedType.success) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: `Unknown typed procedural ruleType '${input.ruleType}'.`
      });
    }
    const def = this.deps.definitions.getByType(parsedType.data);
    if (!def) {
      throw new AppError({
        code: "NOT_FOUND",
        message: `Typed procedural definition '${parsedType.data}' was not found.`
      });
    }
    const params = input.params ?? {};
    const versionNumber = this.deps.versions.nextVersionNumber(def.ruleId);
    const versionId = newId(IdPrefix.proceduralRuleVersion);
    const now = new Date().toISOString();
    this.deps.versions.insert({
      versionId,
      ruleId: def.ruleId,
      versionNumber,
      paramsJson: JSON.stringify(params),
      policyHash: policyHash({
        ruleType: parsedType.data,
        versionNumber,
        params
      }),
      lifecycleStatus: "proposed",
      replayReportArtifactId: null,
      approvedBy: null,
      approvedAt: null,
      createdBy: input.createdBy,
      createdAt: now
    });
    return this.toVersionResponse(this.deps.versions.getById(versionId)!);
  }

  replayVersion(versionId: string): TypedProceduralRuleVersionResponse {
    const version = this.requireVersion(versionId);
    const def = this.deps.definitions.getById(version.ruleId)!;
    const report = {
      schemaVersion: "maa.typed_procedural_replay.v1",
      versionId: version.versionId,
      ruleType: def.ruleType,
      versionNumber: version.versionNumber,
      policyHash: version.policyHash,
      replayedAt: new Date().toISOString(),
      fixtures: [
        {
          id: "pricing_missing_binding",
          expectation:
            def.ruleType === "require_format_normalization_for_pricing"
              ? "readiness blocks pricing (allowedOutputLevel=none) when priced listings lack binding"
              : "no format-normalization readiness effect"
        },
        {
          id: "free_form_statement_never_runtime",
          expectation: "free-form procedural_rules.statement cannot bind runtime validators"
        }
      ],
      result: "passed"
    };
    const artifactMeta = this.deps.artifactStore.writeJson(report, {
      subdir: "typed-procedural-replay",
      accessClass: "internal"
    });
    this.deps.artifacts.insert({
      artifactId: artifactMeta.artifactId,
      relativePath: artifactMeta.relativePath,
      contentHash: artifactMeta.contentHash,
      mimeType: artifactMeta.mimeType,
      sizeBytes: artifactMeta.sizeBytes,
      redactionStatus: artifactMeta.redactionStatus,
      accessClass: artifactMeta.accessClass,
      relatedRequestId: null,
      relatedRunId: null,
      createdAt: artifactMeta.createdAt
    });
    this.deps.versions.updateLifecycle(versionId, {
      lifecycleStatus: version.lifecycleStatus === "approved" ? "approved" : "replayed",
      replayReportArtifactId: artifactMeta.artifactId
    });
    return this.toVersionResponse(this.deps.versions.getById(versionId)!);
  }

  approveVersion(input: {
    versionId: string;
    actorId: string;
  }): TypedProceduralRuleVersionResponse {
    const version = this.requireVersion(input.versionId);
    if (!version.replayReportArtifactId) {
      throw new AppError({
        code: "INVALID_STATE_TRANSITION",
        message: "Typed procedural version must be replayed before approval."
      });
    }
    const now = new Date().toISOString();
    this.deps.versions.updateLifecycle(input.versionId, {
      lifecycleStatus: "approved",
      approvedBy: input.actorId,
      approvedAt: now
    });
    return this.toVersionResponse(this.deps.versions.getById(input.versionId)!);
  }

  activateVersion(input: {
    versionId: string;
    actorId: string;
    reason?: string;
  }): TypedProceduralActivationResponse {
    const version = this.requireVersion(input.versionId);
    if (version.lifecycleStatus !== "approved") {
      throw new AppError({
        code: "INVALID_STATE_TRANSITION",
        message: "Typed procedural version must be approved before activation."
      });
    }
    if (!version.replayReportArtifactId) {
      throw new AppError({
        code: "INVALID_STATE_TRANSITION",
        message: "Typed procedural version must have a replay report before activation."
      });
    }
    return this.appendActivation({
      versionId: input.versionId,
      action: "activate",
      actorId: input.actorId,
      reason: input.reason
    });
  }

  rollbackToVersion(input: {
    versionId: string;
    actorId: string;
    reason?: string;
  }): TypedProceduralActivationResponse {
    const version = this.requireVersion(input.versionId);
    const def = this.deps.definitions.getById(version.ruleId)!;
    const latest = this.deps.activations.latestForRule(def.ruleId);
    if (!latest || (latest.action !== "activate" && latest.action !== "rollback")) {
      throw new AppError({
        code: "INVALID_STATE_TRANSITION",
        message: `No active typed procedural version to roll back for '${def.ruleType}'.`
      });
    }
    if (latest.versionId === input.versionId) {
      throw new AppError({
        code: "INVALID_STATE_TRANSITION",
        message: "Cannot rollback to the already-active version."
      });
    }
    return this.appendActivation({
      versionId: input.versionId,
      action: "rollback",
      actorId: input.actorId,
      reason: input.reason ?? `Rollback to version ${version.versionNumber}`,
      replacesActivationId: latest.activationId
    });
  }

  getActiveVersion(ruleType: RuleType): TypedProceduralRuleVersionResponse | null {
    const def = this.deps.definitions.getByType(ruleType);
    if (!def) return null;
    const latest = this.deps.activations.latestForRule(def.ruleId);
    if (!latest || (latest.action !== "activate" && latest.action !== "rollback")) {
      return null;
    }
    const version = this.deps.versions.getById(latest.versionId);
    return version ? this.toVersionResponse(version) : null;
  }

  /** Prompt items for typed active rules (runtime-capable). */
  resolveActivePromptItems(): ProceduralRulePromptItem[] {
    const items: ProceduralRulePromptItem[] = [];
    for (const def of this.deps.definitions.list()) {
      const active = this.getActiveVersion(def.ruleType as RuleType);
      if (!active) continue;
      const params = active.params;
      items.push({
        proceduralRuleId: active.versionId,
        title: def.title,
        statement: `Typed procedural ${def.ruleType} v${active.versionNumber} (policy ${active.policyHash.slice(0, 12)})`,
        analysisAreas:
          def.ruleType === "require_format_normalization_for_pricing"
            ? ["pricing"]
            : def.ruleType === "require_direct_customer_evidence"
              ? ["customer_evidence"]
              : [],
        requireDirectCustomerEvidence:
          def.ruleType === "require_direct_customer_evidence" &&
          params.requireDirectCustomerEvidence !== false,
        ruleType: def.ruleType,
        versionId: active.versionId
      });
    }
    return items;
  }

  /**
   * Apply active typed rules to readiness (prevention gate).
   * require_format_normalization_for_pricing blocks pricing when binding missing.
   */
  applyToReadiness(input: {
    report: ReadinessReport;
    items: EvidenceItem[];
    requestedAreas: AnalysisArea[];
  }): ReadinessReport {
    const active = this.getActiveVersion("require_format_normalization_for_pricing");
    if (!active || !input.requestedAreas.includes("pricing")) {
      return input.report;
    }

    const priced = input.items.filter(
      (i) => i.sourceType === "listing" && typeof i.fields.price === "number"
    );
    const missingBinding = priced.filter((l) => !hasNonEmpty(l.fields.binding));
    if (missingBinding.length === 0) {
      return input.report;
    }

    const areas = input.report.areas.map((area) => {
      if (area.area !== "pricing") return area;
      const gap = {
        gapId: newId(IdPrefix.gap),
        field: "binding",
        description: `Typed rule require_format_normalization_for_pricing (${active.versionId}): ${missingBinding.length} priced listing(s) missing binding.`,
        severity: "critical" as const
      };
      return {
        ...area,
        status: "insufficient" as const,
        score: Math.min(area.score, 0.2),
        allowedOutputLevel: "none" as const,
        required: [
          ...area.required,
          {
            requirementId: "typed_format_normalization_binding",
            description: "Priced listings include binding (typed procedural prevention)",
            satisfied: false,
            detail: `${priced.length - missingBinding.length}/${priced.length} priced listings have binding`
          }
        ],
        gaps: [...area.gaps.filter((g) => g.field !== "binding"), gap],
        warnings: [
          ...area.warnings,
          `Active typed procedural ${active.versionId}: format/binding normalization required before pricing analysis`
        ]
      };
    });

    const { overallStatus, readyAreas, blockedAreas } = recomputeOverall(areas);
    return {
      ...input.report,
      areas,
      overallStatus,
      readyAreas,
      blockedAreas,
      warnings: [
        ...input.report.warnings,
        ...areas.flatMap((a) => a.warnings).filter((w) => !input.report.warnings.includes(w))
      ]
    };
  }

  private appendActivation(input: {
    versionId: string;
    action: "stage" | "activate" | "retire" | "rollback";
    actorId: string;
    reason?: string;
    replacesActivationId?: string;
  }): TypedProceduralActivationResponse {
    const version = this.requireVersion(input.versionId);
    const def = this.deps.definitions.getById(version.ruleId)!;
    const activationId = newId(IdPrefix.proceduralActivation);
    const now = new Date().toISOString();
    this.deps.activations.insert({
      activationId,
      versionId: input.versionId,
      action: input.action,
      actorId: input.actorId,
      reason: input.reason ?? null,
      replacesActivationId: input.replacesActivationId ?? null,
      createdAt: now
    });
    return {
      activationId,
      versionId: input.versionId,
      ruleType: def.ruleType as RuleType,
      action: input.action,
      actorId: input.actorId,
      reason: input.reason,
      replacesActivationId: input.replacesActivationId,
      createdAt: now
    };
  }

  private requireVersion(versionId: string) {
    const version = this.deps.versions.getById(versionId);
    if (!version) {
      throw new AppError({
        code: "NOT_FOUND",
        message: `Typed procedural version '${versionId}' was not found.`
      });
    }
    return version;
  }

  private toSummary(ruleId: string): TypedProceduralRuleSummary {
    const def = this.deps.definitions.getById(ruleId)!;
    const versions = this.deps.versions.listForRule(ruleId).map((v) => this.toVersionResponse(v));
    const active = versions.find((v) => v.isActive);
    return {
      ruleId: def.ruleId,
      ruleType: def.ruleType as RuleType,
      title: def.title,
      createdAt: def.createdAt,
      activeVersionId: active?.versionId,
      activeVersionNumber: active?.versionNumber,
      versions
    };
  }

  private toVersionResponse(
    version: NonNullable<ReturnType<ProceduralRuleVersionsRepository["getById"]>>
  ): TypedProceduralRuleVersionResponse {
    const def = this.deps.definitions.getById(version.ruleId)!;
    const latest = this.deps.activations.latestForRule(version.ruleId);
    const isActive =
      !!latest &&
      latest.versionId === version.versionId &&
      (latest.action === "activate" || latest.action === "rollback");
    let params: Record<string, unknown> = {};
    try {
      params = JSON.parse(version.paramsJson) as Record<string, unknown>;
    } catch {
      params = {};
    }
    return {
      versionId: version.versionId,
      ruleId: version.ruleId,
      ruleType: def.ruleType as RuleType,
      versionNumber: version.versionNumber,
      params,
      policyHash: version.policyHash,
      lifecycleStatus: version.lifecycleStatus as "proposed" | "replayed" | "approved",
      replayReportArtifactId: version.replayReportArtifactId ?? undefined,
      approvedBy: version.approvedBy ?? undefined,
      approvedAt: version.approvedAt ?? undefined,
      createdBy: version.createdBy,
      createdAt: version.createdAt,
      isActive
    };
  }
}
