import type {
  MemoryAuthorityStatus,
  MemoryScope,
  RankComponentScores
} from "@maa/contracts";
import type { MemoryItemRow } from "@maa/database";

const AUTHORITY_WEIGHT: Record<string, number> = {
  reviewed_project: 1,
  project_working: 0.7,
  reusable_approved: 0.95,
  procedural_active: 1,
  contested: 0.3,
  raw_record: 0.2,
  reusable_proposed: 0.4,
  procedural_proposed: 0.4,
  rejected: 0,
  superseded: 0,
  expired: 0
};

export interface ScopeQuery {
  projectId: string;
  platform?: string;
  marketplace?: string;
  category?: string;
  productType?: string;
  analysisAreas?: string[];
}

export function scopeMatchScore(
  scopes: MemoryScope[],
  query: ScopeQuery
): { score: number; breadth: number } {
  if (scopes.length === 0) return { score: 0.2, breadth: 1 };

  let hits = 0;
  let relevant = 0;
  const byDim = new Map(scopes.map((s) => [s.dimension, s.value]));

  const checks: Array<[MemoryScope["dimension"], string | undefined]> = [
    ["project", query.projectId],
    ["platform", query.platform],
    ["marketplace", query.marketplace],
    ["category", query.category],
    ["product_type", query.productType]
  ];
  for (const [dim, want] of checks) {
    if (!want) continue;
    relevant += 1;
    if (byDim.get(dim) === want) hits += 1;
  }

  if (query.analysisAreas && query.analysisAreas.length > 0) {
    relevant += 1;
    const area = byDim.get("analysis_area");
    if (area && query.analysisAreas.includes(area)) hits += 1;
  }

  const score = relevant === 0 ? 0.5 : hits / relevant;
  // Narrower (fewer dimensions that are wildcards) → higher rank via lower breadth.
  const breadth = scopes.length;
  return { score, breadth };
}

export function rankMemoryItem(input: {
  item: MemoryItemRow;
  scopes: MemoryScope[];
  query: ScopeQuery;
  textRelevance: number;
  now?: string;
}): { score: number; components: RankComponentScores } {
  const now = input.now ?? new Date().toISOString();
  const { score: scopeMatch, breadth } = scopeMatchScore(input.scopes, input.query);
  const authorityWeight = AUTHORITY_WEIGHT[input.item.authorityStatus] ?? 0.1;

  let freshness = 0.8;
  let stalenessPenalty = 0;
  if (input.item.validUntil && input.item.validUntil < now) {
    freshness = 0;
    stalenessPenalty = 0.5;
  } else if (input.item.lastReaffirmedAt) {
    const ageDays =
      (Date.parse(now) - Date.parse(input.item.lastReaffirmedAt)) / (86400 * 1000);
    freshness = ageDays > 180 ? 0.4 : ageDays > 90 ? 0.6 : 0.9;
  }

  const supportStrength = Math.min(1, input.item.supportCount / 3);
  const contradictionPenalty = Math.min(0.5, input.item.contradictionCount * 0.15);
  const broadScopePenalty = breadth <= 2 ? 0 : Math.min(0.25, (breadth - 2) * 0.05);

  const components: RankComponentScores = {
    scopeMatch,
    authorityWeight,
    textRelevance: input.textRelevance,
    freshness,
    confidence: input.item.confidence,
    supportStrength,
    demonstratedUsefulness: 0.5,
    stalenessPenalty,
    contradictionPenalty,
    broadScopePenalty
  };

  const score =
    0.3 * components.scopeMatch +
    0.2 * components.authorityWeight +
    0.15 * components.textRelevance +
    0.1 * components.freshness +
    0.1 * components.confidence +
    0.05 * components.supportStrength +
    0.1 * components.demonstratedUsefulness -
    components.stalenessPenalty -
    components.contradictionPenalty -
    components.broadScopePenalty;

  return { score: Math.round(score * 1000) / 1000, components };
}

export function isActiveAuthority(status: MemoryAuthorityStatus | string): boolean {
  return !["rejected", "superseded", "expired"].includes(status);
}
