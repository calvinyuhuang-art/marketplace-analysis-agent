import { createHash } from "node:crypto";
import { AppError } from "@maa/contracts";

export const REVIEWED_AUTHORITIES = new Set([
  "reviewed_project",
  "reusable_approved",
  "procedural_active"
]);

const SECRET_LIKE =
  /(api[_-]?key|password|secret|token|credential|private[_-]?key)/i;
const EXECUTABLE_LIKE =
  /```|function\s*\(|eval\(|exec\(|DROP\s+TABLE|rm\s+-rf|<script|ignore previous instructions/i;

export type MaaSourceMemory = {
  memoryId: string;
  memoryType: string;
  authorityStatus: string;
  title: string;
  statement: string;
  summary?: string;
  confidence: number;
  updatedAt?: string;
};

export type MappedPublicationProposal = {
  sourceRecordId: string;
  sourceRecordVersion: string;
  sourceRecordSha256: string;
  knowledgeType:
    | "semantic_fact"
    | "failure_pattern"
    | "operational_warning"
    | "procedural_guidance"
    | "outcome_insight"
    | "example_reference"
    | "capability_limitation";
  title: string;
  summary: string;
  scope: "agent_group" | "agent_private";
  authority:
    | "agent_observation"
    | "deterministically_evaluated"
    | "human_reviewed"
    | "replay_supported"
    | "outcome_supported"
    | "approved_operational_knowledge";
  confidence: number;
  tags: string[];
  applicabilityConditions: string[];
  limitations: string[];
  packageBody: {
    format: "structured_text";
    sections: Array<{ heading: string; content: string }>;
    nonExecutable: true;
  };
  sourceReferences: Array<{
    referenceId: string;
    kind: string;
    reference: string;
    summary?: string;
  }>;
  evidenceReferences: Array<{
    evidenceId: string;
    kind: string;
    reference: string;
    summary?: string;
  }>;
  freshnessPolicy: {
    validFrom: string;
    reviewAfter: string;
    expiresAt: string | null;
    staleAfterDays: number;
  };
};

function rejectUnsafe(text: string, field: string): void {
  if (SECRET_LIKE.test(text)) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      message: `Secret-like content rejected in ${field}. Unsafe proposals are rejected wholly.`
    });
  }
  if (EXECUTABLE_LIKE.test(text)) {
    throw new AppError({
      code: "VALIDATION_ERROR",
      message: `Executable or instruction-like content rejected in ${field}.`
    });
  }
}

export function mapMemoryTypeToKnowledgeType(
  memoryType: string
): MappedPublicationProposal["knowledgeType"] {
  switch (memoryType) {
    case "failure_correction":
    case "failure_pattern":
      return "failure_pattern";
    case "capability_note":
    case "capability_limitation":
      return "capability_limitation";
    case "operational_warning":
    case "validation_caution":
      return "operational_warning";
    case "procedural_guidance":
    case "procedure":
      return "procedural_guidance";
    case "outcome_insight":
      return "outcome_insight";
    case "example":
      return "example_reference";
    default:
      return "semantic_fact";
  }
}

export function assertPublicationEligible(memory: MaaSourceMemory): void {
  if (!REVIEWED_AUTHORITIES.has(memory.authorityStatus)) {
    throw new AppError({
      code: "INVALID_STATE_TRANSITION",
      message:
        "Only reviewed_project, reusable_approved, or procedural_active memory may be considered for publication."
    });
  }
  rejectUnsafe(memory.title, "title");
  rejectUnsafe(memory.statement, "statement");
  if (memory.summary) rejectUnsafe(memory.summary, "summary");
}

export function buildPublicationProposalFromMemory(input: {
  memory: MaaSourceMemory;
  scope?: "agent_group" | "agent_private";
  targetAgentHint?: string;
  version?: string;
}): MappedPublicationProposal {
  assertPublicationEligible(input.memory);
  const knowledgeType = mapMemoryTypeToKnowledgeType(input.memory.memoryType);
  const version = input.version ?? "1";
  const sourceRecordId = `maa-memory:${input.memory.memoryId}`;
  const canonical = JSON.stringify({
    memoryId: input.memory.memoryId,
    version,
    title: input.memory.title,
    statement: input.memory.statement,
    summary: input.memory.summary ?? null,
    knowledgeType
  });
  const sourceRecordSha256 = createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex");
  const now = new Date();
  const reviewAfter = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const limitations =
    knowledgeType === "procedural_guidance"
      ? [
          "Package is non-executable guidance only.",
          "Does not activate MAA rules or workflows."
        ]
      : [
          "Untrusted external published knowledge when shared.",
          "Does not create receiving-agent memory or rules."
        ];
  const applicability = [
    ...(input.targetAgentHint ? [`target_agent=${input.targetAgentHint}`] : []),
    "source=marketplace-analysis-agent"
  ];

  return {
    sourceRecordId,
    sourceRecordVersion: version,
    sourceRecordSha256,
    knowledgeType,
    title: input.memory.title.slice(0, 256),
    summary: (input.memory.summary ?? input.memory.statement).slice(0, 4000),
    scope: input.scope ?? "agent_group",
    authority: "human_reviewed",
    confidence: Math.min(1, Math.max(0, input.memory.confidence)),
    tags: ["maa", "published-knowledge", knowledgeType],
    applicabilityConditions: applicability,
    limitations,
    packageBody: {
      format: "structured_text",
      sections: [
        {
          heading: "Statement",
          content: input.memory.statement.slice(0, 8000)
        }
      ],
      nonExecutable: true
    },
    sourceReferences: [
      {
        referenceId: `src_${input.memory.memoryId}`,
        kind: "local_memory",
        reference: sourceRecordId,
        summary: "MAA reviewed local memory pointer"
      }
    ],
    evidenceReferences: [
      {
        evidenceId: `ev_${input.memory.memoryId}`,
        kind: "local_review",
        reference: `authority:${input.memory.authorityStatus}`,
        summary: "Local reviewed authority status"
      }
    ],
    freshnessPolicy: {
      validFrom: now.toISOString(),
      reviewAfter: reviewAfter.toISOString(),
      expiresAt: expiresAt.toISOString(),
      staleAfterDays: 30
    }
  };
}
