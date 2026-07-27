import type { ArtifactStore } from "@maa/artifacts";
import {
  IdPrefix,
  newId,
  type AnalysisArea,
  type ContextAssembly,
  type MemoryCandidate,
  type MemoryItem,
  type MemoryPromptItem,
  type MemoryRetrievalTrace,
  type MemoryScope
} from "@maa/contracts";
import type {
  ArtifactsRepository,
  ContextAssembliesRepository,
  MemoryItemsRepository,
  MemoryLinksRepository,
  MemoryRetrievalEventsRepository,
  MemoryScopesRepository,
  MemoryUsageEventsRepository
} from "@maa/database";
import { buildFtsMatchQuery, estimateTokens } from "./fts";
import { isActiveAuthority, rankMemoryItem, type ScopeQuery } from "./rank";

export interface MemoryServiceDeps {
  items: MemoryItemsRepository;
  scopes: MemoryScopesRepository;
  links: MemoryLinksRepository;
  retrievalEvents: MemoryRetrievalEventsRepository;
  assemblies: ContextAssembliesRepository;
  usageEvents: MemoryUsageEventsRepository;
  artifacts: ArtifactsRepository;
  artifactStore: ArtifactStore;
  defaultTokenBudget?: number;
}

export interface RetrieveInput {
  runId: string;
  projectId: string;
  query: string;
  scope: ScopeQuery;
  requestedAreas: AnalysisArea[];
  tokenBudget?: number;
  proceduralRules?: import("@maa/contracts").ProceduralRulePromptItem[];
}

function toMemoryItem(
  row: ReturnType<MemoryItemsRepository["getById"]> & object,
  scopes: MemoryScope[],
  links: Array<{ targetType: string; targetId: string; supportType: string }>
): MemoryItem {
  return {
    memoryId: row.memoryId,
    memoryType: row.memoryType as MemoryItem["memoryType"],
    authorityStatus: row.authorityStatus as MemoryItem["authorityStatus"],
    title: row.title,
    statement: row.statement,
    summary: row.summary ?? undefined,
    confidence: row.confidence,
    supportCount: row.supportCount,
    contradictionCount: row.contradictionCount,
    scopes,
    evidenceIds: links.filter((l) => l.targetType === "evidence").map((l) => l.targetId),
    findingIds: links.filter((l) => l.targetType === "finding").map((l) => l.targetId),
    createdFromRunId: row.createdFromRunId ?? undefined,
    createdFromLearningEventId: row.createdFromLearningEventId ?? undefined,
    validFrom: row.validFrom ?? undefined,
    validUntil: row.validUntil ?? undefined,
    lastReaffirmedAt: row.lastReaffirmedAt ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export class MemoryService {
  constructor(private readonly deps: MemoryServiceDeps) {}

  getProjectMemory(projectId: string): MemoryItem[] {
    return this.deps.items.listByProject(projectId).map((row) => {
      const scopes = this.deps.scopes.listForMemory(row.memoryId) as MemoryScope[];
      const links = this.deps.links.listForMemory(row.memoryId);
      return toMemoryItem(row, scopes, links);
    });
  }

  /**
   * Deterministic retrieval + token-bounded context assembly with full trace.
   */
  recallForRun(input: RetrieveInput): {
    assembly: ContextAssembly;
    trace: MemoryRetrievalTrace;
    approved: MemoryPromptItem[];
    failureCorrections: MemoryPromptItem[];
  } {
    const now = new Date().toISOString();
    const tokenBudget = input.tokenBudget ?? this.deps.defaultTokenBudget ?? 4000;
    const match = buildFtsMatchQuery(input.query);

    const projectRows = this.deps.items.listByProject(input.projectId);
    const reusableRows = this.deps.items.listReusableApprovedForScope({
      platform: input.scope.platform,
      marketplace: input.scope.marketplace,
      category: input.scope.category,
      productType: input.scope.productType
    });
    const seen = new Set(projectRows.map((r) => r.memoryId));
    const candidateRows = [
      ...projectRows,
      ...reusableRows.filter((r) => !seen.has(r.memoryId))
    ];

    let ftsHits = new Map<string, number>();
    if (match !== '""') {
      try {
        const hits = this.deps.items.searchFts(match, 40);
        hits.forEach((h, idx) => {
          ftsHits.set(h.memoryId, Math.max(0.2, 1 - idx * 0.05));
        });
      } catch {
        ftsHits = new Map();
      }
    }

    const candidates: MemoryCandidate[] = [];
    const ranked: Array<{
      item: MemoryItem;
      row: (typeof candidateRows)[0];
      score: number;
      components: MemoryCandidate["components"];
      textRelevance: number;
    }> = [];

    for (const row of candidateRows) {
      const scopes = this.deps.scopes.listForMemory(row.memoryId) as MemoryScope[];
      const links = this.deps.links.listForMemory(row.memoryId);
      const item = toMemoryItem(row, scopes, links);
      const textRelevance = ftsHits.get(row.memoryId) ?? (match === '""' ? 0.5 : 0.05);
      const { score, components } = rankMemoryItem({
        item: row,
        scopes,
        query: input.scope,
        textRelevance,
        now
      });

      const inactive = !isActiveAuthority(row.authorityStatus);
      const isFailure = row.memoryType === "failure_correction";
      const isStaleReusable =
        row.authorityStatus === "reusable_approved" &&
        !!row.validUntil &&
        row.validUntil < now;

      if (inactive && !isFailure) {
        candidates.push({
          memoryId: row.memoryId,
          selected: false,
          score,
          components,
          omitReason: `authority '${row.authorityStatus}' is not active knowledge`
        });
        continue;
      }

      if (isStaleReusable) {
        candidates.push({
          memoryId: row.memoryId,
          selected: false,
          score,
          components,
          omitReason: "stale reusable knowledge (validUntil elapsed)"
        });
        continue;
      }

      ranked.push({ item, row, score, components, textRelevance });
      candidates.push({
        memoryId: row.memoryId,
        selected: false,
        score,
        components
      });
    }

    ranked.sort((a, b) => b.score - a.score);

    // Prefer narrow scope (already penalized in score). Build sections with budgets.
    const approvedBudget = Math.floor(tokenBudget * 0.15);
    const failureBudget = Math.floor(tokenBudget * 0.07);
    const approved: MemoryPromptItem[] = [];
    const failureCorrections: MemoryPromptItem[] = [];
    const omitted: Array<{ memoryId: string; reason: string }> = [];
    let approvedTokens = 0;
    let failureTokens = 0;

    for (const r of ranked) {
      const promptItem: MemoryPromptItem = {
        memoryId: r.item.memoryId,
        memoryType: r.item.memoryType,
        authorityStatus: r.item.authorityStatus,
        title: r.item.title,
        statement: r.item.statement.slice(0, 500),
        analysisArea: r.item.scopes.find((s) => s.dimension === "analysis_area")?.value,
        confidence: r.item.confidence
      };
      const cost = estimateTokens(`${promptItem.title} ${promptItem.statement}`);

      if (r.item.memoryType === "failure_correction") {
        if (failureTokens + cost <= failureBudget) {
          failureCorrections.push(promptItem);
          failureTokens += cost;
          const c = candidates.find((x) => x.memoryId === r.item.memoryId);
          if (c) {
            c.selected = true;
            c.finalRank = failureCorrections.length;
          }
        } else {
          omitted.push({ memoryId: r.item.memoryId, reason: "failure_lessons token budget" });
          const c = candidates.find((x) => x.memoryId === r.item.memoryId);
          if (c) c.omitReason = "failure_lessons token budget";
        }
        continue;
      }

      if (!isActiveAuthority(r.item.authorityStatus)) {
        omitted.push({
          memoryId: r.item.memoryId,
          reason: `authority '${r.item.authorityStatus}' excluded from approved memory`
        });
        continue;
      }

      // Exclude irrelevant: very low score without FTS hit when query present
      if (match !== '""' && r.score < 0.25 && r.textRelevance < 0.2) {
        omitted.push({ memoryId: r.item.memoryId, reason: "irrelevant to query / low rank" });
        const c = candidates.find((x) => x.memoryId === r.item.memoryId);
        if (c) c.omitReason = "irrelevant to query / low rank";
        continue;
      }

      if (approvedTokens + cost <= approvedBudget) {
        approved.push(promptItem);
        approvedTokens += cost;
        const c = candidates.find((x) => x.memoryId === r.item.memoryId);
        if (c) {
          c.selected = true;
          c.finalRank = approved.length;
        }
      } else {
        omitted.push({ memoryId: r.item.memoryId, reason: "approved_memory token budget" });
        const c = candidates.find((x) => x.memoryId === r.item.memoryId);
        if (c) c.omitReason = "approved_memory token budget";
      }
    }

    const selectedMemoryIds = [
      ...approved.map((a) => a.memoryId),
      ...failureCorrections.map((a) => a.memoryId)
    ];

    const proceduralRules = input.proceduralRules ?? [];
    const proceduralTokens = proceduralRules.reduce(
      (n, r) => n + estimateTokens(`${r.title} ${r.statement}`),
      0
    );

    const assemblyId = newId(IdPrefix.assembly);
    const retrievalEventId = newId(IdPrefix.retrieval);

    const sections: ContextAssembly["sections"] = [
      {
        name: "approved_semantic_memory",
        tokenEstimate: approvedTokens,
        budgetShare: 0.15,
        memoryIds: approved.map((a) => a.memoryId),
        content: approved
      },
      {
        name: "failure_lessons",
        tokenEstimate: failureTokens,
        budgetShare: 0.07,
        memoryIds: failureCorrections.map((a) => a.memoryId),
        content: failureCorrections
      }
    ];
    if (proceduralRules.length > 0) {
      sections.push({
        name: "procedural_rules",
        tokenEstimate: proceduralTokens,
        budgetShare: 0.1,
        memoryIds: proceduralRules.map((r) => r.proceduralRuleId),
        content: proceduralRules
      });
    }

    const assembly: ContextAssembly = {
      assemblyId,
      runId: input.runId,
      analysisAreas: input.requestedAreas,
      tokenBudget,
      sections,
      selectedMemoryIds,
      omitted,
      createdAt: now
    };

    const artifact = this.deps.artifactStore.writeJson(assembly, {
      subdir: "context-assemblies",
      accessClass: "internal"
    });
    this.deps.artifacts.insert({
      artifactId: artifact.artifactId,
      relativePath: artifact.relativePath,
      contentHash: artifact.contentHash,
      mimeType: artifact.mimeType,
      sizeBytes: artifact.sizeBytes,
      redactionStatus: artifact.redactionStatus,
      accessClass: artifact.accessClass,
      relatedRunId: input.runId,
      createdAt: artifact.createdAt
    });
    assembly.artifactId = artifact.artifactId;

    this.deps.assemblies.insert({
      assemblyId,
      runId: input.runId,
      projectId: input.projectId,
      tokenBudget,
      payloadJson: JSON.stringify(assembly),
      artifactId: artifact.artifactId,
      createdAt: now
    });

    const trace: MemoryRetrievalTrace = {
      retrievalEventId,
      runId: input.runId,
      projectId: input.projectId,
      query: input.query,
      filters: {
        match,
        scope: input.scope,
        requestedAreas: input.requestedAreas
      },
      candidates,
      selectedMemoryIds,
      contextAssemblyId: assemblyId,
      createdAt: now
    };

    this.deps.retrievalEvents.insert({
      retrievalEventId,
      runId: input.runId,
      projectId: input.projectId,
      query: input.query,
      filtersJson: JSON.stringify(trace.filters),
      candidatesJson: JSON.stringify(candidates),
      selectedJson: JSON.stringify(selectedMemoryIds),
      contextAssemblyId: assemblyId,
      createdAt: now
    });

    for (const id of selectedMemoryIds) {
      this.deps.usageEvents.insert({
        usageEventId: newId(IdPrefix.memoryUsage),
        runId: input.runId,
        memoryId: id,
        usageKind: "included_in_context",
        detailJson: JSON.stringify({ assemblyId }),
        createdAt: now
      });
    }

    return { assembly, trace, approved, failureCorrections };
  }
}
