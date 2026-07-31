/** Soft display labels for run phases/statuses (runtime strings unchanged). */
const PHASE_DISPLAY_LABELS: Record<string, string> = {
  accepted: "Accepted",
  planning: "Planning",
  recalling_memory: "Memory recall",
  evaluating_evidence: "Evidence readiness",
  awaiting_evidence: "Awaiting evidence",
  analyzing: "Analyzing",
  reviewing_output: "Output review",
  proposing_memory: "Memory proposal",
  completed: "Completed",
  partial: "Partial",
  evidence_insufficient: "Evidence insufficient",
  needs_revision: "Needs revision",
  blocked: "Blocked",
  cancelled: "Cancelled",
  failed: "Failed"
};

export function phaseDisplayLabel(phaseOrStatus: string | null | undefined): string {
  if (!phaseOrStatus) return "Unknown";
  return PHASE_DISPLAY_LABELS[phaseOrStatus] ?? phaseOrStatus;
}
