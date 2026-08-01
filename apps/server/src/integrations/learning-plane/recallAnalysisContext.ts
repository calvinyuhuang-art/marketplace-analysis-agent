import type { AnalysisArea, MemoryPromptItem, ProceduralRulePromptItem } from "@maa/contracts";
import type { MemoryService } from "@maa/memory";
import type { PublishedKnowledgeBridgeService } from "./publishedKnowledgeBridgeService.js";
import { appendExternalKnowledgeSection } from "./appendExternalKnowledgeSection.js";

export type RecallAnalysisContextInput = {
  runId: string;
  projectId: string;
  query: string;
  scope: {
    projectId: string;
    platform?: string;
    marketplace?: string;
    category?: string;
    productType?: string;
    analysisAreas: AnalysisArea[];
  };
  requestedAreas: AnalysisArea[];
  proceduralRules?: ProceduralRulePromptItem[];
};

export type RecallAnalysisContextResult = {
  approved: MemoryPromptItem[];
  failureCorrections: MemoryPromptItem[];
  proceduralRules: ProceduralRulePromptItem[];
  assemblyId: string;
  externalKnowledgeSection: string;
  combinedMemorySection: string;
};

export function recallAnalysisContextForRun(
  memory: MemoryService,
  bridge: PublishedKnowledgeBridgeService | null | undefined,
  input: RecallAnalysisContextInput
): RecallAnalysisContextResult {
  const recall = memory.recallForRun({
    runId: input.runId,
    projectId: input.projectId,
    query: input.query,
    scope: input.scope,
    requestedAreas: input.requestedAreas,
    proceduralRules: input.proceduralRules
  });

  const localSection = recall.approved
    .map((item) => `[${item.memoryId}] ${item.title}: ${item.statement}`)
    .join("\n");

  let externalKnowledgeSection = "";
  if (bridge) {
    try {
      externalKnowledgeSection = bridge.assembleExternalKnowledgeForRun({
        runId: input.runId,
        query: input.query,
        maxItems: 2
      }).section;
    } catch {
      externalKnowledgeSection = "";
    }
  }

  return {
    approved: recall.approved,
    failureCorrections: recall.failureCorrections,
    proceduralRules: input.proceduralRules ?? [],
    assemblyId: recall.assembly.assemblyId,
    externalKnowledgeSection,
    combinedMemorySection: appendExternalKnowledgeSection(localSection, externalKnowledgeSection)
  };
}
