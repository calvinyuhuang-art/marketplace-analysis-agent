import { randomUUID } from "node:crypto";

/**
 * Sortable-ish unique identifiers with a type prefix for readability in logs
 * and the console. V1 uses UUIDv4 with a monotonic time prefix; this satisfies
 * "unique and safe for distributed clients" while remaining dependency-free.
 * A stricter UUIDv7/ULID can replace the body without changing call sites.
 */
export function newId(prefix: string): string {
  const time = Date.now().toString(36).padStart(9, "0");
  const rand = randomUUID().replace(/-/g, "").slice(0, 16);
  return `${prefix}_${time}${rand}`;
}

export const IdPrefix = {
  project: "proj",
  request: "req",
  run: "run",
  attempt: "att",
  event: "evt",
  audit: "aud",
  artifact: "art",
  correlation: "corr",
  execution: "exec",
  lock: "lock",
  modelCall: "mc",
  toolCall: "tc",
  evidencePackage: "evpkg",
  evidenceItem: "evid",
  collectionRequest: "creq",
  gap: "gap",
  finding: "fnd",
  output: "out",
  review: "rev",
  learning: "learn",
  diff: "diff",
  memory: "mem",
  memoryVersion: "mver",
  retrieval: "mret",
  assembly: "ctx",
  memoryUsage: "musg",
  outcomeReview: "orev",
  lesson: "les",
  errorBook: "errb",
  proceduralRule: "prule",
  memoryEval: "meval",
  memoryProposal: "mprop",
  wikiPage: "wpage",
  wikiVersion: "wver",
  wikiProposal: "wprop",
  wikiLint: "wlint",
  wikiLink: "wlink",
  experience: "exp",
  evaluation: "eval",
  evidencePlan: "eplan",
  evidencePlanReview: "eprev",
  workflowFeedback: "wfb",
  gapFingerprint: "gfp",
  proceduralRuleDef: "prdef",
  proceduralRuleVersion: "prver",
  proceduralActivation: "pract",
  outcome: "outc",
  outcomeReassessment: "oreas"
} as const;
