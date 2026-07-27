import { createHash } from "node:crypto";
import type { ArtifactStore } from "@maa/artifacts";
import {
  AppError,
  EvidenceItemSchema,
  EvidencePackageInputSchema,
  IdPrefix,
  newId,
  type EvidenceItem,
  type EvidencePackageInput,
  type EvidencePackageResponse
} from "@maa/contracts";
import type {
  ArtifactsRepository,
  EvidenceItemsRepository,
  EvidencePackagesRepository,
  SqliteDatabase
} from "@maa/database";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function coverageSummary(items: EvidenceItem[]): Record<string, unknown> {
  const byType: Record<string, number> = {};
  const subjects = new Set<string>();
  for (const item of items) {
    byType[item.sourceType] = (byType[item.sourceType] ?? 0) + 1;
    subjects.add(item.subjectId);
  }
  return {
    itemCount: items.length,
    bySourceType: byType,
    uniqueSubjects: subjects.size
  };
}

export interface EvidenceServiceDeps {
  db: SqliteDatabase;
  packages: EvidencePackagesRepository;
  items: EvidenceItemsRepository;
  artifacts: ArtifactsRepository;
  artifactStore: ArtifactStore;
}

/**
 * Validates, hashes, persists, and indexes evidence packages. Provenance is
 * mandatory; malformed provenance is rejected before any analysis use.
 * Evidence text is stored as data only — never executed or trusted as instructions.
 */
export class EvidenceService {
  constructor(private readonly deps: EvidenceServiceDeps) {}

  register(input: EvidencePackageInput): EvidencePackageResponse {
    const parsed = EvidencePackageInputSchema.safeParse(input);
    if (!parsed.success) {
      // Distinguish provenance failures for a clearer error code.
      const provenanceIssue = parsed.error.issues.find((i) =>
        i.path.includes("provenance")
      );
      throw new AppError({
        code: provenanceIssue ? "EVIDENCE_PROVENANCE_INVALID" : "VALIDATION_ERROR",
        message: provenanceIssue
          ? "Evidence item provenance is missing required fields."
          : "Invalid evidence package payload.",
        details: parsed.error.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message
        }))
      });
    }

    const data = parsed.data;
    for (const item of data.items) {
      const itemParsed = EvidenceItemSchema.safeParse(item);
      if (!itemParsed.success) {
        throw new AppError({
          code: "EVIDENCE_PROVENANCE_INVALID",
          message: `Evidence item '${item.evidenceId}' failed validation.`,
          details: itemParsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message
          }))
        });
      }
      if (!item.provenance.collector || !item.provenance.collectorVersion) {
        throw new AppError({
          code: "EVIDENCE_PROVENANCE_INVALID",
          message: `Evidence item '${item.evidenceId}' is missing collector provenance.`
        });
      }
      if (!item.provenance.observedAt) {
        throw new AppError({
          code: "EVIDENCE_PROVENANCE_INVALID",
          message: `Evidence item '${item.evidenceId}' is missing observedAt.`
        });
      }
    }

    const packageId = data.packageId ?? newId(IdPrefix.evidencePackage);
    if (this.deps.packages.getById(packageId)) {
      throw new AppError({
        code: "VALIDATION_ERROR",
        message: `Evidence package '${packageId}' already exists.`
      });
    }

    const now = new Date().toISOString();
    const coverage = coverageSummary(data.items);
    const contentHash = sha256(
      JSON.stringify({
        items: data.items.map((i) => ({
          evidenceId: i.evidenceId,
          sourceType: i.sourceType,
          subjectId: i.subjectId,
          textContent: i.textContent,
          fields: i.fields,
          provenance: i.provenance
        }))
      })
    );

    const artifactMeta = this.deps.artifactStore.writeJson(
      { packageId, ...data, registeredAt: now },
      { subdir: "evidence-packages", accessClass: "internal" }
    );
    this.deps.artifacts.insert({
      artifactId: artifactMeta.artifactId,
      relativePath: artifactMeta.relativePath,
      contentHash: artifactMeta.contentHash,
      mimeType: artifactMeta.mimeType,
      sizeBytes: artifactMeta.sizeBytes,
      redactionStatus: artifactMeta.redactionStatus,
      accessClass: artifactMeta.accessClass,
      createdAt: artifactMeta.createdAt
    });

    const observedDates = data.items.map((i) => Date.parse(i.provenance.observedAt));
    const newest = Math.max(...observedDates);

    const tx = this.deps.db.transaction(() => {
      this.deps.packages.insert({
        packageId,
        projectId: data.projectId ?? null,
        externalWorkOrderId: data.externalWorkOrderId ?? null,
        sourceClient: data.sourceClient,
        schemaVersion: data.schemaVersion,
        platform: data.platform,
        marketplace: data.marketplace,
        category: data.category ?? null,
        productType: data.productType ?? null,
        status: "active",
        itemCount: data.items.length,
        coverageSummaryJson: JSON.stringify(coverage),
        diagnosticsJson: data.diagnostics ? JSON.stringify(data.diagnostics) : null,
        packageArtifactId: artifactMeta.artifactId,
        contentHash,
        observedAt: Number.isFinite(newest) ? new Date(newest).toISOString() : null,
        createdAt: now,
        updatedAt: now
      });

      for (const item of data.items) {
        const itemHash = sha256(
          JSON.stringify({
            evidenceId: item.evidenceId,
            textContent: item.textContent,
            fields: item.fields,
            provenance: item.provenance
          })
        );
        this.deps.items.insert({
          evidenceId: item.evidenceId,
          evidencePackageId: packageId,
          sourceType: item.sourceType,
          platform: item.platform,
          marketplace: item.marketplace,
          category: item.category ?? null,
          productType: item.productType ?? null,
          subjectId: item.subjectId,
          sourceUrl: item.provenance.sourceUrl ?? null,
          observedAt: item.provenance.observedAt,
          collector: item.provenance.collector,
          collectorVersion: item.provenance.collectorVersion,
          confidence: item.confidence,
          title: item.title ?? null,
          textContent: item.textContent ?? null,
          fieldsJson: JSON.stringify(item.fields),
          provenanceJson: JSON.stringify(item.provenance),
          rawSnapshotArtifactId: item.provenance.rawSnapshotRef ?? null,
          contentHash: item.contentHash ?? itemHash,
          validationStatus: item.validationStatus,
          createdAt: now
        });
      }
    });
    tx();

    return this.toResponse(this.deps.packages.getById(packageId)!);
  }

  getPackage(packageId: string): EvidencePackageResponse {
    const row = this.deps.packages.getById(packageId);
    if (!row) {
      throw new AppError({
        code: "EVIDENCE_PACKAGE_NOT_FOUND",
        message: `Evidence package '${packageId}' not found.`
      });
    }
    return this.toResponse(row);
  }

  getItems(packageId: string): EvidenceItem[] {
    if (!this.deps.packages.getById(packageId)) {
      throw new AppError({
        code: "EVIDENCE_PACKAGE_NOT_FOUND",
        message: `Evidence package '${packageId}' not found.`
      });
    }
    return this.deps.items.listByPackage(packageId).map((row) => this.toItem(row));
  }

  getItemsForPackages(packageIds: string[]): EvidenceItem[] {
    return this.deps.items.listByPackages(packageIds).map((row) => this.toItem(row));
  }

  assertPackagesExist(packageIds: string[]): void {
    for (const id of packageIds) {
      if (!this.deps.packages.getById(id)) {
        throw new AppError({
          code: "EVIDENCE_PACKAGE_NOT_FOUND",
          message: `Evidence package '${id}' not found.`,
          details: [{ path: "evidencePackageIds", message: id }]
        });
      }
    }
  }

  listPackages(): EvidencePackageResponse[] {
    return this.deps.packages.list().map((r) => this.toResponse(r));
  }

  private toResponse(row: {
    packageId: string;
    projectId: string | null;
    externalWorkOrderId: string | null;
    sourceClient: string;
    schemaVersion: string;
    platform: string;
    marketplace: string;
    category: string | null;
    productType: string | null;
    status: string;
    itemCount: number;
    coverageSummaryJson: string;
    contentHash: string;
    packageArtifactId: string | null;
    createdAt: string;
    observedAt: string | null;
  }): EvidencePackageResponse {
    return {
      packageId: row.packageId,
      projectId: row.projectId,
      externalWorkOrderId: row.externalWorkOrderId,
      sourceClient: row.sourceClient,
      schemaVersion: row.schemaVersion,
      platform: row.platform,
      marketplace: row.marketplace,
      category: row.category,
      productType: row.productType,
      status: row.status,
      itemCount: row.itemCount,
      coverageSummary: JSON.parse(row.coverageSummaryJson) as Record<string, unknown>,
      contentHash: row.contentHash,
      packageArtifactId: row.packageArtifactId,
      createdAt: row.createdAt,
      observedAt: row.observedAt
    };
  }

  private toItem(row: {
    evidenceId: string;
    sourceType: string;
    platform: string;
    marketplace: string;
    category: string | null;
    productType: string | null;
    subjectId: string;
    title: string | null;
    textContent: string | null;
    fieldsJson: string;
    confidence: number;
    provenanceJson: string;
    contentHash: string;
    validationStatus: string;
  }): EvidenceItem {
    return {
      evidenceId: row.evidenceId,
      sourceType: row.sourceType as EvidenceItem["sourceType"],
      platform: row.platform,
      marketplace: row.marketplace,
      category: row.category ?? undefined,
      productType: row.productType ?? undefined,
      subjectId: row.subjectId,
      title: row.title ?? undefined,
      textContent: row.textContent ?? undefined,
      fields: JSON.parse(row.fieldsJson) as Record<string, unknown>,
      confidence: row.confidence,
      provenance: JSON.parse(row.provenanceJson) as EvidenceItem["provenance"],
      contentHash: row.contentHash,
      validationStatus: row.validationStatus as EvidenceItem["validationStatus"]
    };
  }
}
