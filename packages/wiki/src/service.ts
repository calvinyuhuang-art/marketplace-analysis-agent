import {
  IdPrefix,
  newId,
  type WikiLintIssue,
  type WikiPage,
  type WikiPageVersion,
  type WikiSection,
  type WikiUpdateProposal
} from "@maa/contracts";
import type {
  ErrorBookRepository,
  MemoryItemsRepository,
  MemoryScopesRepository,
  ProceduralRulesRepository,
  WikiLintIssuesRepository,
  WikiPageVersionsRepository,
  WikiPagesRepository,
  WikiSourceLinksRepository,
  WikiUpdateProposalsRepository
} from "@maa/database";
import { compilePageFromMemories } from "./compile";
import {
  AMAZON_KDP_COLORING_HIERARCHY,
  flattenHierarchy,
  topicKeysForMemory
} from "./hierarchy";
import { lintWikiPage } from "./lint";

export interface WikiServiceDeps {
  pages: WikiPagesRepository;
  versions: WikiPageVersionsRepository;
  sourceLinks: WikiSourceLinksRepository;
  proposals: WikiUpdateProposalsRepository;
  lintIssues: WikiLintIssuesRepository;
  memoryItems: MemoryItemsRepository;
  memoryScopes: MemoryScopesRepository;
  proceduralRules: ProceduralRulesRepository;
  errorBook: ErrorBookRepository;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Governed wiki compiler: hierarchy seed, memory-backed patches, lint, publish.
 */
export class WikiService {
  constructor(private readonly deps: WikiServiceDeps) {}

  /** Idempotent seed of Amazon KDP Adult Coloring Books hierarchy. */
  ensureHierarchy(actorId = "system"): WikiPage[] {
    const now = new Date().toISOString();
    const flat = flattenHierarchy(AMAZON_KDP_COLORING_HIERARCHY);
    const byPath = new Map<string, string>();

    for (const node of flat) {
      const existing = this.deps.pages.getBySlug(node.slug);
      if (existing) {
        byPath.set(node.path, existing.pageId);
        continue;
      }
      const pageId = newId(IdPrefix.wikiPage);
      const parentPageId = node.parentPath ? byPath.get(node.parentPath) ?? null : null;
      const scope: Record<string, string> = {
        platform: "amazon",
        marketplace: "US",
        category: "books",
        product_type: "adult_coloring_book"
      };
      if (node.topicKey) scope.topic = node.topicKey;

      const versionId = newId(IdPrefix.wikiVersion);
      const compiled = compilePageFromMemories({
        pageTitle: node.title,
        path: node.path,
        memories: []
      });

      this.deps.pages.insert({
        pageId,
        slug: node.slug,
        title: node.title,
        parentPageId,
        path: node.path,
        status: "published",
        currentVersionId: versionId,
        scopeJson: JSON.stringify(scope),
        createdAt: now,
        updatedAt: now
      });
      this.deps.versions.insert({
        versionId,
        pageId,
        versionNo: 1,
        contentMarkdown: compiled.contentMarkdown,
        sectionsJson: JSON.stringify(compiled.sections),
        sourceMemoryIdsJson: JSON.stringify([]),
        changeReason: "Initial hierarchy seed",
        createdBy: actorId,
        createdAt: now
      });
      byPath.set(node.path, pageId);
    }

    return this.listPages();
  }

  listPages(): WikiPage[] {
    return this.deps.pages.list().map((p) => this.toPage(p));
  }

  getPage(pageId: string): {
    page: WikiPage;
    version?: WikiPageVersion;
    sourceMemoryIds: string[];
  } {
    const row = this.deps.pages.getById(pageId);
    if (!row) throw new Error(`Wiki page '${pageId}' was not found`);
    const version = row.currentVersionId
      ? this.deps.versions.getById(row.currentVersionId)
      : undefined;
    return {
      page: this.toPage(row),
      version: version ? this.toVersion(version) : undefined,
      sourceMemoryIds: version
        ? parseJson<string[]>(version.sourceMemoryIdsJson, [])
        : []
    };
  }

  listVersions(pageId: string): WikiPageVersion[] {
    return this.deps.versions.listByPage(pageId).map((v) => this.toVersion(v));
  }

  listProposals(filter?: { status?: string; pageId?: string }): WikiUpdateProposal[] {
    return this.deps.proposals.list(filter).map((p) => this.toProposal(p));
  }

  /**
   * After reusable memory approval: create reviewable patches for affected pages.
   */
  proposePatchesForMemory(input: {
    memoryId: string;
    createdBy?: string;
  }): WikiUpdateProposal[] {
    this.ensureHierarchy();
    const mem = this.deps.memoryItems.getById(input.memoryId);
    if (!mem) throw new Error(`Memory '${input.memoryId}' was not found`);
    if (!["reusable_approved", "procedural_active"].includes(mem.authorityStatus)) {
      throw new Error(
        `Only reusable_approved / procedural_active memory can drive wiki patches (got ${mem.authorityStatus}).`
      );
    }

    const scopes = this.deps.memoryScopes.listForMemory(mem.memoryId);
    const analysisArea = scopes.find((s) => s.dimension === "analysis_area")?.value;
    const topics = topicKeysForMemory({
      analysisArea,
      memoryType: mem.memoryType,
      statement: mem.statement
    });

    const pages = this.deps.pages.list().filter((p) => {
      const scope = parseJson<Record<string, string>>(p.scopeJson, {});
      return scope.topic && topics.includes(scope.topic);
    });

    const proposals: WikiUpdateProposal[] = [];
    for (const page of pages) {
      proposals.push(
        this.createRebuildProposalForPage(page.pageId, {
          createdBy: input.createdBy ?? "system",
          changeReason: `Approved memory ${mem.memoryId} affects this page.`,
          extraMemoryIds: [mem.memoryId]
        })
      );
    }
    return proposals;
  }

  /**
   * Rebuild all leaf pages from canonical approved memory (deterministic).
   */
  rebuildFromMemory(createdBy = "system"): WikiUpdateProposal[] {
    this.ensureHierarchy();
    const proposals: WikiUpdateProposal[] = [];
    for (const page of this.deps.pages.list()) {
      const scope = parseJson<Record<string, string>>(page.scopeJson, {});
      if (!scope.topic) continue;
      proposals.push(
        this.createRebuildProposalForPage(page.pageId, {
          createdBy,
          changeReason: "Full rebuild from canonical memory"
        })
      );
    }
    return proposals;
  }

  reviewProposal(input: {
    proposalId: string;
    action: "approve" | "reject";
    reviewerId: string;
    notes?: string;
  }): WikiUpdateProposal {
    const row = this.deps.proposals.getById(input.proposalId);
    if (!row) throw new Error(`Wiki proposal '${input.proposalId}' was not found`);
    if (row.status !== "proposed" && row.status !== "auto_published") {
      throw new Error(`Proposal already '${row.status}'`);
    }
    const now = new Date().toISOString();

    if (input.action === "reject") {
      this.deps.proposals.update({
        ...row,
        status: "rejected",
        reviewedBy: input.reviewerId,
        reviewedAt: now,
        reviewNotes: input.notes ?? null,
        updatedAt: now
      });
      return this.toProposal(this.deps.proposals.getById(input.proposalId)!);
    }

    const page = this.deps.pages.getById(row.pageId);
    if (!page) throw new Error(`Page '${row.pageId}' missing`);

    // Validate sources: reject expired/rejected as truth.
    const sourceIds = parseJson<string[]>(row.proposedSourceMemoryIdsJson, []);
    for (const id of sourceIds) {
      const mem = this.deps.memoryItems.getById(id);
      if (!mem || ["rejected", "expired", "superseded"].includes(mem.authorityStatus)) {
        throw new Error(
          `Cannot publish: memory '${id}' is missing or not approved current truth.`
        );
      }
    }

    const versionNo = this.deps.versions.nextVersionNo(page.pageId);
    const versionId = newId(IdPrefix.wikiVersion);
    this.deps.versions.insert({
      versionId,
      pageId: page.pageId,
      versionNo,
      contentMarkdown: row.proposedContentMarkdown,
      sectionsJson: row.proposedSectionsJson,
      sourceMemoryIdsJson: row.proposedSourceMemoryIdsJson,
      changeReason: row.changeReason,
      createdBy: input.reviewerId,
      createdAt: now
    });
    this.deps.sourceLinks.replaceForVersion(page.pageId, versionId, sourceIds, now);
    this.deps.pages.update({
      ...page,
      currentVersionId: versionId,
      status: "published",
      updatedAt: now
    });
    this.deps.proposals.update({
      ...row,
      status: "approved",
      resultingVersionId: versionId,
      reviewedBy: input.reviewerId,
      reviewedAt: now,
      reviewNotes: input.notes ?? null,
      updatedAt: now
    });

    return this.toProposal(this.deps.proposals.getById(input.proposalId)!);
  }

  lint(pageId?: string): WikiLintIssue[] {
    this.ensureHierarchy();
    this.deps.lintIssues.clear(pageId);
    const now = new Date().toISOString();
    const pages = pageId
      ? [this.deps.pages.getById(pageId)].filter(Boolean)
      : this.deps.pages.list();
    const knownPaths = new Set(this.deps.pages.list().map((p) => p.path));
    const knownSlugs = new Set(this.deps.pages.list().map((p) => p.slug));
    const allIssues: WikiLintIssue[] = [];

    for (const page of pages) {
      if (!page) continue;
      const version = page.currentVersionId
        ? this.deps.versions.getById(page.currentVersionId)
        : undefined;
      if (!version) continue;
      const sourceIds = parseJson<string[]>(version.sourceMemoryIdsJson, []);
      const memories = sourceIds
        .map((id) => this.deps.memoryItems.getById(id))
        .filter(Boolean)
        .map((m) => ({
          memoryId: m!.memoryId,
          authorityStatus: m!.authorityStatus,
          contradictionCount: m!.contradictionCount,
          validUntil: m!.validUntil
        }));

      // Also load cited ids
      const cited = [...new Set([...sourceIds, ...extractCites(version.contentMarkdown)])];
      for (const id of cited) {
        if (memories.some((m) => m.memoryId === id)) continue;
        const m = this.deps.memoryItems.getById(id);
        if (m) {
          memories.push({
            memoryId: m.memoryId,
            authorityStatus: m.authorityStatus,
            contradictionCount: m.contradictionCount,
            validUntil: m.validUntil
          });
        }
      }

      const scope = parseJson<Record<string, string>>(page.scopeJson, {});
      const proceduralWithoutRule =
        scope.topic === "procedural" &&
        this.deps.proceduralRules.list({ status: "active" }).length === 0 &&
        /\[\[mem:/.test(version.contentMarkdown);

      const issues = lintWikiPage({
        pageId: page.pageId,
        path: page.path,
        contentMarkdown: version.contentMarkdown,
        sourceMemoryIds: sourceIds,
        memories,
        knownPaths,
        knownSlugs,
        hasChildren: this.deps.pages.list().some((p) => p.parentPageId === page.pageId),
        referencedByOthers: false,
        now,
        proceduralWithoutRule
      });

      for (const issue of issues) {
        this.deps.lintIssues.insert({
          issueId: issue.issueId,
          code: issue.code,
          severity: issue.severity,
          message: issue.message,
          pageId: issue.pageId ?? null,
          path: issue.path ?? null,
          memoryId: issue.memoryId ?? null,
          runId: null,
          createdAt: now
        });
      }
      allIssues.push(...issues);
    }

    return allIssues;
  }

  private createRebuildProposalForPage(
    pageId: string,
    opts: { createdBy: string; changeReason: string; extraMemoryIds?: string[] }
  ): WikiUpdateProposal {
    const page = this.deps.pages.getById(pageId)!;
    const scope = parseJson<Record<string, string>>(page.scopeJson, {});
    const topic = scope.topic;
    const now = new Date().toISOString();

    let memories = this.collectMemoriesForTopic(topic);
    if (opts.extraMemoryIds) {
      for (const id of opts.extraMemoryIds) {
        if (!memories.some((m) => m.memoryId === id)) {
          const m = this.deps.memoryItems.getById(id);
          if (m) {
            memories.push({
              memoryId: m.memoryId,
              title: m.title,
              statement: m.statement,
              authorityStatus: m.authorityStatus,
              contradictionCount: m.contradictionCount,
              analysisArea: this.deps.memoryScopes
                .listForMemory(m.memoryId)
                .find((s) => s.dimension === "analysis_area")?.value,
              validUntil: m.validUntil
            });
          }
        }
      }
    }

    // Error book summary page pulls error book entries as synthetic bullets via memory only —
    // if no memory, still compile empty + note from error book count.
    if (topic === "error_book") {
      const entries = this.deps.errorBook.list({});
      // Represent as open questions / known from corrections text without fake memory ids —
      // only include real reusable/procedural memory. Error book text goes into open section notes
      // via compile open questions by appending to statement list through a dedicated path:
      memories = memories.filter((m) => m.authorityStatus !== "rejected");
      const compiled = compilePageFromMemories({
        pageTitle: page.title,
        path: page.path,
        memories,
        now
      });
      if (entries.length > 0) {
        compiled.contentMarkdown += `\n## Error Book entries\n\n`;
        for (const e of entries.slice(0, 20)) {
          compiled.contentMarkdown += `- **${e.title}** (${e.errorClass}, ${e.recurrenceStatus}, ×${e.occurrenceCount}): ${e.correction}\n`;
        }
      }
      return this.insertProposal(page, compiled, opts, now);
    }

    const compiled = compilePageFromMemories({
      pageTitle: page.title,
      path: page.path,
      memories,
      now
    });
    return this.insertProposal(page, compiled, opts, now);
  }

  private insertProposal(
    page: { pageId: string; currentVersionId: string | null; title: string },
    compiled: {
      contentMarkdown: string;
      sections: WikiSection[];
      sourceMemoryIds: string[];
    },
    opts: { createdBy: string; changeReason: string },
    now: string
  ): WikiUpdateProposal {
    const proposalId = newId(IdPrefix.wikiProposal);
    const lintPreview = lintWikiPage({
      pageId: page.pageId,
      path: this.deps.pages.getById(page.pageId)!.path,
      contentMarkdown: compiled.contentMarkdown,
      sourceMemoryIds: compiled.sourceMemoryIds,
      memories: compiled.sourceMemoryIds
        .map((id) => this.deps.memoryItems.getById(id))
        .filter(Boolean)
        .map((m) => ({
          memoryId: m!.memoryId,
          authorityStatus: m!.authorityStatus,
          contradictionCount: m!.contradictionCount,
          validUntil: m!.validUntil
        })),
      knownPaths: new Set(this.deps.pages.list().map((p) => p.path)),
      knownSlugs: new Set(this.deps.pages.list().map((p) => p.slug)),
      hasChildren: false,
      referencedByOthers: false,
      now
    });

    this.deps.proposals.insert({
      proposalId,
      pageId: page.pageId,
      fromVersionId: page.currentVersionId,
      status: "proposed",
      title: `Update: ${page.title}`,
      proposedContentMarkdown: compiled.contentMarkdown,
      proposedSectionsJson: JSON.stringify(compiled.sections),
      proposedSourceMemoryIdsJson: JSON.stringify(compiled.sourceMemoryIds),
      changeReason: opts.changeReason,
      lintIssuesJson: JSON.stringify(lintPreview),
      resultingVersionId: null,
      createdBy: opts.createdBy,
      reviewedBy: null,
      reviewedAt: null,
      reviewNotes: null,
      createdAt: now,
      updatedAt: now
    });
    return this.toProposal(this.deps.proposals.getById(proposalId)!);
  }

  private collectMemoriesForTopic(topic?: string) {
    if (!topic) return [];
    const reusable = this.deps.memoryItems.listReusableApprovedForScope({
      platform: "amazon",
      marketplace: "US",
      category: "books",
      productType: "adult_coloring_book"
    });

    const out = [];
    for (const m of reusable) {
      const scopes = this.deps.memoryScopes.listForMemory(m.memoryId);
      const area = scopes.find((s) => s.dimension === "analysis_area")?.value;
      const keys = topicKeysForMemory({
        analysisArea: area,
        memoryType: m.memoryType,
        statement: m.statement
      });
      if (topic === "procedural" && m.memoryType === "procedural") {
        out.push({
          memoryId: m.memoryId,
          title: m.title,
          statement: m.statement,
          authorityStatus: m.authorityStatus,
          contradictionCount: m.contradictionCount,
          analysisArea: area,
          validUntil: m.validUntil
        });
        continue;
      }
      if (keys.includes(topic)) {
        out.push({
          memoryId: m.memoryId,
          title: m.title,
          statement: m.statement,
          authorityStatus: m.authorityStatus,
          contradictionCount: m.contradictionCount,
          analysisArea: area,
          validUntil: m.validUntil
        });
      }
    }

    // Active procedural rules as pseudo? No — only memory citations. Skip.

    return out;
  }

  private toPage(row: {
    pageId: string;
    slug: string;
    title: string;
    parentPageId: string | null;
    path: string;
    status: string;
    currentVersionId: string | null;
    scopeJson: string;
    createdAt: string;
    updatedAt: string;
  }): WikiPage {
    const version = row.currentVersionId
      ? this.deps.versions.getById(row.currentVersionId)
      : undefined;
    return {
      pageId: row.pageId,
      slug: row.slug,
      title: row.title,
      parentPageId: row.parentPageId ?? undefined,
      path: row.path,
      status: row.status as WikiPage["status"],
      currentVersionId: row.currentVersionId ?? undefined,
      currentVersionNo: version?.versionNo,
      scope: parseJson(row.scopeJson, {}),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }

  private toVersion(row: {
    versionId: string;
    pageId: string;
    versionNo: number;
    contentMarkdown: string;
    sectionsJson: string;
    sourceMemoryIdsJson: string;
    changeReason: string | null;
    createdBy: string;
    createdAt: string;
  }): WikiPageVersion {
    return {
      versionId: row.versionId,
      pageId: row.pageId,
      versionNo: row.versionNo,
      contentMarkdown: row.contentMarkdown,
      sections: parseJson(row.sectionsJson, []),
      sourceMemoryIds: parseJson(row.sourceMemoryIdsJson, []),
      changeReason: row.changeReason ?? undefined,
      createdBy: row.createdBy,
      createdAt: row.createdAt
    };
  }

  private toProposal(row: {
    proposalId: string;
    pageId: string;
    fromVersionId: string | null;
    status: string;
    title: string;
    proposedContentMarkdown: string;
    proposedSectionsJson: string;
    proposedSourceMemoryIdsJson: string;
    changeReason: string;
    lintIssuesJson: string;
    resultingVersionId: string | null;
    createdBy: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    reviewNotes: string | null;
    createdAt: string;
    updatedAt: string;
  }): WikiUpdateProposal {
    return {
      proposalId: row.proposalId,
      pageId: row.pageId,
      fromVersionId: row.fromVersionId ?? undefined,
      status: row.status as WikiUpdateProposal["status"],
      title: row.title,
      proposedContentMarkdown: row.proposedContentMarkdown,
      proposedSections: parseJson(row.proposedSectionsJson, []),
      proposedSourceMemoryIds: parseJson(row.proposedSourceMemoryIdsJson, []),
      changeReason: row.changeReason,
      lintIssues: parseJson(row.lintIssuesJson, []),
      resultingVersionId: row.resultingVersionId ?? undefined,
      createdBy: row.createdBy,
      reviewedBy: row.reviewedBy ?? undefined,
      reviewedAt: row.reviewedAt ?? undefined,
      reviewNotes: row.reviewNotes ?? undefined,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}

function extractCites(md: string): string[] {
  const ids: string[] = [];
  const re = /\[\[mem:([a-zA-Z0-9_]+)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md))) ids.push(m[1]!);
  return ids;
}
