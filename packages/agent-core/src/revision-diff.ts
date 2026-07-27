import type {
  AnalysisArea,
  FindingDiffEntry,
  RevisionDiff
} from "@maa/contracts";

export interface DiffFinding {
  findingId: string;
  analysisArea: string;
  statement: string;
  validationStatus: string;
}

/**
 * Build a before/after finding diff for affected areas only.
 * Prior findings outside affected areas are not reported as removed.
 */
export function buildRevisionDiff(input: {
  priorRunId: string;
  revisionRunId: string;
  affectedAreas: AnalysisArea[];
  priorFindings: DiffFinding[];
  newFindings: DiffFinding[];
}): RevisionDiff {
  const areaSet = new Set(input.affectedAreas);
  const entries: FindingDiffEntry[] = [];
  const now = new Date().toISOString();

  for (const area of input.affectedAreas) {
    const prior = input.priorFindings.filter((f) => f.analysisArea === area);
    const next = input.newFindings.filter((f) => f.analysisArea === area);

    if (prior.length === 0 && next.length === 0) {
      continue;
    }

    if (prior.length === 0) {
      for (const n of next) {
        entries.push({
          analysisArea: area,
          newFindingId: n.findingId,
          change: "added",
          newStatement: n.statement
        });
      }
      continue;
    }

    if (next.length === 0) {
      for (const p of prior) {
        entries.push({
          analysisArea: area,
          priorFindingId: p.findingId,
          change: "removed",
          priorStatement: p.statement
        });
      }
      continue;
    }

    // Pair by index within area for a clear before/after trace.
    const max = Math.max(prior.length, next.length);
    for (let i = 0; i < max; i += 1) {
      const p = prior[i];
      const n = next[i];
      if (p && n) {
        entries.push({
          analysisArea: area,
          priorFindingId: p.findingId,
          newFindingId: n.findingId,
          change: p.statement === n.statement ? "unchanged" : "replaced",
          priorStatement: p.statement,
          newStatement: n.statement
        });
      } else if (p) {
        entries.push({
          analysisArea: area,
          priorFindingId: p.findingId,
          change: "removed",
          priorStatement: p.statement
        });
      } else if (n) {
        entries.push({
          analysisArea: area,
          newFindingId: n.findingId,
          change: "added",
          newStatement: n.statement
        });
      }
    }
  }

  void areaSet;
  return {
    priorRunId: input.priorRunId,
    revisionRunId: input.revisionRunId,
    affectedAreas: input.affectedAreas,
    entries,
    evaluatedAt: now
  };
}
