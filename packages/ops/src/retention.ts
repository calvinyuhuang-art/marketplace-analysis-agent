import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import type { RetentionPurgeResult } from "@maa/contracts";

function isPathInsideRoot(fullPath: string, rootPath: string): boolean {
  const resolvedFull = resolve(fullPath);
  const resolvedRoot = resolve(rootPath);
  return (
    resolvedFull === resolvedRoot ||
    resolvedFull.startsWith(resolvedRoot.endsWith(sep) ? resolvedRoot : resolvedRoot + sep)
  );
}

/**
 * Delete files under artifactRoot whose mtime is older than retentionDays.
 * dryRun=true reports without deleting. retentionDays=0 is a no-op.
 */
export function purgeExpiredArtifacts(opts: {
  artifactRoot: string;
  retentionDays: number;
  dryRun?: boolean;
  now?: Date;
}): RetentionPurgeResult {
  const dryRun = opts.dryRun ?? false;
  const now = opts.now ?? new Date();
  const root = resolve(opts.artifactRoot);
  let scannedFiles = 0;
  let deletedFiles = 0;
  let freedBytes = 0;

  if (opts.retentionDays <= 0 || !existsSync(root)) {
    return {
      retentionDays: opts.retentionDays,
      scannedFiles: 0,
      deletedFiles: 0,
      freedBytes: 0,
      dryRun,
      purgedAt: now.toISOString()
    };
  }

  const cutoffMs = now.getTime() - opts.retentionDays * 24 * 60 * 60 * 1000;

  function walk(dir: string): void {
    if (!isPathInsideRoot(dir, root)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (!isPathInsideRoot(full, root)) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      scannedFiles += 1;
      const st = statSync(full);
      if (st.mtimeMs < cutoffMs) {
        freedBytes += st.size;
        deletedFiles += 1;
        if (!dryRun) rmSync(full, { force: true });
      }
    }
  }

  walk(root);

  return {
    retentionDays: opts.retentionDays,
    scannedFiles,
    deletedFiles,
    freedBytes,
    dryRun,
    purgedAt: now.toISOString()
  };
}
