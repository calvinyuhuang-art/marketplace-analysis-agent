import { describe, expect, it } from "vitest";
import { compilePageFromMemories, extractMemoryCitations } from "./compile";
import { lintWikiPage } from "./lint";

describe("wiki compile + lint", () => {
  it("cites approved memory on every known bullet", () => {
    const compiled = compilePageFromMemories({
      pageTitle: "Pricing",
      path: "/amazon-us/books/adult-coloring-books/pricing-and-format",
      memories: [
        {
          memoryId: "mem_ok",
          title: "Price band",
          statement: "Paperback coloring books cluster near $9.99-$12.99.",
          authorityStatus: "reusable_approved",
          contradictionCount: 0
        }
      ]
    });
    expect(compiled.sourceMemoryIds).toContain("mem_ok");
    expect(compiled.contentMarkdown).toContain("[[mem:mem_ok]]");
    expect(extractMemoryCitations(compiled.contentMarkdown)).toContain("mem_ok");
  });

  it("flags missing provenance and rejected-as-truth", () => {
    const issues = lintWikiPage({
      pageId: "wpage_1",
      path: "/x",
      contentMarkdown: `# X\n\n## What we currently know\n\n- Customers love thin paper [[mem:mem_bad]]\n- Orphan claim without citation that is long enough\n`,
      sourceMemoryIds: ["mem_bad"],
      memories: [
        {
          memoryId: "mem_bad",
          authorityStatus: "rejected",
          contradictionCount: 0
        }
      ],
      knownPaths: new Set(["/x"]),
      knownSlugs: new Set(["x"]),
      hasChildren: false,
      referencedByOthers: true
    });
    expect(issues.some((i) => i.code === "rejected_or_expired_as_truth")).toBe(true);
    expect(issues.some((i) => i.code === "missing_provenance")).toBe(true);
  });
});
