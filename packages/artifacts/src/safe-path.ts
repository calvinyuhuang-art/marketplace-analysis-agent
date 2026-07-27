import { isAbsolute, normalize, relative, resolve, sep } from "node:path";
import { AppError } from "@maa/contracts";

/**
 * Resolve a relative artifact path against a single configured root, rejecting
 * any attempt to escape the root: absolute paths, Windows drive prefixes,
 * `..` traversal, and normalized paths that land outside the root.
 */
export function resolveSafePath(root: string, relativePath: string): string {
  const absoluteRoot = resolve(root);

  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new AppError({ code: "ARTIFACT_PATH_UNSAFE", message: "Empty artifact path." });
  }
  if (relativePath.includes("\0")) {
    throw new AppError({ code: "ARTIFACT_PATH_UNSAFE", message: "Null byte in artifact path." });
  }
  if (isAbsolute(relativePath)) {
    throw new AppError({
      code: "ARTIFACT_PATH_UNSAFE",
      message: "Absolute artifact paths are not allowed."
    });
  }
  if (/^[a-zA-Z]:/.test(relativePath)) {
    throw new AppError({
      code: "ARTIFACT_PATH_UNSAFE",
      message: "Drive-prefixed artifact paths are not allowed."
    });
  }

  const unixed = relativePath.replace(/\\/g, "/");
  const segments = normalize(unixed).replace(/\\/g, "/").split("/");
  if (segments.includes("..")) {
    throw new AppError({
      code: "ARTIFACT_PATH_UNSAFE",
      message: "Path traversal ('..') is not allowed in artifact paths."
    });
  }

  const full = resolve(absoluteRoot, unixed);
  const rel = relative(absoluteRoot, full);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel) || rel.split(sep).includes("..")) {
    throw new AppError({
      code: "ARTIFACT_PATH_UNSAFE",
      message: "Resolved artifact path escapes the artifact root."
    });
  }

  return full;
}
