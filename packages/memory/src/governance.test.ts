import { describe, expect, it } from "vitest";
import { detectReusableConflicts } from "./governance";

describe("detectReusableConflicts", () => {
  it("flags near-duplicate statements in overlapping scope", () => {
    const conflicts = detectReusableConflicts({
      statement: "Marker bleed-through is a recurring complaint for paperback coloring books.",
      scopes: [
        { dimension: "platform", value: "amazon" },
        { dimension: "category", value: "books" },
        { dimension: "product_type", value: "adult_coloring_book" }
      ],
      candidates: [
        {
          memoryId: "mem_a",
          statement: "Marker bleed-through is a recurring complaint in adult coloring books.",
          scopes: [
            { dimension: "platform", value: "amazon" },
            { dimension: "category", value: "books" },
            { dimension: "product_type", value: "adult_coloring_book" }
          ]
        },
        {
          memoryId: "mem_b",
          statement: "Hardcover cookbooks prefer dust jackets.",
          scopes: [
            { dimension: "platform", value: "amazon" },
            { dimension: "category", value: "books" },
            { dimension: "product_type", value: "cookbook" }
          ]
        }
      ]
    });
    expect(conflicts.some((c) => c.memoryId === "mem_a")).toBe(true);
    expect(conflicts.some((c) => c.memoryId === "mem_b")).toBe(false);
  });
});
