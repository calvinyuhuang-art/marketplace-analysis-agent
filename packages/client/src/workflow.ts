import type { ResearchAnalysisBrief } from "@maa/contracts";
import type { MarketplaceAnalysisClient } from "./client.js";
import type { PollOptions } from "./poll.js";
import {
  ResearchTeamMaaAdapter,
  type ResearchWorkOrderRecord
} from "./research-adapter.js";

/**
 * Idempotent create → poll → map workflow for Research Team.
 */
export async function runAnalysisWorkflow(input: {
  adapter: ResearchTeamMaaAdapter;
  client: MarketplaceAnalysisClient;
  workOrder: ResearchWorkOrderRecord;
  brief: ResearchAnalysisBrief;
  poll?: PollOptions;
}): Promise<{
  workOrder: ResearchWorkOrderRecord;
  view: Awaited<ReturnType<ResearchTeamMaaAdapter["refreshView"]>>;
}> {
  const { create } = await input.adapter.submitAnalysis(input.brief, input.workOrder);
  await input.client.pollRun(create.runId, {
    intervalMs: input.poll?.intervalMs ?? 50,
    timeoutMs: input.poll?.timeoutMs ?? 30_000,
    signal: input.poll?.signal,
    requestOpts: { correlationId: input.workOrder.correlationId }
  });
  const view = await input.adapter.refreshView(input.workOrder);
  return { workOrder: input.workOrder, view };
}

/**
 * Parse RESEARCH_TEAM_MAA_ENABLED-style flag.
 */
export function isResearchTeamMaaEnabled(
  env: Record<string, string | undefined> = process.env as Record<
    string,
    string | undefined
  >
): boolean {
  const raw = (env.RESEARCH_TEAM_MAA_ENABLED ?? env.MAA_RESEARCH_TEAM_ADAPTER ?? "false")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}
