import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Walk up from a starting directory to find the workspace root (identified by
 * pnpm-workspace.yaml). This makes runtime paths (data, artifacts, log,
 * migrations, .env) stable no matter which directory the process starts in.
 */
export function findRepoRoot(startDir: string = process.cwd()): string {
  let dir = resolve(startDir);
  for (;;) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(startDir);
    dir = parent;
  }
}

/** Resolve a possibly-relative configured path against the repo root. */
export function resolveFromRoot(root: string, p: string): string {
  return resolve(root, p);
}
