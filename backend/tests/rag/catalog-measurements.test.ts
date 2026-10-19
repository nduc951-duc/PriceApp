import { describe, expect, it } from "vitest";
import { canonicalCatalogQuery } from "../../src/rag/catalog-measurements.js";

describe("catalog measurement identity", () => {
  it.each([
    ["8 ly x 3F", "8x30"], ["8 ly 3f", "8x30"], ["8×30 mm", "8x30"],
    ["8mm x 3cm", "8x30"], ["8 ly x 1F5", "8x15"], ["8 ly x 1T2", "8x120"],
    ["8 ly x 3 phân", "8x30"], ["8x100", "8x100"],
    ["0.8 cm", "8 mm"], ["8 ly", "8 mm"], ["10 ly 140", "10x140"],
  ])("matches equivalent spelling %s without writing catalog specifications", (input, expected) => {
    expect(canonicalCatalogQuery(input)).toBe(expected);
  });
  it("keeps product identity and unrelated model codes", () => {
    expect(canonicalCatalogQuery("tắc kê sắt 8 ly x 3F A500")).toBe("tắc kê sắt 8x30 A500");
  });
});
