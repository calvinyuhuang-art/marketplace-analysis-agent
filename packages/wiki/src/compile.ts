import type { WikiSection } from "@maa/contracts";

export interface CompileMemoryInput {
  memoryId: string;
  title: string;
  statement: string;
  authorityStatus: string;
  contradictionCount: number;
  analysisArea?: string;
  validUntil?: string | null;
}

export interface CompiledPageContent {
  contentMarkdown: string;
  sections: WikiSection[];
  sourceMemoryIds: string[];
}

const CITATION = (id: string) => ` [[mem:${id}]]`;

/**
 * Deterministic wiki page body from approved memory only.
 * Every substantive bullet cites a memory id.
 */
export function compilePageFromMemories(input: {
  pageTitle: string;
  path: string;
  memories: CompileMemoryInput[];
  now?: string;
}): CompiledPageContent {
  const now = input.now ?? new Date().toISOString();
  const approved = input.memories.filter((m) =>
    ["reusable_approved", "reviewed_project", "procedural_active"].includes(m.authorityStatus)
  );
  const rejectedOrExpired = input.memories.filter((m) =>
    ["rejected", "expired", "superseded"].includes(m.authorityStatus)
  );

  const known: WikiSection = {
    key: "known",
    title: "What we currently know",
    bodyMarkdown: "",
    memoryIds: [],
    openQuestions: [],
    contradictions: []
  };
  const contradictions: WikiSection = {
    key: "contradictions",
    title: "Contradictions and contested points",
    bodyMarkdown: "",
    memoryIds: [],
    openQuestions: [],
    contradictions: []
  };
  const open: WikiSection = {
    key: "open_questions",
    title: "Open questions",
    bodyMarkdown: "",
    memoryIds: [],
    openQuestions: [],
    contradictions: []
  };

  const lines: string[] = [
    `# ${input.pageTitle}`,
    "",
    `> Path: \`${input.path}\` · compiled ${now}`,
    "",
    "## What we currently know",
    ""
  ];

  if (approved.length === 0) {
    lines.push("_No approved memory linked to this page yet._");
    lines.push("");
    open.openQuestions.push("Awaiting approved reusable or project memory for this topic.");
  } else {
    for (const m of approved) {
      const bullet = `- ${m.statement.trim()}${CITATION(m.memoryId)}`;
      lines.push(bullet);
      known.memoryIds.push(m.memoryId);
      known.bodyMarkdown += `${bullet}\n`;
      if (m.contradictionCount > 0) {
        const note = `- Contested support around: ${m.statement.slice(0, 120)}${CITATION(m.memoryId)} (contradiction_count=${m.contradictionCount})`;
        contradictions.contradictions.push(note);
        contradictions.memoryIds.push(m.memoryId);
      }
      if (m.validUntil && m.validUntil < now) {
        open.openQuestions.push(
          `Memory ${m.memoryId} is past validUntil=${m.validUntil}; reaffirm or expire.`
        );
      }
    }
    lines.push("");
  }

  lines.push("## Contradictions and contested points", "");
  if (contradictions.contradictions.length === 0) {
    lines.push("_None disclosed from linked memory._");
  } else {
    for (const c of contradictions.contradictions) lines.push(c);
    contradictions.bodyMarkdown = contradictions.contradictions.join("\n");
  }
  lines.push("");

  lines.push("## Open questions", "");
  if (open.openQuestions.length === 0 && rejectedOrExpired.length === 0) {
    lines.push("_None._");
  } else {
    for (const q of open.openQuestions) {
      lines.push(`- ${q}`);
      open.bodyMarkdown += `- ${q}\n`;
    }
    for (const m of rejectedOrExpired) {
      const q = `- Rejected/expired memory retained for audit only (not current truth): ${m.memoryId}`;
      lines.push(q);
      open.openQuestions.push(q);
      open.bodyMarkdown += `${q}\n`;
    }
  }
  lines.push("");

  lines.push("## Sources", "");
  for (const id of known.memoryIds) {
    lines.push(`- ${id}`);
  }

  return {
    contentMarkdown: lines.join("\n"),
    sections: [known, contradictions, open],
    sourceMemoryIds: [...new Set(known.memoryIds)]
  };
}

export function extractMemoryCitations(markdown: string): string[] {
  const ids = new Set<string>();
  const re = /\[\[mem:([a-zA-Z0-9_]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    ids.add(m[1]!);
  }
  return [...ids];
}

export function extractInternalWikiLinks(markdown: string): string[] {
  const ids = new Set<string>();
  const re = /\[\[wiki:([a-z0-9\-/]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) {
    ids.add(m[1]!);
  }
  return [...ids];
}
