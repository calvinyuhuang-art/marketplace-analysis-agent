import {
  IdPrefix,
  newId,
  type MemoryAuthorityStatus,
  type MemoryScope,
  type MemoryType
} from "@maa/contracts";
import type {
  FindingRow,
  MemoryItemsRepository,
  MemoryLinksRepository,
  MemoryScopesRepository,
  SqliteDatabase
} from "@maa/database";

export interface PromoteFindingInput {
  finding: FindingRow;
  projectId: string;
  platform?: string;
  marketplace?: string;
  category?: string;
  productType?: string;
  productName?: string;
  learningEventId?: string;
  action: "accept" | "reject";
}

/**
 * Upsert project memory from a finding review. Accepted findings become
 * reviewed_project knowledge; rejected become failure_correction (not active).
 */
export function upsertMemoryFromFindingReview(
  deps: {
    db: SqliteDatabase;
    items: MemoryItemsRepository;
    scopes: MemoryScopesRepository;
    links: MemoryLinksRepository;
  },
  input: PromoteFindingInput
): string {
  const now = new Date().toISOString();
  const existing = deps.items.findByFindingId(input.finding.findingId);

  const memoryType: MemoryType =
    input.action === "accept" ? "accepted_finding" : "failure_correction";
  const authority: MemoryAuthorityStatus =
    input.action === "accept" ? "reviewed_project" : "rejected";

  const title =
    input.action === "accept"
      ? `Accepted: ${input.finding.analysisArea}`
      : `Correction: ${input.finding.analysisArea}`;

  const statement =
    input.action === "accept"
      ? input.finding.statement
      : `Do not repeat rejected conclusion: ${input.finding.statement}`;

  const scopes: MemoryScope[] = [
    { dimension: "project", value: input.projectId },
    { dimension: "analysis_area", value: input.finding.analysisArea }
  ];
  if (input.platform) scopes.push({ dimension: "platform", value: input.platform });
  if (input.marketplace) scopes.push({ dimension: "marketplace", value: input.marketplace });
  if (input.category) scopes.push({ dimension: "category", value: input.category });
  if (input.productType) scopes.push({ dimension: "product_type", value: input.productType });
  if (input.productName) scopes.push({ dimension: "product", value: input.productName });

  const payload = JSON.parse(input.finding.payloadJson) as {
    evidenceRefs?: string[];
  };

  if (existing) {
    deps.items.update({
      ...existing,
      memoryType,
      authorityStatus: authority,
      title,
      statement,
      summary: input.finding.statement.slice(0, 200),
      confidence: input.finding.confidence,
      lastReaffirmedAt: now,
      createdFromLearningEventId: input.learningEventId ?? existing.createdFromLearningEventId,
      updatedAt: now
    });
    deps.scopes.replaceScopes(existing.memoryId, scopes);
    return existing.memoryId;
  }

  const memoryId = newId(IdPrefix.memory);
  deps.items.insert({
    memoryId,
    memoryType,
    authorityStatus: authority,
    title,
    statement,
    summary: input.finding.statement.slice(0, 200),
    confidence: input.finding.confidence,
    supportCount: (payload.evidenceRefs?.length ?? 0) > 0 ? 1 : 0,
    contradictionCount: 0,
    validFrom: now,
    validUntil: null,
    lastReaffirmedAt: now,
    createdFromRunId: input.finding.runId,
    createdFromLearningEventId: input.learningEventId ?? null,
    currentVersionId: null,
    payloadJson: JSON.stringify({ findingId: input.finding.findingId }),
    createdAt: now,
    updatedAt: now
  });
  deps.scopes.replaceScopes(memoryId, scopes);
  deps.links.insert({
    memoryId,
    targetType: "finding",
    targetId: input.finding.findingId,
    supportType: input.action === "accept" ? "derived_from" : "contradicts",
    createdAt: now
  });
  for (const evid of payload.evidenceRefs ?? []) {
    deps.links.insert({
      memoryId,
      targetType: "evidence",
      targetId: evid,
      supportType: "supports",
      createdAt: now
    });
  }
  return memoryId;
}

/**
 * Auto-save system_validated findings into project_working memory after analysis.
 */
export function saveWorkingMemoryFromFindings(
  deps: {
    items: MemoryItemsRepository;
    scopes: MemoryScopesRepository;
    links: MemoryLinksRepository;
  },
  input: {
    findings: FindingRow[];
    projectId: string;
    runId: string;
    platform?: string;
    marketplace?: string;
    category?: string;
    productType?: string;
  }
): string[] {
  const now = new Date().toISOString();
  const ids: string[] = [];
  for (const finding of input.findings) {
    if (finding.validationStatus === "reviewer_rejected") continue;
    if (deps.items.findByFindingId(finding.findingId)) continue;

    const memoryId = newId(IdPrefix.memory);
    deps.items.insert({
      memoryId,
      memoryType: "working_note",
      authorityStatus: "project_working",
      title: `Working: ${finding.analysisArea}`,
      statement: finding.statement,
      summary: finding.statement.slice(0, 200),
      confidence: finding.confidence,
      supportCount: 0,
      contradictionCount: 0,
      validFrom: now,
      validUntil: null,
      lastReaffirmedAt: now,
      createdFromRunId: input.runId,
      createdFromLearningEventId: null,
      currentVersionId: null,
      payloadJson: JSON.stringify({ findingId: finding.findingId, auto: true }),
      createdAt: now,
      updatedAt: now
    });
    const scopes: MemoryScope[] = [
      { dimension: "project", value: input.projectId },
      { dimension: "analysis_area", value: finding.analysisArea }
    ];
    if (input.platform) scopes.push({ dimension: "platform", value: input.platform });
    if (input.marketplace) scopes.push({ dimension: "marketplace", value: input.marketplace });
    if (input.category) scopes.push({ dimension: "category", value: input.category });
    if (input.productType) scopes.push({ dimension: "product_type", value: input.productType });
    deps.scopes.replaceScopes(memoryId, scopes);
    deps.links.insert({
      memoryId,
      targetType: "finding",
      targetId: finding.findingId,
      supportType: "derived_from",
      createdAt: now
    });
    ids.push(memoryId);
  }
  return ids;
}
