import {
  IdPrefix,
  newId,
  type WikiLintIssue
} from "@maa/contracts";
import { extractInternalWikiLinks, extractMemoryCitations } from "./compile";

export interface LintPageInput {
  pageId: string;
  path: string;
  contentMarkdown: string;
  sourceMemoryIds: string[];
  memories: Array<{
    memoryId: string;
    authorityStatus: string;
    contradictionCount: number;
    validUntil?: string | null;
  }>;
  knownPaths: Set<string>;
  knownSlugs: Set<string>;
  hasChildren: boolean;
  referencedByOthers: boolean;
  now?: string;
  proceduralWithoutRule?: boolean;
}

/**
 * Deterministic wiki lint engine (plan §11.5).
 */
export function lintWikiPage(input: LintPageInput): WikiLintIssue[] {
  const now = input.now ?? new Date().toISOString();
  const issues: WikiLintIssue[] = [];
  const cited = extractMemoryCitations(input.contentMarkdown);
  const memById = new Map(input.memories.map((m) => [m.memoryId, m]));

  // Substantive bullets should cite memory.
  const bullets = input.contentMarkdown
    .split("\n")
    .filter((l) => l.trim().startsWith("- ") && !l.includes("Rejected/expired"));
  for (const line of bullets) {
    if (line.includes("_No approved memory") || line.includes("_None")) continue;
    if (!/\[\[mem:[a-zA-Z0-9_]+\]\]/.test(line) && line.length > 20) {
      issues.push({
        issueId: newId(IdPrefix.wikiLint),
        code: "missing_provenance",
        severity: "error",
        message: `Statement lacks approved memory citation: ${line.slice(0, 120)}`,
        pageId: input.pageId,
        path: input.path
      });
    }
  }

  for (const id of [...new Set([...cited, ...input.sourceMemoryIds])]) {
    const mem = memById.get(id);
    if (!mem) {
      issues.push({
        issueId: newId(IdPrefix.wikiLint),
        code: "missing_provenance",
        severity: "error",
        message: `Cited memory '${id}' was not found.`,
        pageId: input.pageId,
        path: input.path,
        memoryId: id
      });
      continue;
    }
    if (["rejected", "expired", "superseded"].includes(mem.authorityStatus)) {
      // Allowed only in open-questions audit lines; flag if presented as known truth.
      const knownSection = input.contentMarkdown.split("## Contradictions")[0] ?? "";
      if (knownSection.includes(`[[mem:${id}]]`)) {
        issues.push({
          issueId: newId(IdPrefix.wikiLint),
          code: "rejected_or_expired_as_truth",
          severity: "error",
          message: `Memory '${id}' has authority '${mem.authorityStatus}' and cannot publish as current truth.`,
          pageId: input.pageId,
          path: input.path,
          memoryId: id
        });
      }
    }
    if (mem.validUntil && mem.validUntil < now) {
      issues.push({
        issueId: newId(IdPrefix.wikiLint),
        code: "stale_page",
        severity: "warning",
        message: `Linked memory '${id}' is past validUntil=${mem.validUntil}.`,
        pageId: input.pageId,
        path: input.path,
        memoryId: id
      });
    }
    if (
      mem.contradictionCount > 0 &&
      !input.contentMarkdown.toLowerCase().includes("contradiction")
    ) {
      issues.push({
        issueId: newId(IdPrefix.wikiLint),
        code: "undisclosed_contradiction",
        severity: "warning",
        message: `Memory '${id}' has contradictions but page does not disclose them.`,
        pageId: input.pageId,
        path: input.path,
        memoryId: id
      });
    }
  }

  for (const link of extractInternalWikiLinks(input.contentMarkdown)) {
    const ok =
      input.knownPaths.has(link) ||
      input.knownPaths.has(`/${link}`) ||
      input.knownSlugs.has(link.split("/").pop() ?? "");
    if (!ok) {
      issues.push({
        issueId: newId(IdPrefix.wikiLint),
        code: "broken_internal_link",
        severity: "error",
        message: `Broken internal wiki link: ${link}`,
        pageId: input.pageId,
        path: input.path
      });
    }
  }

  if (!input.hasChildren && !input.referencedByOthers && cited.length === 0) {
    // Leaf with no content and no inbound refs — soft orphan signal when empty known section
    if (input.contentMarkdown.includes("_No approved memory")) {
      issues.push({
        issueId: newId(IdPrefix.wikiLint),
        code: "orphan_page",
        severity: "info",
        message: `Page '${input.path}' has no approved memory sources yet.`,
        pageId: input.pageId,
        path: input.path
      });
    }
  }

  if (input.proceduralWithoutRule) {
    issues.push({
      issueId: newId(IdPrefix.wikiLint),
      code: "procedural_without_active_rule",
      severity: "error",
      message: "Procedural guidance present without an active procedural rule.",
      pageId: input.pageId,
      path: input.path
    });
  }

  return issues;
}
