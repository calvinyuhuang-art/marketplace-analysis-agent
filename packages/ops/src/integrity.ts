import type { SqliteDatabase } from "@maa/database";
import type { IntegrityCheckResult } from "@maa/contracts";

/** PRAGMA integrity_check — fail-closed on any non-ok result. */
export function checkDatabaseIntegrity(db: SqliteDatabase): IntegrityCheckResult {
  const rows = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
  const messages = rows.map((r) => r.integrity_check);
  const result = messages.join("; ") || "unknown";
  const ok = messages.length === 1 && messages[0] === "ok";
  return {
    ok,
    result,
    checkedAt: new Date().toISOString()
  };
}
