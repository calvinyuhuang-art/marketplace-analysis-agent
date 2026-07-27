import { z } from "zod";

export const WikiPageStatus = z.enum(["draft", "published", "archived"]);
export type WikiPageStatus = z.infer<typeof WikiPageStatus>;

export const WikiProposalStatus = z.enum([
  "proposed",
  "approved",
  "rejected",
  "auto_published"
]);
export type WikiProposalStatus = z.infer<typeof WikiProposalStatus>;

export const WikiLintCode = z.enum([
  "missing_provenance",
  "rejected_or_expired_as_truth",
  "stale_page",
  "undisclosed_contradiction",
  "broken_internal_link",
  "orphan_page",
  "summary_inconsistent",
  "scope_too_broad",
  "procedural_without_active_rule"
]);
export type WikiLintCode = z.infer<typeof WikiLintCode>;

export const WikiSectionSchema = z.object({
  key: z.string(),
  title: z.string(),
  bodyMarkdown: z.string(),
  memoryIds: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  contradictions: z.array(z.string()).default([])
});
export type WikiSection = z.infer<typeof WikiSectionSchema>;

export const WikiPageSchema = z.object({
  pageId: z.string(),
  slug: z.string(),
  title: z.string(),
  parentPageId: z.string().optional(),
  path: z.string(),
  status: WikiPageStatus,
  currentVersionId: z.string().optional(),
  currentVersionNo: z.number().int().optional(),
  scope: z.record(z.string(), z.string()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type WikiPage = z.infer<typeof WikiPageSchema>;

export const WikiPageVersionSchema = z.object({
  versionId: z.string(),
  pageId: z.string(),
  versionNo: z.number().int().positive(),
  contentMarkdown: z.string(),
  sections: z.array(WikiSectionSchema).default([]),
  sourceMemoryIds: z.array(z.string()).default([]),
  changeReason: z.string().optional(),
  createdBy: z.string(),
  createdAt: z.string().datetime()
});
export type WikiPageVersion = z.infer<typeof WikiPageVersionSchema>;

export const WikiLintIssueSchema = z.object({
  issueId: z.string(),
  code: WikiLintCode,
  severity: z.enum(["info", "warning", "error"]),
  message: z.string(),
  pageId: z.string().optional(),
  path: z.string().optional(),
  memoryId: z.string().optional()
});
export type WikiLintIssue = z.infer<typeof WikiLintIssueSchema>;

export const WikiUpdateProposalSchema = z.object({
  proposalId: z.string(),
  pageId: z.string(),
  fromVersionId: z.string().optional(),
  status: WikiProposalStatus,
  title: z.string(),
  proposedContentMarkdown: z.string(),
  proposedSections: z.array(WikiSectionSchema).default([]),
  proposedSourceMemoryIds: z.array(z.string()).default([]),
  changeReason: z.string(),
  lintIssues: z.array(WikiLintIssueSchema).default([]),
  resultingVersionId: z.string().optional(),
  createdBy: z.string(),
  reviewedBy: z.string().optional(),
  reviewedAt: z.string().datetime().optional(),
  reviewNotes: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});
export type WikiUpdateProposal = z.infer<typeof WikiUpdateProposalSchema>;

export const WikiProposalReviewRequestSchema = z.object({
  action: z.enum(["approve", "reject"]),
  notes: z.string().optional(),
  reviewerId: z.string().min(1).default("operator")
});
export type WikiProposalReviewRequest = z.infer<typeof WikiProposalReviewRequestSchema>;

export const WikiLintRequestSchema = z.object({
  pageId: z.string().optional()
});
export type WikiLintRequest = z.infer<typeof WikiLintRequestSchema>;
