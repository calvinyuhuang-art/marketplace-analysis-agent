import {
  IdPrefix,
  newId,
  type CreateMemoryProposal,
  type MemoryConflict,
  type MemoryProposal,
  type MemoryProposalReviewRequest,
  type MemoryScope
} from "@maa/contracts";
import type {
  FindingsRepository,
  MemoryItemsRepository,
  MemoryLinksRepository,
  MemoryProposalsRepository,
  MemoryScopesRepository,
  ProjectsRepository
} from "@maa/database";

export interface MemoryGovernorDeps {
  proposals: MemoryProposalsRepository;
  items: MemoryItemsRepository;
  scopes: MemoryScopesRepository;
  links: MemoryLinksRepository;
  findings: FindingsRepository;
  projects: ProjectsRepository;
  /** Optional hook when reusable memory becomes active (e.g. wiki patch proposals). */
  onReusableApproved?: (memoryId: string) => void;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2)
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

const NEGATION = /\b(not|never|no|without|unlike|contrary)\b/i;

/**
 * Detect overlapping / conflicting reusable memories for a proposal statement+scope.
 */
export function detectReusableConflicts(input: {
  statement: string;
  scopes: MemoryScope[];
  candidates: Array<{ memoryId: string; statement: string; scopes: MemoryScope[] }>;
}): MemoryConflict[] {
  const proposedTokens = tokenize(input.statement);
  const proposedDims = new Map(input.scopes.map((s) => [s.dimension, s.value]));
  const conflicts: MemoryConflict[] = [];

  for (const c of input.candidates) {
    const candDims = new Map(c.scopes.map((s) => [s.dimension, s.value]));
    let scopeOverlap = false;
    for (const dim of ["platform", "category", "product_type", "marketplace"] as const) {
      if (proposedDims.get(dim) && candDims.get(dim) === proposedDims.get(dim)) {
        scopeOverlap = true;
        break;
      }
    }
    if (!scopeOverlap) continue;

    const score = jaccard(proposedTokens, tokenize(c.statement));
    const negationFlip =
      (NEGATION.test(input.statement) && !NEGATION.test(c.statement)) ||
      (!NEGATION.test(input.statement) && NEGATION.test(c.statement));

    if (score >= 0.55) {
      conflicts.push({
        memoryId: c.memoryId,
        statement: c.statement,
        relation: negationFlip ? "possible_contradiction" : "possible_duplicate",
        score: Math.round(score * 100) / 100
      });
    } else if (score >= 0.25) {
      conflicts.push({
        memoryId: c.memoryId,
        statement: c.statement,
        relation: "overlapping_scope",
        score: Math.round(score * 100) / 100
      });
    }
  }

  return conflicts.sort((a, b) => b.score - a.score).slice(0, 10);
}

function parseJsonArray<T = unknown>(raw: string): T[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? (v as T[]) : [];
  } catch {
    return [];
  }
}

/**
 * Governed reusable-memory proposals. Analysis acceptance never auto-approves these.
 */
export class MemoryGovernorService {
  constructor(private readonly deps: MemoryGovernorDeps) {}

  createProposal(input: CreateMemoryProposal): MemoryProposal {
    const now = new Date().toISOString();
    const project = this.deps.projects.getById(input.projectId);
    if (!project) {
      throw new Error(`Project '${input.projectId}' was not found`);
    }

    let title = input.title;
    let statement = input.statement;
    let summary = input.summary;
    let confidence = input.confidence ?? 0.6;
    let evidenceIds = [...input.evidenceIds];
    let sourceMemoryId = input.sourceMemoryId;
    const sourceFindingId = input.sourceFindingId;

    if (sourceMemoryId) {
      const mem = this.deps.items.getById(sourceMemoryId);
      if (!mem) throw new Error(`Memory '${sourceMemoryId}' was not found`);
      title = title ?? mem.title;
      statement = statement ?? mem.statement;
      summary = summary ?? mem.summary ?? undefined;
      confidence = input.confidence ?? mem.confidence;
      const links = this.deps.links.listForMemory(sourceMemoryId);
      evidenceIds =
        evidenceIds.length > 0
          ? evidenceIds
          : links.filter((l) => l.targetType === "evidence").map((l) => l.targetId);
    }

    if (sourceFindingId) {
      const finding = this.deps.findings.getById(sourceFindingId);
      if (!finding) throw new Error(`Finding '${sourceFindingId}' was not found`);
      // Analysis acceptance is separate — only reviewed_accepted findings may be proposed.
      if (finding.validationStatus !== "reviewer_accepted") {
        throw new Error(
          "Only reviewer-accepted findings can be proposed for reusable memory."
        );
      }
      title = title ?? `Reusable: ${finding.analysisArea}`;
      statement = statement ?? finding.statement;
      summary = summary ?? finding.statement.slice(0, 200);
      confidence = input.confidence ?? finding.confidence;
      const payload = JSON.parse(finding.payloadJson) as { evidenceRefs?: string[] };
      if (evidenceIds.length === 0) evidenceIds = payload.evidenceRefs ?? [];
      if (!sourceMemoryId) {
        sourceMemoryId = this.deps.items.findByFindingId(sourceFindingId)?.memoryId;
      }
    }

    if (!statement || !title) {
      throw new Error("Proposal requires title and statement.");
    }

    const scopes: MemoryScope[] =
      input.scopes && input.scopes.length > 0
        ? input.scopes.filter((s) => s.dimension !== "project")
        : [
            ...(project.platform
              ? [{ dimension: "platform" as const, value: project.platform }]
              : []),
            ...(project.marketplace
              ? [{ dimension: "marketplace" as const, value: project.marketplace }]
              : []),
            ...(project.category
              ? [{ dimension: "category" as const, value: project.category }]
              : []),
            ...(project.productType
              ? [{ dimension: "product_type" as const, value: project.productType }]
              : []),
            ...(input.analysisArea
              ? [{ dimension: "analysis_area" as const, value: input.analysisArea }]
              : [])
          ];

    const reusable = this.deps.items.listReusableApprovedForScope({
      platform: project.platform,
      marketplace: project.marketplace,
      category: project.category,
      productType: project.productType
    });
    const conflicts = detectReusableConflicts({
      statement,
      scopes,
      candidates: reusable.map((m) => ({
        memoryId: m.memoryId,
        statement: m.statement,
        scopes: this.deps.scopes.listForMemory(m.memoryId) as MemoryScope[]
      }))
    });

    const proposalId = newId(IdPrefix.memoryProposal);
    this.deps.proposals.insert({
      proposalId,
      proposalType: input.proposalType,
      status: "proposed",
      projectId: input.projectId,
      sourceMemoryId: sourceMemoryId ?? null,
      sourceFindingId: sourceFindingId ?? null,
      title,
      statement,
      summary: summary ?? null,
      confidence,
      reason: input.reason,
      scopesJson: JSON.stringify(scopes),
      evidenceIdsJson: JSON.stringify(evidenceIds),
      conflictsJson: JSON.stringify(conflicts),
      proposedAuthority: "reusable_approved",
      validUntil: input.validUntil ?? null,
      resultingMemoryId: null,
      proposedBy: input.proposedBy,
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      createdAt: now,
      updatedAt: now
    });

    return this.toProposal(this.deps.proposals.getById(proposalId)!);
  }

  reviewProposal(
    proposalId: string,
    input: MemoryProposalReviewRequest
  ): MemoryProposal {
    const row = this.deps.proposals.getById(proposalId);
    if (!row) throw new Error(`Proposal '${proposalId}' was not found`);
    if (row.status !== "proposed") {
      throw new Error(`Proposal '${proposalId}' is already '${row.status}'`);
    }

    const now = new Date().toISOString();

    if (input.action === "reject" || input.action === "withdraw") {
      const updated = {
        ...row,
        status: input.action === "reject" ? "rejected" : "withdrawn",
        reviewedBy: input.reviewerId,
        reviewedAt: now,
        reviewNotes: input.notes ?? null,
        updatedAt: now
      };
      this.deps.proposals.update(updated);
      return this.toProposal(this.deps.proposals.getById(proposalId)!);
    }

    if (input.action === "supersede" && input.supersedesMemoryId) {
      const prior = this.deps.items.getById(input.supersedesMemoryId);
      if (prior) {
        this.deps.items.update({
          ...prior,
          authorityStatus: "superseded",
          updatedAt: now
        });
      }
    }

    // Approve (or supersede-as-approve): create versioned reusable memory — do not overwrite conflicts.
    const scopes = parseJsonArray<MemoryScope>(row.scopesJson);
    const evidenceIds = parseJsonArray<string>(row.evidenceIdsJson);
    const conflicts = parseJsonArray<MemoryConflict>(row.conflictsJson);
    const memoryId = newId(IdPrefix.memory);
    const versionId = newId(IdPrefix.memoryVersion);
    const validUntil = input.validUntil ?? row.validUntil;

    this.deps.items.insert({
      memoryId,
      memoryType: "reusable_semantic",
      authorityStatus: "reusable_approved",
      title: row.title,
      statement: row.statement,
      summary: row.summary,
      confidence: row.confidence,
      supportCount: 1,
      contradictionCount: conflicts.filter((c) => c.relation === "possible_contradiction")
        .length,
      validFrom: now,
      validUntil: validUntil ?? null,
      lastReaffirmedAt: now,
      createdFromRunId: null,
      createdFromLearningEventId: null,
      currentVersionId: versionId,
      payloadJson: JSON.stringify({
        proposalId: row.proposalId,
        sourceProjectId: row.projectId,
        sourceMemoryId: row.sourceMemoryId,
        sourceFindingId: row.sourceFindingId,
        versionId,
        conflicts
      }),
      createdAt: now,
      updatedAt: now
    });
    this.deps.scopes.replaceScopes(memoryId, scopes);
    for (const eid of evidenceIds) {
      this.deps.links.insert({
        memoryId,
        targetType: "evidence",
        targetId: eid,
        supportType: "supports",
        createdAt: now
      });
    }
    if (row.sourceFindingId) {
      this.deps.links.insert({
        memoryId,
        targetType: "finding",
        targetId: row.sourceFindingId,
        supportType: "derived_from",
        createdAt: now
      });
    }
    for (const c of conflicts) {
      this.deps.links.insert({
        memoryId,
        targetType: "memory",
        targetId: c.memoryId,
        supportType: c.relation === "possible_contradiction" ? "contradicts" : "supports",
        createdAt: now
      });
      const other = this.deps.items.getById(c.memoryId);
      if (other && c.relation === "possible_contradiction") {
        this.deps.items.update({
          ...other,
          contradictionCount: other.contradictionCount + 1,
          updatedAt: now
        });
      } else if (other && c.relation === "possible_duplicate") {
        this.deps.items.update({
          ...other,
          supportCount: other.supportCount + 1,
          updatedAt: now
        });
      }
    }

    if (input.action === "supersede" && input.supersedesMemoryId) {
      this.deps.links.insert({
        memoryId,
        targetType: "memory",
        targetId: input.supersedesMemoryId,
        supportType: "supersedes",
        createdAt: now
      });
    }

    this.deps.proposals.update({
      ...row,
      status: input.action === "supersede" ? "superseded" : "approved",
      resultingMemoryId: memoryId,
      validUntil: validUntil ?? null,
      reviewedBy: input.reviewerId,
      reviewedAt: now,
      reviewNotes: input.notes ?? null,
      updatedAt: now
    });

    this.deps.onReusableApproved?.(memoryId);

    return this.toProposal(this.deps.proposals.getById(proposalId)!);
  }

  listProposals(filter?: { projectId?: string; status?: string }): MemoryProposal[] {
    return this.deps.proposals.list(filter).map((r) => this.toProposal(r));
  }

  getProposal(proposalId: string): MemoryProposal | undefined {
    const row = this.deps.proposals.getById(proposalId);
    return row ? this.toProposal(row) : undefined;
  }

  private toProposal(row: NonNullable<ReturnType<MemoryProposalsRepository["getById"]>>): MemoryProposal {
    return {
      proposalId: row.proposalId,
      proposalType: row.proposalType as MemoryProposal["proposalType"],
      status: row.status as MemoryProposal["status"],
      projectId: row.projectId,
      sourceMemoryId: row.sourceMemoryId ?? undefined,
      sourceFindingId: row.sourceFindingId ?? undefined,
      title: row.title,
      statement: row.statement,
      summary: row.summary ?? undefined,
      confidence: row.confidence,
      reason: row.reason,
      scopes: parseJsonArray<MemoryScope>(row.scopesJson),
      evidenceIds: parseJsonArray<string>(row.evidenceIdsJson),
      conflicts: parseJsonArray<MemoryConflict>(row.conflictsJson),
      proposedAuthority: "reusable_approved",
      validUntil: row.validUntil ?? undefined,
      resultingMemoryId: row.resultingMemoryId ?? undefined,
      proposedBy: row.proposedBy,
      reviewedBy: row.reviewedBy ?? undefined,
      reviewedAt: row.reviewedAt ?? undefined,
      reviewNotes: row.reviewNotes ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
