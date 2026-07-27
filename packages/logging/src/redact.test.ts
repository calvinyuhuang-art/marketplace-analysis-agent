import { describe, expect, it } from "vitest";
import { redact, REDACTED } from "./redact";

describe("redact", () => {
  it("redacts sensitive keys at any depth", () => {
    const input = {
      user: "alice",
      DEEPSEEK_API_KEY: "sk-secret",
      nested: { authorization: "Bearer abc", ok: true },
      list: [{ password: "p", keep: 1 }]
    };
    const out = redact(input) as Record<string, unknown>;
    expect(out.user).toBe("alice");
    expect(out.DEEPSEEK_API_KEY).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).authorization).toBe(REDACTED);
    expect((out.nested as Record<string, unknown>).ok).toBe(true);
    expect(((out.list as unknown[])[0] as Record<string, unknown>).password).toBe(REDACTED);
    expect(((out.list as unknown[])[0] as Record<string, unknown>).keep).toBe(1);
  });

  it("handles circular references without throwing", () => {
    const a: Record<string, unknown> = { name: "x" };
    a.self = a;
    const out = redact(a) as Record<string, unknown>;
    expect(out.name).toBe("x");
    expect(out.self).toBe("[Circular]");
  });

  it("summarizes Error objects", () => {
    const out = redact({ err: new Error("boom") }) as Record<string, unknown>;
    const err = out.err as Record<string, unknown>;
    expect(err.message).toBe("boom");
    expect(err.name).toBe("Error");
  });
});
