import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ArtifactStore, sha256 } from "./store";

describe("ArtifactStore", () => {
  let root: string;
  let store: ArtifactStore;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "maa-artifacts-"));
    store = new ArtifactStore(root);
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("writes content and returns a correct SHA-256 hash", () => {
    const meta = store.write("hello world", { extension: "txt", mimeType: "text/plain" });
    expect(meta.contentHash).toBe(sha256("hello world"));
    expect(meta.sizeBytes).toBe(Buffer.byteLength("hello world"));
    expect(meta.relativePath.endsWith(".txt")).toBe(true);
  });

  it("round-trips JSON", () => {
    const meta = store.writeJson({ a: 1, b: "two" });
    const back = store.readJson<{ a: number; b: string }>(meta.relativePath);
    expect(back).toEqual({ a: 1, b: "two" });
  });

  it("refuses to read outside the root", () => {
    expect(() => store.read("../../etc/passwd")).toThrow();
  });
});
