import { AppError } from "@maa/contracts";
import type { SqliteDatabase, MemoryItemsRepository } from "@maa/database";
import type { LearningPlaneAdapterConfig } from "./config.js";
import type { LearningPlaneAdapterRepository } from "./adapterRepository.js";
import { LearningPlaneSecretStore } from "./secretStore.js";
import { createAgentClient } from "./clientFactory.js";
import {
  PublishedKnowledgeBridgeRepository,
  newPkId,
  sha256Json,
  sha256Text,
  type PkLocalReferenceRow
} from "./publishedKnowledgeBridgeRepository.js";
import {
  buildPublicationProposalFromMemory,
  type MaaSourceMemory
} from "./publishedKnowledgeMapper.js";
import {
  assertNoInstructionAuthority,
  formatExternalKnowledgeSection,
  sanitizeExternalContent,
  type ExternalKnowledgePromptItem
} from "./promptInjection.js";

export type PublishedKnowledgeBridgeServiceDeps = {
  config: LearningPlaneAdapterConfig;
  db: SqliteDatabase;
  repo: PublishedKnowledgeBridgeRepository;
  adapterRepo: LearningPlaneAdapterRepository;
  secrets: LearningPlaneSecretStore;
  memoryItems?: MemoryItemsRepository;
};

function requireBridge(
  config: LearningPlaneAdapterConfig,
  flag: boolean,
  msg: string
) {
  if (!config.enabled || !config.publicationBridgeEnabled || !flag) {
    throw new AppError({ code: "UNSUPPORTED_OPERATION", message: msg });
  }
}

const ACTIVE_LIKE_CHALLENGE_STATES = new Set([
  "active",
  "pending",
  "open",
  "challenged",
  "contested"
]);
const TERMINAL_CATALOG_STATES = new Set(["revoked", "retired", "superseded", "expired"]);

function externalReferenceSkipReason(ref: PkLocalReferenceRow): string | null {
  if (ref.challenge_state && ACTIVE_LIKE_CHALLENGE_STATES.has(ref.challenge_state)) {
    return "challenge_active";
  }
  if (ref.catalog_state && TERMINAL_CATALOG_STATES.has(ref.catalog_state)) {
    return "catalog_terminal";
  }
  if (ref.local_freshness_state === "expired") {
    return "freshness_expired";
  }
  if (ref.local_freshness_state === "stale") {
    if (!ref.offline_grace_deadline || new Date(ref.offline_grace_deadline) < new Date()) {
      return "freshness_stale";
    }
  }
  return null;
}

export class PublishedKnowledgeBridgeService {
  constructor(private readonly deps: PublishedKnowledgeBridgeServiceDeps) {}

  tablesPresent(): boolean {
    return this.deps.repo.tablesPresent();
  }

  getStatus(): Record<string, unknown> {
    const c = this.deps.config;
    const counts = this.tablesPresent() ? this.deps.repo.counts() : {};
    return {
      milestone: "LP8-I5c",
      publicationBridgeEnabled: c.publicationBridgeEnabled,
      publicationSubmitEnabled: c.publicationSubmitEnabled,
      discoveryEnabled: c.discoveryEnabled,
      localReferenceEnabled: c.localReferenceEnabled,
      externalRetrievalEnabled: c.externalRetrievalEnabled,
      offlineGraceHours: c.offlineGraceHours,
      discoveryDoesNotCreateReference: true,
      referenceIsNotAdoption: true,
      useIsNotInfluence: true,
      publicationNeverActivatesRules: true,
      untrustedExternalKnowledge: true,
      counts
    };
  }

  private agentClient() {
    let apiKey: string | undefined;
    try {
      apiKey = this.deps.secrets.load()?.agentApiKey;
    } catch {
      apiKey = undefined;
    }
    if (!apiKey) {
      throw new AppError({
        code: "INVALID_STATE_TRANSITION",
        message: "Learning Plane agent credential missing. Bootstrap/register first."
      });
    }
    return createAgentClient(this.deps.config, apiKey);
  }

  proposeFromMemory(input: {
    memoryId: string;
    scope?: "agent_group" | "agent_private";
    targetAgentHint?: string;
    version?: string;
    idempotencyKey?: string;
  }) {
    requireBridge(this.deps.config, this.deps.config.publicationSubmitEnabled, "Publication proposal submission is disabled."
    );
    if (!this.tablesPresent()) {
      throw new AppError({
        code: "INVALID_STATE_TRANSITION",
        message: "Published-knowledge bridge tables missing (migration 0018)."
      });
    }
    if (!this.deps.memoryItems) {
      throw new AppError({
        code: "INTERNAL_ERROR",
        message: "Memory repository not wired for publication."
      });
    }
    const row = this.deps.memoryItems.getById(input.memoryId);
    if (!row) {
      throw new AppError({ code: "NOT_FOUND", message: `Memory ${input.memoryId} not found.` });
    }
    const memory: MaaSourceMemory = {
      memoryId: row.memoryId,
      memoryType: row.memoryType,
      authorityStatus: row.authorityStatus,
      title: row.title,
      statement: row.statement,
      summary: row.summary ?? undefined,
      confidence: row.confidence,
      updatedAt: row.updatedAt
    };
    const mapped = buildPublicationProposalFromMemory({
      memory,
      scope: input.scope,
      targetAgentHint: input.targetAgentHint ?? "research-orchestrator",
      version: input.version
    });
    const idempotencyKey =
      input.idempotencyKey ??
      `maa-pk-${mapped.sourceRecordId}-${mapped.sourceRecordVersion}-${mapped.sourceRecordSha256.slice(0, 12)}`;
    const existing = this.deps.repo.getProposalByIdempotency(idempotencyKey);
    if (existing) {
      if (existing.payload_sha256 !== sha256Json(mapped)) {
        throw new AppError({
          code: "IDEMPOTENCY_CONFLICT",
          message: "Idempotency key reused with different publication payload."
        });
      }
      return { proposal: existing, idempotentReplay: true };
    }
    const now = new Date().toISOString();
    const proposalRowId = newPkId("pkprop");
    const payloadJson = JSON.stringify(mapped);
    this.deps.repo.insertProposal({
      proposal_row_id: proposalRowId,
      source_memory_id: memory.memoryId,
      source_record_id: mapped.sourceRecordId,
      source_record_version: mapped.sourceRecordVersion,
      source_record_sha256: mapped.sourceRecordSha256,
      knowledge_type: mapped.knowledgeType,
      title: mapped.title,
      summary: mapped.summary,
      requested_scope: mapped.scope,
      authority: mapped.authority,
      confidence: mapped.confidence,
      payload_json: payloadJson,
      payload_sha256: sha256Json(mapped),
      idempotency_key: idempotencyKey,
      correlation_id: newPkId("corr"),
      status: "pending",
      lp_proposal_id: null,
      lp_case_id: null,
      lp_published_knowledge_id: null,
      lp_publication_package_id: null,
      package_sha256: null,
      approved_scope: null,
      decision: null,
      decision_reason: null,
      last_error_code: null,
      last_bounded_error: null,
      created_at: now,
      updated_at: now,
      submitted_at: null,
      reconciled_at: null
    });
    this.deps.repo.enqueueOutbox({
      outbox_id: newPkId("pkobx"),
      kind: "publication_proposal",
      related_id: proposalRowId,
      published_knowledge_id: null,
      idempotency_key: `outbox-proposal-${idempotencyKey}`,
      payload_json: payloadJson,
      payload_sha256: sha256Json(mapped),
      created_at: now
    });
    return {
      proposal: this.deps.repo.getProposal(proposalRowId),
      idempotentReplay: false,
      notice:
        "Proposal queued. Learning Plane owns approval. Local memory unchanged. Publication never activates rules."
    };
  }

  listProposals() {
    return this.deps.repo.listProposals();
  }

  async reconcileProposal(proposalRowId: string) {
    requireBridge(this.deps.config, this.deps.config.publicationReconcileEnabled, "Publication reconcile is disabled."
    );
    const proposal = this.deps.repo.getProposal(proposalRowId);
    if (!proposal) {
      throw new AppError({ code: "NOT_FOUND", message: "Proposal not found." });
    }
    const client = this.agentClient();
    const listed = (await client.listOwnKnowledgePublicationProposals()) as {
      proposals?: Array<Record<string, unknown>>;
    };
    const match = (listed.proposals ?? []).find(
      (p) =>
        String(p.publicationProposalId ?? p.publication_proposal_id ?? "") ===
          String(proposal.lp_proposal_id ?? "") ||
        String(p.idempotencyKey ?? "") === proposal.idempotency_key
    );
    if (!match) {
      return { proposal, reconciled: false };
    }
    const lpProposalId = String(
      match.publicationProposalId ?? match.publication_proposal_id ?? proposal.lp_proposal_id
    );
    const lifecycle = String(
      match.proposalLifecycleState ?? match.proposal_lifecycle_state ?? match.status ?? ""
    );
    let status = proposal.status;
    if (lifecycle.includes("approved")) status = "approved";
    else if (lifecycle.includes("reject")) status = "rejected";
    else if (lifecycle.includes("revision")) status = "revision_requested";
    else if (lifecycle.includes("submitted") || lifecycle.includes("ready")) status = "submitted";

    let publishedId = proposal.lp_published_knowledge_id;
    let packageId = proposal.lp_publication_package_id;
    let packageSha = proposal.package_sha256;
    let approvedScope = proposal.approved_scope;

    if (status === "approved") {
      // Prefer catalog scan by proposal id if available via operator-less agent discover later.
      // Store proposal link now; package fields filled when discover/fetch finds them.
    }

    this.deps.repo.updateProposal(proposalRowId, {
      status,
      lp_proposal_id: lpProposalId,
      lp_case_id: match.governanceCaseId
        ? String(match.governanceCaseId)
        : proposal.lp_case_id,
      lp_published_knowledge_id: publishedId,
      lp_publication_package_id: packageId,
      package_sha256: packageSha,
      approved_scope: approvedScope,
      decision: lifecycle || proposal.decision,
      reconciled_at: new Date().toISOString()
    });
    return { proposal: this.deps.repo.getProposal(proposalRowId), reconciled: true };
  }

  async discover(query: Record<string, unknown> = {}) {
    requireBridge(this.deps.config, this.deps.config.discoveryEnabled, "Production discovery is disabled."
    );
    const client = this.agentClient();
    const bounded = {
      knowledgeTypes: query.knowledgeTypes,
      marketplace: query.marketplace,
      collectorAdapter: query.collectorAdapter,
      workflowStage: query.workflowStage,
      schemaOrContractVersion: query.schemaOrContractVersion,
      taskCategory: query.taskCategory,
      limit: typeof query.limit === "number" ? query.limit : 25,
      correlationId: typeof query.correlationId === "string" ? query.correlationId : undefined
    };
    const result = (await client.discoverKnowledge(bounded as never)) as {
      results?: Array<Record<string, unknown>>;
      resultCount?: number;
      discoveryRecordId?: string;
      notice?: string;
    };
    const now = new Date().toISOString();
    const ids = (result.results ?? []).map((r) =>
      String(r.publishedKnowledgeId ?? r.published_knowledge_id ?? "")
    );
    this.deps.repo.insertDiscovery({
      discovery_query_id: newPkId("pkdisc"),
      query_json: JSON.stringify(bounded),
      query_sha256: sha256Json(bounded),
      lp_discovery_record_id: result.discoveryRecordId ?? null,
      result_count: result.resultCount ?? ids.length,
      result_ids_json: JSON.stringify(ids),
      notice: result.notice ?? "Discovery does not mean adoption.",
      correlation_id: bounded.correlationId ?? null,
      created_at: now
    });
    return {
      ...result,
      localReferenceCreated: false,
      notice:
        result.notice ??
        "Discovery does not create a local reference. Reference is not adoption."
    };
  }

  async fetchAndCreateLocalReference(input: {
    publishedKnowledgeId: string;
    origin?: "manual" | "operator" | "uat";
    discoveredAt?: string;
  }) {
    requireBridge(
      this.deps.config,
      this.deps.config.localReferenceEnabled && this.deps.config.packageFetchEnabled,
      "Local reference / package fetch is disabled."
    );
    const client = this.agentClient();
    const detail = (await client.getPublishedKnowledge(input.publishedKnowledgeId)) as {
      record?: Record<string, unknown>;
      package?: Record<string, unknown>;
      untrustedContent?: boolean;
      notice?: string;
    };
    const record = detail.record ?? {};
    const pkg = detail.package ?? {};
    const packageSha = String(
      record.packageSha256 ?? pkg.package_sha256 ?? pkg.packageSha256 ?? ""
    );
    if (!/^[a-f0-9]{64}$/.test(packageSha)) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: "Package hash missing or invalid."
      });
    }
    const existing = this.deps.repo.getLocalReferenceByPublication(
      input.publishedKnowledgeId,
      packageSha
    );
    if (existing) {
      return { reference: existing, idempotentReplay: true };
    }
    const body = pkg.body ?? pkg;
    const bodyJson = JSON.stringify(body);
    const now = new Date().toISOString();
    this.deps.repo.upsertPackageCache({
      package_sha256: packageSha,
      published_knowledge_id: input.publishedKnowledgeId,
      publication_package_id: String(
        record.publicationPackageId ?? pkg.publication_package_id ?? ""
      ),
      publication_version: String(record.sourceRecordVersion ?? "1"),
      source_agent_id: String(record.sourceAgentId ?? "unknown"),
      knowledge_type: String(record.knowledgeType ?? "semantic_fact"),
      body_json: bodyJson,
      meta_json: JSON.stringify({
        title: record.title,
        summary: record.summary,
        limitations: record.limitations,
        untrustedContent: true
      }),
      fetched_at: now,
      byte_size: Buffer.byteLength(bodyJson, "utf8")
    });
    const localReferenceId = newPkId("pkref");
    const row: PkLocalReferenceRow = {
      local_reference_id: localReferenceId,
      published_knowledge_id: input.publishedKnowledgeId,
      publication_package_id: String(
        record.publicationPackageId ?? pkg.publication_package_id ?? null
      ),
      publication_version: String(record.sourceRecordVersion ?? "1"),
      package_sha256: packageSha,
      source_agent_id: String(record.sourceAgentId ?? "unknown"),
      knowledge_type: String(record.knowledgeType ?? "semantic_fact"),
      authority: record.authority ? String(record.authority) : null,
      applicability_json: JSON.stringify(record.applicabilityConditions ?? []),
      scope_snapshot: record.scope ? String(record.scope) : null,
      untrusted_content: 1,
      discovered_at: input.discoveredAt ?? null,
      reference_created_at: now,
      reference_origin: input.origin ?? "manual",
      local_review_state: "pending_local_review",
      local_retrieval_eligible: 0,
      lp_eligible: null,
      lp_eligibility_json: null,
      lp_freshness_state: record.freshnessState ? String(record.freshnessState) : null,
      local_freshness_state: record.freshnessState ? String(record.freshnessState) : null,
      challenge_state: null,
      catalog_state: record.catalogState ? String(record.catalogState) : null,
      offline_grace_deadline: null,
      last_reconciled_at: null,
      last_used_at: null,
      use_count: 0,
      influence_count: 0,
      title: record.title ? String(record.title) : null,
      summary: record.summary ? String(record.summary) : null,
      created_at: now,
      updated_at: now
    };
    this.deps.repo.insertLocalReference(row);
    if (this.deps.config.referenceReceiptEnabled) {
      this.deps.repo.enqueueOutbox({
        outbox_id: newPkId("pkobx"),
        kind: "reference_receipt",
        related_id: localReferenceId,
        published_knowledge_id: input.publishedKnowledgeId,
        idempotency_key: `ref-receipt-${localReferenceId}`,
        payload_json: JSON.stringify({
          kind: "stored_local_reference",
          summary: "MAA local reference created; not adoption.",
          detailJson: {
            localReferenceId,
            referenceOrigin: row.reference_origin,
            localReviewState: "pending_local_review",
            localRetrievalEligible: false
          },
          idempotencyKey: `ref-receipt-${localReferenceId}`
        }),
        payload_sha256: sha256Text(localReferenceId),
        created_at: now
      });
    }
    return {
      reference: this.deps.repo.getLocalReference(localReferenceId),
      idempotentReplay: false,
      notice:
        "Local reference created as pending_local_review. Not retrieval-eligible. Not adoption."
    };
  }

  async reviewLocalReference(input: {
    localReferenceId: string;
    makeEligible: boolean;
  }) {
    requireBridge(this.deps.config, this.deps.config.localReferenceReviewEnabled, "Local reference review is disabled."
    );
    const ref = this.deps.repo.getLocalReference(input.localReferenceId);
    if (!ref) throw new AppError({ code: "NOT_FOUND", message: "Local reference not found." });
    let lpEligible = false;
    let eligibilityJson: string | null = null;
    let freshness = ref.lp_freshness_state;
    try {
      const client = this.agentClient();
      const projection = (await client.getKnowledgeEligibilityProjection(
        ref.published_knowledge_id
      )) as Record<string, unknown>;
      lpEligible = Boolean(projection.learningPlaneEligible);
      eligibilityJson = JSON.stringify(projection);
      freshness = projection.freshnessState
        ? String(projection.freshnessState)
        : freshness;
    } catch {
      // Offline: may keep prior eligibility only within grace when already eligible.
      if (ref.local_retrieval_eligible === 1 && ref.offline_grace_deadline) {
        lpEligible = new Date(ref.offline_grace_deadline).getTime() > Date.now();
      }
    }
    const expired =
      freshness === "expired" ||
      ref.catalog_state === "retired" ||
      ref.catalog_state === "superseded" ||
      ref.catalog_state === "revoked";
    const localEligible =
      input.makeEligible &&
      lpEligible &&
      !expired &&
      Boolean(ref.package_sha256);
    const graceHours = this.deps.config.offlineGraceHours;
    const offlineDeadline = localEligible
      ? new Date(Date.now() + graceHours * 3600_000).toISOString()
      : null;
    this.deps.repo.updateLocalReference(input.localReferenceId, {
      local_review_state: localEligible
        ? "eligible_for_retrieval"
        : input.makeEligible
          ? "pending_local_review"
          : "disabled",
      local_retrieval_eligible: localEligible ? 1 : 0,
      lp_eligible: lpEligible ? 1 : 0,
      lp_eligibility_json: eligibilityJson,
      lp_freshness_state: freshness,
      local_freshness_state: freshness,
      offline_grace_deadline: offlineDeadline,
      last_reconciled_at: new Date().toISOString()
    });
    return {
      reference: this.deps.repo.getLocalReference(input.localReferenceId),
      notice:
        "Learning Plane eligibility is necessary but not sufficient. Local review owns retrieval eligibility."
    };
  }

  listLocalReferences() {
    return this.deps.repo.listLocalReferences();
  }

  deleteLocalReference(
    localReferenceId: string,
    reason?: string
  ): { ok: true; idempotent: boolean; localReferenceId: string } {
    requireBridge(
      this.deps.config,
      this.deps.config.publicationBridgeEnabled,
      "Published-knowledge bridge is disabled."
    );
    if (!this.tablesPresent()) {
      throw new AppError({
        code: "INVALID_STATE_TRANSITION",
        message: "Published-knowledge bridge tables missing (migration 0018)."
      });
    }
    const ref = this.deps.repo.getLocalReference(localReferenceId);
    if (!ref) {
      return { ok: true, idempotent: true, localReferenceId };
    }
    const alreadyTombstoned = this.deps.repo.isLocalReferenceTombstoned(ref);
    if (!alreadyTombstoned) {
      this.deps.repo.tombstoneLocalReference(localReferenceId);
      this.deps.adapterRepo.recordProcessingEvent({
        eventKind: "learning_plane.local_reference_deleted",
        detail: {
          localReferenceId,
          publishedKnowledgeId: ref.published_knowledge_id,
          packageSha256: ref.package_sha256,
          ...(reason ? { reason: reason.slice(0, 500) } : {})
        }
      });
    }
    return { ok: true, idempotent: alreadyTombstoned, localReferenceId };
  }

  assembleExternalKnowledgeForRun(input: {
    runId: string;
    query?: string;
    maxItems?: number;
  }): {
    section: string;
    items: ExternalKnowledgePromptItem[];
    useTraceIds: string[];
  } {
    if (
      !this.deps.config.enabled ||
      !this.deps.config.publicationBridgeEnabled ||
      !this.deps.config.externalRetrievalEnabled ||
      !this.tablesPresent()
    ) {
      return { section: "", items: [], useTraceIds: [] };
    }
    const maxItems = Math.min(input.maxItems ?? 2, 2);
    const refs = this.deps.repo.listEligibleReferences(maxItems);
    const items: ExternalKnowledgePromptItem[] = [];
    const useTraceIds: string[] = [];
    const now = new Date().toISOString();
    let rank = 1000; // below local memory
    for (const ref of refs) {
      const skipReason = externalReferenceSkipReason(ref);
      if (skipReason) {
        this.recordExternalReferenceSkipped(skipReason, ref, input.runId);
        continue;
      }
      if (ref.offline_grace_deadline && new Date(ref.offline_grace_deadline) < new Date()) {
        this.deps.repo.updateLocalReference(ref.local_reference_id, {
          local_retrieval_eligible: 0,
          local_review_state: "disabled",
          local_freshness_state: "stale"
        });
        this.recordExternalReferenceSkipped("offline_grace_expired", ref, input.runId);
        continue;
      }
      const cache = this.deps.repo.getPackageCache(ref.package_sha256);
      if (!cache) {
        this.recordExternalReferenceSkipped("package_cache_missing", ref, input.runId);
        continue;
      }
      const cachePublicationId = String(cache.published_knowledge_id ?? "");
      if (cachePublicationId !== ref.published_knowledge_id) {
        this.recordExternalReferenceSkipped("publication_id_mismatch", ref, input.runId);
        continue;
      }
      // package_sha256 is the Learning Plane package identity (cache key), not sha256(body_json).
      // Integrity: cache row must resolve under ref.package_sha256 and match published_knowledge_id.
      if (String(cache.package_sha256 ?? "") !== ref.package_sha256) {
        this.recordExternalReferenceSkipped("package_hash_mismatch", ref, input.runId);
        continue;
      }
      const bodyJson = String(cache.body_json ?? "");
      const meta = cache.meta_json
        ? (JSON.parse(String(cache.meta_json)) as Record<string, unknown>)
        : {};
      const body = bodyJson
        ? (JSON.parse(bodyJson) as {
            sections?: Array<{ content?: string }>;
          })
        : {};
      const content =
        body.sections?.map((s) => s.content ?? "").join("\n") ||
        String(ref.summary ?? "");
      const authorityCheck = assertNoInstructionAuthority(content);
      const item: ExternalKnowledgePromptItem = {
        localReferenceId: ref.local_reference_id,
        publishedKnowledgeId: ref.published_knowledge_id,
        publicationVersion: ref.publication_version,
        packageSha256: ref.package_sha256,
        sourceAgentId: ref.source_agent_id,
        knowledgeType: ref.knowledge_type,
        authority: ref.authority,
        freshness: ref.local_freshness_state,
        title: ref.title ?? "External publication",
        content: sanitizeExternalContent(content),
        limitations: Array.isArray(meta.limitations)
          ? (meta.limitations as string[])
          : ["advisory-only", "non-executable"]
      };
      if (!authorityCheck.ok) {
        item.content = `[content withheld: ${authorityCheck.reasons.join(",")}] ${item.content}`;
      }
      items.push(item);
      const useTraceId = newPkId("pkuse");
      const offline =
        ref.offline_grace_deadline && !ref.lp_eligible ? 1 : 0;
      this.deps.repo.insertUseTrace({
        use_trace_id: useTraceId,
        local_reference_id: ref.local_reference_id,
        run_id: input.runId,
        published_knowledge_id: ref.published_knowledge_id,
        package_sha256: ref.package_sha256,
        use_category: "context_assembly",
        compatibility_context_hash: sha256Text(input.query ?? ""),
        retrieval_rank: rank++,
        offline_or_stale: offline,
        created_at: now,
        receipt_status: this.deps.config.useReceiptEnabled ? "pending" : "skipped"
      });
      this.deps.repo.updateLocalReference(ref.local_reference_id, {
        use_count: ref.use_count + 1,
        last_used_at: now
      });
      if (this.deps.config.useReceiptEnabled) {
        this.deps.repo.enqueueOutbox({
          outbox_id: newPkId("pkobx"),
          kind: "use_receipt",
          related_id: useTraceId,
          published_knowledge_id: ref.published_knowledge_id,
          idempotency_key: `use-receipt-${useTraceId}`,
          payload_json: JSON.stringify({
            kind: "used_in_execution",
            summary: "Eligible external reference considered in context assembly.",
            detailJson: {
              localTaskOrRunId: input.runId,
              localReferenceId: ref.local_reference_id,
              useCategory: "context_assembly",
              compatibilityContextHash: sha256Text(input.query ?? "")
            },
            idempotencyKey: `use-receipt-${useTraceId}`
          }),
          payload_sha256: sha256Text(useTraceId),
          created_at: now
        });
      }
      useTraceIds.push(useTraceId);
    }
    return {
      section: formatExternalKnowledgeSection(items),
      items,
      useTraceIds
    };
  }

  private recordExternalReferenceSkipped(
    code: string,
    ref: PkLocalReferenceRow,
    runId?: string
  ): void {
    if (!this.deps.adapterRepo.tablesPresent()) return;
    this.deps.adapterRepo.recordProcessingEvent({
      eventKind: "learning_plane.external_reference_skipped",
      detail: { code, localReferenceId: ref.local_reference_id, runId: runId ?? null }
    });
  }

  recordInfluence(input: {
    localReferenceId: string;
    runId?: string;
    influenceCategory: string;
    boundedRationale?: string;
    localCandidateOrProposalRef?: string;
  }) {
    requireBridge(this.deps.config, this.deps.config.publicationBridgeEnabled, "Publication bridge disabled."
    );
    const ref = this.deps.repo.getLocalReference(input.localReferenceId);
    if (!ref) throw new AppError({ code: "NOT_FOUND", message: "Local reference not found." });
    const now = new Date().toISOString();
    const influenceTraceId = newPkId("pkinf");
    this.deps.repo.insertInfluenceTrace({
      influence_trace_id: influenceTraceId,
      local_reference_id: ref.local_reference_id,
      run_id: input.runId ?? null,
      published_knowledge_id: ref.published_knowledge_id,
      package_sha256: ref.package_sha256,
      influence_category: input.influenceCategory,
      bounded_rationale: input.boundedRationale?.slice(0, 1024) ?? null,
      local_candidate_or_proposal_ref: input.localCandidateOrProposalRef ?? null,
      created_at: now,
      receipt_status: this.deps.config.influenceReceiptEnabled ? "pending" : "skipped"
    });
    this.deps.repo.updateLocalReference(ref.local_reference_id, {
      influence_count: ref.influence_count + 1
    });
    if (this.deps.config.influenceReceiptEnabled) {
      this.deps.repo.enqueueOutbox({
        outbox_id: newPkId("pkobx"),
        kind: "influence_receipt",
        related_id: influenceTraceId,
        published_knowledge_id: ref.published_knowledge_id,
        idempotency_key: `inf-receipt-${influenceTraceId}`,
        payload_json: JSON.stringify({
          kind: "influenced_local_outcome",
          summary: "Material influence declared by MAA.",
          detailJson: {
            localTaskOrRunId: input.runId ?? "unknown",
            localReferenceId: ref.local_reference_id,
            influenceCategory: input.influenceCategory,
            boundedRationale: input.boundedRationale,
            localCandidateOrProposalRef: input.localCandidateOrProposalRef
          },
          idempotencyKey: `inf-receipt-${influenceTraceId}`
        }),
        payload_sha256: sha256Text(influenceTraceId),
        created_at: now
      });
    }
    return {
      influenceTraceId,
      notice: "Influence is not adoption and does not create Learning Plane owned memory."
    };
  }

  submitChallenge(input: {
    publishedKnowledgeId: string;
    localReferenceId?: string;
    challengeType: string;
    reason: string;
    idempotencyKey?: string;
  }) {
    requireBridge(this.deps.config, this.deps.config.challengeEnabled, "Challenges are disabled."
    );
    const idempotencyKey =
      input.idempotencyKey ??
      `chal-${input.publishedKnowledgeId}-${sha256Text(input.reason).slice(0, 12)}`;
    const existing = this.deps.repo.getChallengeByIdempotency(idempotencyKey);
    if (existing) return { challenge: existing, idempotentReplay: true };
    const now = new Date().toISOString();
    const challengeRowId = newPkId("pkchal");
    this.deps.repo.insertChallenge({
      challenge_row_id: challengeRowId,
      local_reference_id: input.localReferenceId ?? null,
      published_knowledge_id: input.publishedKnowledgeId,
      challenge_type: input.challengeType,
      reason: input.reason.slice(0, 4000),
      evidence_json: "[]",
      idempotency_key: idempotencyKey,
      status: "pending",
      lp_challenge_id: null,
      created_at: now,
      updated_at: now
    });
    this.deps.repo.enqueueOutbox({
      outbox_id: newPkId("pkobx"),
      kind: "challenge",
      related_id: challengeRowId,
      published_knowledge_id: input.publishedKnowledgeId,
      idempotency_key: `outbox-chal-${idempotencyKey}`,
      payload_json: JSON.stringify({
        challengeType: input.challengeType,
        reason: input.reason.slice(0, 4000),
        evidenceReferences: [],
        idempotencyKey
      }),
      payload_sha256: sha256Text(idempotencyKey),
      created_at: now
    });
    return {
      challengeRowId,
      notice: "Challenge queued. Package remains immutable."
    };
  }

  applyLifecycleToReference(input: {
    localReferenceId: string;
    catalogState: string;
    freshnessState?: string;
  }) {
    requireBridge(this.deps.config, this.deps.config.pkLifecycleReconcileEnabled, "Lifecycle reconcile disabled."
    );
    const ref = this.deps.repo.getLocalReference(input.localReferenceId);
    if (!ref) throw new AppError({ code: "NOT_FOUND", message: "Local reference not found." });
    const terminal = ["retired", "revoked", "superseded", "expired"].includes(
      input.catalogState
    );
    this.deps.repo.updateLocalReference(input.localReferenceId, {
      catalog_state: input.catalogState,
      lp_freshness_state: input.freshnessState ?? ref.lp_freshness_state,
      local_freshness_state: input.freshnessState ?? ref.local_freshness_state,
      local_retrieval_eligible: terminal ? 0 : ref.local_retrieval_eligible,
      local_review_state: terminal ? "disabled" : ref.local_review_state,
      last_reconciled_at: new Date().toISOString()
    });
    return {
      reference: this.deps.repo.getLocalReference(input.localReferenceId),
      notice:
        "Lifecycle reconciled locally. Does not delete MAA memory, audit, or roll back rules."
    };
  }
}
