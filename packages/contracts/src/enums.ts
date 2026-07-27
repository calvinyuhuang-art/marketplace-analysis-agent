import { z } from "zod";

/**
 * Top-level operations the agent supports. This list is the allowlist: any
 * request whose operation is not in this enum must be rejected before a model
 * is ever called.
 */
export const OperationType = z.enum([
  "full_marketplace_analysis",
  "focused_analysis_question",
  "revise_analysis",
  "comparative_analysis",
  "evaluate_evidence_readiness",
  "propose_memory_update"
]);
export type OperationType = z.infer<typeof OperationType>;

/**
 * Supported analysis areas for the first capability pack. Every focused
 * question must declare at least one of these, and deterministic validation
 * confirms the requested area is allowed.
 */
export const AnalysisArea = z.enum([
  "market_structure",
  "competitor_set",
  "customer_evidence",
  "pricing",
  "positioning",
  "keywords_categories",
  "format_product_expectations",
  "listing_conversion",
  "risk_ip_policy",
  "opportunity_summary",
  "evidence_sufficiency"
]);
export type AnalysisArea = z.infer<typeof AnalysisArea>;

/**
 * Run lifecycle states. Allowed transitions are enforced in code by the
 * runtime state machine (see agent-core in later milestones).
 */
export const RunStatus = z.enum([
  "accepted",
  "planning",
  "recalling_memory",
  "evaluating_evidence",
  "awaiting_evidence",
  "analyzing",
  "reviewing_output",
  "proposing_memory",
  "completed",
  "partial",
  "evidence_insufficient",
  "needs_revision",
  "blocked",
  "cancelled",
  "failed"
]);
export type RunStatus = z.infer<typeof RunStatus>;
