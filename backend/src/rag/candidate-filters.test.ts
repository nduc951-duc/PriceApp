import { describe, expect, it } from "vitest";
import { comparisonTargets, matchesExplicitQuery, matchesNamedCandidate } from "./candidate-filters.js";

describe("candidate filtering for specification codes", () => {
  it("does not match a longer code when the question names a shorter code", () => {
    const candidate = { productName: "Bánh xe", variant: "Đỏ mận khóa ĐL 1T2", packages: [{ name: "1 bánh/cái", unit: "bánh", activeTiers: ["retail"] as const }] };
    expect(matchesExplicitQuery(candidate, "Giá bánh xe Đỏ mận khóa ĐL 1T")).toBe(false);
  });

  it("matches the exact named code", () => {
    const candidate = { productName: "Bánh xe", variant: "Đỏ mận khóa ĐL 1T", packages: [{ name: "1 bánh/cái", unit: "bánh", activeTiers: ["retail"] as const }] };
    expect(matchesExplicitQuery(candidate, "Giá bánh xe Đỏ mận khóa ĐL 1T")).toBe(true);
  });

  it("rejects an unrelated catalog candidate for an out-of-catalog product question", () => {
    expect(matchesNamedCandidate({ productName: "Bánh xe", variant: "Đỏ mận ĐL 1T2", aliases: [] }, "Giá pizza Hawaii size L là bao nhiêu?", 0))
      .toBe(false);
  });

  it("accepts a specific product despite one lightly misspelled term when lexical evidence is strong", () => {
    expect(matchesNamedCandidate({ productName: "Tắc kê sắt", variant: "6x50", aliases: [] }, "Giá tắc kẹ sắt 6x50?", 45))
      .toBe(true);
  });

  it("does not let a high lexical score replace an explicitly named variant attribute", () => {
    expect(matchesNamedCandidate(
      { productName: "Bánh xe", variant: "Đỏ mận ĐL 1T", aliases: [] },
      "Giá bánh xe Đỏ mận khóa ĐL 1T?",
      60,
    )).toBe(false);
  });

  it("extracts the two explicit targets from a comparison question", () => {
    expect(comparisonTargets("So sánh giá tắc kê sắt 6x50 với tắc kê sắt 8x50"))
      .toEqual(["tắc kê sắt 6x50", "tắc kê sắt 8x50"]);
    expect(comparisonTargets("So sánh bánh xe Đỏ mận ĐL 1T2 với 1T"))
      .toEqual(["bánh xe Đỏ mận ĐL 1T2", "bánh xe Đỏ mận ĐL 1T"]);
    expect(comparisonTargets("Giá tắc kê sắt 6x50 là bao nhiêu?"))
      .toBeNull();
  });
});
