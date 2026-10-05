import { describe, expect, it } from "vitest";
import { rankVariantIds } from "./rank";

describe("rankVariantIds", () => {
  it("rewards a variant found by both retrieval methods", () => {
    expect(rankVariantIds([1, 2], [3, 2, 4])[0]).toBe(2);
  });
  it("deduplicates IDs and ignores invalid values", () => {
    expect(rankVariantIds([1, 1, NaN], [2, 2])).toEqual([1, 2]);
  });
  it("preserves each method's rank for disjoint results", () => {
    expect(rankVariantIds([1, 2], [3, 4])).toEqual([1, 3, 2, 4]);
  });
});
