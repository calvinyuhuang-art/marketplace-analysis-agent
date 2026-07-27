import { randomUUID } from "node:crypto";
import {
  AnalysisOutputsRepository,
  AnalysisRequestsRepository,
  AnalysisRunsRepository,
  ArtifactsRepository,
  AuditRepository,
  CollectionRequestsRepository,
  Database,
  EvidenceItemsRepository,
  EvidencePackagesRepository,
  ExecutionLocksRepository,
  FindingReviewsRepository,
  FindingsRepository,
  IdempotencyRepository,
  LearningEventsRepository,
  MemoryItemsRepository,
  MemoryLinksRepository,
  MemoryRetrievalEventsRepository,
  MemoryScopesRepository,
  MemoryUsageEventsRepository,
  ContextAssembliesRepository,
  ModelCallsRepository,
  ModelProfilesRepository,
  ProjectsRepository,
  RevisionDiffsRepository,
  RunEventsRepository,
  RunReadinessRepository,
  RunReviewsRepository,
  OutcomeReviewsRepository,
  LessonCandidatesRepository,
  ErrorBookRepository,
  ProceduralRulesRepository,
  MemoryEvaluationsRepository,
  MemoryProposalsRepository,
  WikiPagesRepository,
  WikiPageVersionsRepository,
  WikiSourceLinksRepository,
  WikiUpdateProposalsRepository,
  WikiLintIssuesRepository,
  runMigrations
} from "@maa/database";
import { ArtifactStore } from "@maa/artifacts";
import { AuditLog } from "@maa/audit";
import { AnalysisService, DurableWorker, RevisionService } from "@maa/agent-core";
import { registerAnalysisFixtures, runStructuredAnalysis } from "@maa/analysis";
import { type CapabilitySummary } from "@maa/contracts";
import { EvidenceService } from "@maa/evidence";
import { LearningService } from "@maa/learning";
import { LoggingManager, type Logger } from "@maa/logging";
import { MemoryService, MemoryGovernorService, saveWorkingMemoryFromFindings } from "@maa/memory";
import { WikiService } from "@maa/wiki";
import {
  DEFAULT_MODEL_PROFILES,
  DeepSeekProvider,
  FakeProvider,
  type ModelProvider
} from "@maa/model-router";
import type { ResolvedConfig } from "../config/index";
import { LatencyTracker } from "../middleware/request-metrics";
import { CAPABILITIES } from "./capabilities";
import { Counters } from "./metrics";

export const SERVICE_NAME = "marketplace-analysis-agent";
export const SERVICE_VERSION = "0.10.0";
export interface Container {
  config: ResolvedConfig;
  instanceId: string;
  startedAt: number;
  serviceName: string;
  serviceVersion: string;
  logging: LoggingManager;
  loggers: {
    application: Logger;
    access: Logger;
    agent: Logger;
    model: Logger;
    tool: Logger;
    memory: Logger;
    audit: Logger;
  };
  database: Database;
  repos: {
    artifacts: ArtifactsRepository;
    audit: AuditRepository;
    modelProfiles: ModelProfilesRepository;
    projects: ProjectsRepository;
    requests: AnalysisRequestsRepository;
    runs: AnalysisRunsRepository;
    events: RunEventsRepository;
    locks: ExecutionLocksRepository;
    idempotency: IdempotencyRepository;
    evidencePackages: EvidencePackagesRepository;
    evidenceItems: EvidenceItemsRepository;
    collectionRequests: CollectionRequestsRepository;
    runReadiness: RunReadinessRepository;
    findings: FindingsRepository;
    outputs: AnalysisOutputsRepository;
    modelCalls: ModelCallsRepository;
    findingReviews: FindingReviewsRepository;
    learningEvents: LearningEventsRepository;
    runReviews: RunReviewsRepository;
    revisionDiffs: RevisionDiffsRepository;
    memoryItems: MemoryItemsRepository;
    memoryScopes: MemoryScopesRepository;
    memoryLinks: MemoryLinksRepository;
    memoryRetrievalEvents: MemoryRetrievalEventsRepository;
    contextAssemblies: ContextAssembliesRepository;
    memoryUsageEvents: MemoryUsageEventsRepository;
    outcomeReviews: OutcomeReviewsRepository;
    lessonCandidates: LessonCandidatesRepository;
    errorBook: ErrorBookRepository;
    proceduralRules: ProceduralRulesRepository;
    memoryEvaluations: MemoryEvaluationsRepository;
    memoryProposals: MemoryProposalsRepository;
    wikiPages: WikiPagesRepository;
    wikiVersions: WikiPageVersionsRepository;
    wikiSourceLinks: WikiSourceLinksRepository;
    wikiProposals: WikiUpdateProposalsRepository;
    wikiLintIssues: WikiLintIssuesRepository;
  };
  artifactStore: ArtifactStore;
  auditLog: AuditLog;
  evidenceService: EvidenceService;
  analysisService: AnalysisService;
  revisionService: RevisionService;
  memoryService: MemoryService;
  learningService: LearningService;
  memoryGovernor: MemoryGovernorService;
  wikiService: WikiService;
  worker: DurableWorker;
  providers: { fake: FakeProvider } & Record<string, ModelProvider>;
  metrics: Counters;
  latency: LatencyTracker;
  capabilities: CapabilitySummary[];
  shutdown: () => Promise<void>;
}

export function createContainer(
  config: ResolvedConfig,
  opts?: { startWorker?: boolean }
): Container {
  const instanceId = randomUUID();
  const startWorker = opts?.startWorker ?? config.raw.NODE_ENV !== "test";

  const logging = new LoggingManager({
    logRoot: config.logRoot,
    level: config.raw.MAA_LOG_LEVEL,
    console: config.raw.NODE_ENV !== "test",
    base: {
      serviceVersion: SERVICE_VERSION,
      environment: config.raw.NODE_ENV,
      instanceId
    }
  });

  const loggers = {
    application: logging.logger("application"),
    access: logging.logger("access"),
    agent: logging.logger("agent"),
    model: logging.logger("model"),
    tool: logging.logger("tool"),
    memory: logging.logger("memory"),
    audit: logging.logger("audit")
  };

  const database = Database.open({ path: config.databasePath });
  const migration = runMigrations(database.db, config.migrationsDir);
  if (migration.applied.length > 0) {
    loggers.application.info(
      { eventType: "migrations_applied", applied: migration.applied },
      "database migrations applied"
    );
  }

  const repos = {
    artifacts: new ArtifactsRepository(database.db),
    audit: new AuditRepository(database.db),
    modelProfiles: new ModelProfilesRepository(database.db),
    projects: new ProjectsRepository(database.db),
    requests: new AnalysisRequestsRepository(database.db),
    runs: new AnalysisRunsRepository(database.db),
    events: new RunEventsRepository(database.db),
    locks: new ExecutionLocksRepository(database.db),
    idempotency: new IdempotencyRepository(database.db),
    evidencePackages: new EvidencePackagesRepository(database.db),
    evidenceItems: new EvidenceItemsRepository(database.db),
    collectionRequests: new CollectionRequestsRepository(database.db),
    runReadiness: new RunReadinessRepository(database.db),
    findings: new FindingsRepository(database.db),
    outputs: new AnalysisOutputsRepository(database.db),
    modelCalls: new ModelCallsRepository(database.db),
    findingReviews: new FindingReviewsRepository(database.db),
    learningEvents: new LearningEventsRepository(database.db),
    runReviews: new RunReviewsRepository(database.db),
    revisionDiffs: new RevisionDiffsRepository(database.db),
    memoryItems: new MemoryItemsRepository(database.db),
    memoryScopes: new MemoryScopesRepository(database.db),
    memoryLinks: new MemoryLinksRepository(database.db),
    memoryRetrievalEvents: new MemoryRetrievalEventsRepository(database.db),
    contextAssemblies: new ContextAssembliesRepository(database.db),
    memoryUsageEvents: new MemoryUsageEventsRepository(database.db),
    outcomeReviews: new OutcomeReviewsRepository(database.db),
    lessonCandidates: new LessonCandidatesRepository(database.db),
    errorBook: new ErrorBookRepository(database.db),
    proceduralRules: new ProceduralRulesRepository(database.db),
    memoryEvaluations: new MemoryEvaluationsRepository(database.db),
    memoryProposals: new MemoryProposalsRepository(database.db),
    wikiPages: new WikiPagesRepository(database.db),
    wikiVersions: new WikiPageVersionsRepository(database.db),
    wikiSourceLinks: new WikiSourceLinksRepository(database.db),
    wikiProposals: new WikiUpdateProposalsRepository(database.db),
    wikiLintIssues: new WikiLintIssuesRepository(database.db)
  };

  const deepseekReady =
    config.raw.MAA_DEEPSEEK_ENABLED && config.raw.DEEPSEEK_API_KEY.trim().length > 0;
  for (const profile of DEFAULT_MODEL_PROFILES) {
    repos.modelProfiles.upsert({
      profileId: profile.profileId,
      provider: profile.provider,
      model: profile.model,
      enabled: profile.provider === "deepseek" ? deepseekReady : profile.enabled,
      temperature: profile.temperature,
      tokenCap: profile.tokenCap,
      costCapUsd: profile.costCapUsd,
      timeoutSeconds: profile.timeoutSeconds,
      fallbackProfileId: profile.fallbackProfileId,
      description: profile.description
    });
  }

  const artifactStore = new ArtifactStore(config.artifactRoot);
  const auditLog = new AuditLog(repos.audit);

  const fakeProvider = new FakeProvider();
  registerAnalysisFixtures(fakeProvider);

  const providers: { fake: FakeProvider } & Record<string, ModelProvider> = {
    fake: fakeProvider
  };

  if (deepseekReady) {
    providers.deepseek = new DeepSeekProvider({
      apiKey: config.raw.DEEPSEEK_API_KEY
    });
  }

  const defaultProfile =
    repos.modelProfiles.getById(config.raw.MAA_DEFAULT_MODEL_PROFILE) ??
    repos.modelProfiles.getById("mock-only");
  const activeProvider =
    defaultProfile && providers[defaultProfile.provider]
      ? providers[defaultProfile.provider]!
      : fakeProvider;
  const activeModel = defaultProfile?.model ?? "fake-structured";

  const metrics = new Counters();

  const evidenceService = new EvidenceService({
    db: database.db,
    packages: repos.evidencePackages,
    items: repos.evidenceItems,
    artifacts: repos.artifacts,
    artifactStore
  });

  const analysisService = new AnalysisService({
    db: database.db,
    projects: repos.projects,
    requests: repos.requests,
    runs: repos.runs,
    events: repos.events,
    locks: repos.locks,
    idempotency: repos.idempotency,
    evidencePackages: repos.evidencePackages,
    assertEvidencePackagesExist: (ids) => evidenceService.assertPackagesExist(ids),
    auditLog,
    agentLog: loggers.agent,
    capabilities: CAPABILITIES,
    defaultModelProfileId: config.raw.MAA_DEFAULT_MODEL_PROFILE,
    defaultTimeoutSeconds: config.raw.MAA_DEFAULT_TIMEOUT_SECONDS
  });

  const revisionService = new RevisionService({
    db: database.db,
    projects: repos.projects,
    requests: repos.requests,
    runs: repos.runs,
    events: repos.events,
    evidencePackages: repos.evidencePackages,
    findings: repos.findings,
    findingReviews: repos.findingReviews,
    learningEvents: repos.learningEvents,
    runReviews: repos.runReviews,
    revisionDiffs: repos.revisionDiffs,
    artifacts: repos.artifacts,
    artifactStore,
    idempotency: repos.idempotency,
    auditLog,
    agentLog: loggers.agent,
    assertEvidencePackagesExist: (ids) => evidenceService.assertPackagesExist(ids),
    defaultTimeoutSeconds: config.raw.MAA_DEFAULT_TIMEOUT_SECONDS,
    defaultModelProfileId: config.raw.MAA_DEFAULT_MODEL_PROFILE
  });

  const memoryService = new MemoryService({
    items: repos.memoryItems,
    scopes: repos.memoryScopes,
    links: repos.memoryLinks,
    retrievalEvents: repos.memoryRetrievalEvents,
    assemblies: repos.contextAssemblies,
    usageEvents: repos.memoryUsageEvents,
    artifacts: repos.artifacts,
    artifactStore,
    defaultTokenBudget: 4000
  });

  const learningService = new LearningService({
    outcomeReviews: repos.outcomeReviews,
    lessons: repos.lessonCandidates,
    errorBook: repos.errorBook,
    proceduralRules: repos.proceduralRules,
    memoryEvaluations: repos.memoryEvaluations,
    learningEvents: repos.learningEvents,
    memoryItems: repos.memoryItems
  });

  const wikiService = new WikiService({
    pages: repos.wikiPages,
    versions: repos.wikiVersions,
    sourceLinks: repos.wikiSourceLinks,
    proposals: repos.wikiProposals,
    lintIssues: repos.wikiLintIssues,
    memoryItems: repos.memoryItems,
    memoryScopes: repos.memoryScopes,
    proceduralRules: repos.proceduralRules,
    errorBook: repos.errorBook
  });

  const memoryGovernor = new MemoryGovernorService({
    proposals: repos.memoryProposals,
    items: repos.memoryItems,
    scopes: repos.memoryScopes,
    links: repos.memoryLinks,
    findings: repos.findings,
    projects: repos.projects,
    onReusableApproved: (memoryId) => {
      try {
        wikiService.proposePatchesForMemory({ memoryId, createdBy: "memory-governor" });
      } catch (err) {
        loggers.memory.warn(
          {
            eventType: "wiki_patch_proposal_failed",
            memoryId,
            error: err instanceof Error ? err.message : String(err)
          },
          "failed to create wiki patch from approved memory"
        );
      }
    }
  });

  const worker = new DurableWorker(
    {
      runs: repos.runs,
      requests: repos.requests,
      events: repos.events,
      locks: repos.locks,
      auditLog,
      agentLog: loggers.agent
    },
    {
      ownerInstance: instanceId,
      pollMs: config.raw.MAA_WORKER_POLL_MS,
      heartbeatMs: config.raw.MAA_HEARTBEAT_MS,
      leaseMs: Math.max(config.raw.MAA_HEARTBEAT_MS * 3, 15_000),
      staleExecutionMs: config.raw.MAA_STALE_EXECUTION_MS,
      phaseDelayMs: config.raw.MAA_FAKE_PHASE_DELAY_MS,
      readiness: {
        evidence: evidenceService,
        packages: repos.evidencePackages,
        collectionRequests: repos.collectionRequests,
        readinessRepo: repos.runReadiness,
        artifacts: repos.artifacts,
        artifactStore,
        auditLog,
        agentLog: loggers.agent
      },
      analysis: {
        run: runStructuredAnalysis,
        deps: {
          provider: activeProvider,
          model: activeModel,
          artifacts: repos.artifacts,
          artifactStore,
          findings: repos.findings,
          outputs: repos.outputs,
          modelCalls: repos.modelCalls,
          maxRepairAttempts: 1,
          temperature: defaultProfile?.temperature ?? 0,
          maxOutputTokens: defaultProfile?.tokenCap ?? 4000,
          timeoutMs: (defaultProfile?.timeoutSeconds ?? 60) * 1000,
          costCapUsd:
            defaultProfile?.costCapUsd && defaultProfile.costCapUsd > 0
              ? defaultProfile.costCapUsd
              : undefined
        },
        projects: repos.projects,
        evidence: evidenceService,
        packages: repos.evidencePackages,
        agentLog: loggers.agent,
        auditLog,
        onRevisionComplete: (runId) => revisionService.finalizeRevision(runId)
      },
      memory: {
        service: memoryService,
        findings: repos.findings,
        items: repos.memoryItems,
        scopes: repos.memoryScopes,
        links: repos.memoryLinks,
        saveWorking: saveWorkingMemoryFromFindings,
        agentLog: loggers.memory,
        auditLog,
        projects: repos.projects,
        resolveProceduralRules: (input) =>
          learningService.resolveActiveProceduralRules(input)
      }
    }
  );

  if (startWorker) {
    worker.start();
  }

  const shutdown = async (): Promise<void> => {
    worker.stop();
    try {
      database.close();
    } finally {
      await logging.close();
    }
  };

  return {
    config,
    instanceId,
    startedAt: Date.now(),
    serviceName: SERVICE_NAME,
    serviceVersion: SERVICE_VERSION,
    logging,
    loggers,
    database,
    repos,
    artifactStore,
    auditLog,
    evidenceService,
    analysisService,
    revisionService,
    memoryService,
    learningService,
    memoryGovernor,
    wikiService,
    worker,
    providers,
    metrics,
    latency: new LatencyTracker(),
    capabilities: CAPABILITIES,
    shutdown
  };
}
