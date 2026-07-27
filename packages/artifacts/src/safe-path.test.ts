import { describe, expect, it } from "vitest";
import { AppError } from "@maa/contracts";
import { resolveSafePath } from "./safe-path";

const ROOT = process.platform === "win32" ? "C:\\tmp\\artifacts" : "/tmp/artifacts";

describe("resolveSafePath", () => {
  it("accepts a simple in-root relative path", () => {
    const full = resolveSafePath(ROOT, "2026/07/25/art_abc.json");
    expect(full.startsWith(resolveSafePath(ROOT, "2026").slice(0, ROOT.length))).toBe(true);
  });

  it("rejects parent traversal", () => {
    expect(() => resolveSafePath(ROOT, "../secret.txt")).toThrow(AppError);
    expect(() => resolveSafePath(ROOT, "a/../../secret.txt")).toThrow(AppError);
    expect(() => resolveSafePath(ROOT, "..")).toThrow(AppError);
  });

  it("rejects absolute paths", () => {
    const abs = process.platform === "win32" ? "C:\\Windows\\system32" : "/etc/passwd";
    expect(() => resolveSafePath(ROOT, abs)).toThrow(AppError);
  });

  it("rejects windows drive prefixes", () => {
    expect(() => resolveSafePath(ROOT, "C:evil")).toThrow(AppError);
    expect(() => resolveSafePath(ROOT, "d:/evil")).toThrow(AppError);
  });

  it("rejects empty and null-byte paths", () => {
    expect(() => resolveSafePath(ROOT, "")).toThrow(AppError);
    expect(() => resolveSafePath(ROOT, "a\0b")).toThrow(AppError);
  });

  it("tags rejections with ARTIFACT_PATH_UNSAFE", () => {
    try {
      resolveSafePath(ROOT, "../x");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("ARTIFACT_PATH_UNSAFE");
    }
  });
});
