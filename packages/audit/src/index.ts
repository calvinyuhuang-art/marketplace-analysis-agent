import { createHash } from "node:crypto";
import { IdPrefix, newId } from "@maa/contracts";
import type { AuditEventRow, AuditRepository } from "@maa/database";

export interface AuditInput {
  actorType: "system" | "client" | "operator" | "reviewer" | "governor";
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  artifactRefs?: string[];
  correlationId?: string;
  requestId?: string;
  runId?: string;
}

function canonical(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/**
 * Append-only audit log with a SHA-256 hash chain. Each event's hash covers the
 * previous hash plus the canonical event body, making tampering detectable.
 */
export class AuditLog {
  constructor(private readonly repo: AuditRepository) {}

  append(input: AuditInput): AuditEventRow {
    const previousHash = this.repo.latestHash();
    const eventId = newId(IdPrefix.audit);
    const createdAt = new Date().toISOString();

    const body = {
      eventId,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      before: input.before ?? null,
      after: input.after ?? null,
      artifactRefs: input.artifactRefs ?? [],
      correlationId: input.correlationId ?? null,
      requestId: input.requestId ?? null,
      runId: input.runId ?? null,
      createdAt
    };

    const eventHash = createHash("sha256")
      .update((previousHash ?? "") + "\n" + canonical(body))
      .digest("hex");

    const row: AuditEventRow = {
      eventId,
      previousHash,
      eventHash,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      beforeStateJson: input.before !== undefined ? canonical(input.before) : null,
      afterStateJson: input.after !== undefined ? canonical(input.after) : null,
      artifactRefsJson: input.artifactRefs ? canonical(input.artifactRefs) : null,
      correlationId: input.correlationId ?? null,
      requestId: input.requestId ?? null,
      runId: input.runId ?? null,
      createdAt
    };

    this.repo.insert(row);
    return row;
  }

  /** Verifies the stored chain is internally consistent. */
  verify(rows: AuditEventRow[]): { ok: boolean; brokenAt?: string } {
    let prev: string | null = null;
    for (const row of [...rows].reverse()) {
      if (row.previousHash !== prev) {
        return { ok: false, brokenAt: row.eventId };
      }
      prev = row.eventHash;
    }
    return { ok: true };
  }
}
