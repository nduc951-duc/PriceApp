import { describe, expect, it } from "vitest";
import { matchesCatalogQuery, normalizeVietnamese, parseQuery, rankMatch } from "./parser";
describe("Vietnamese search", () => {
  it("normalizes accents and aliases", () => expect(parseQuery("B\u00fa L\u00f4ng 8 li 3F").normalized).toBe("bulong 8ly 3f"));
  it.each(["2F5", "1T5", "A300", "1008"])("preserves code %s", (code) => expect(parseQuery(code).codes).toContain(code));
  it("recognizes dimensions", () => expect(parseQuery("tac ke sat 6x50").dimensions).toContain("6x50"));
  it("normalizes Vietnamese", () => expect(normalizeVietnamese("T\u1eafc k\u00ea s\u1eaft")).toBe("tac ke sat"));
  it("ranks exact above fuzzy", () => expect(rankMatch("bulong", "bulong")).toBeGreaterThan(rankMatch("bulon", "bulong")));
  it("does not match unrelated variants through short reverse tokens", () => {
    expect(matchesCatalogQuery("tac ke", "Khung treo TV 32 inch c danh mom ke loa lon")).toBe(false);
    expect(matchesCatalogQuery("tac ke", "Tắc kê sắt 6x50")).toBe(true);
  });
  it("requires an exact match for technical size tokens", () => {
    expect(matchesCatalogQuery("bulong 6x50", "Bulong 6x50")).toBe(true);
    expect(matchesCatalogQuery("bulong 6x50", "Bulong 6x60")).toBe(false);
  });
  it("applies normalized Vietnamese aliases in the catalog matcher", () => {
    expect(matchesCatalogQuery("bu long 8 li", "Bulong 8ly")).toBe(true);
  });
  it("matches accentless catalog text without fuzzy substituting a similar item", () => {
    expect(matchesCatalogQuery("do man khoa dl 1t", "Bánh xe Đỏ mận khóa ĐL 1T")).toBe(true);
    expect(matchesCatalogQuery("bánhh xe", "Bánh xe")).toBe(false);
  });
  it("matches exact SKU and catalog alias terms", () => {
    expect(matchesCatalogQuery("tk-650", "Tắc kê sắt 6x50 TK-650 Tắc kê đạn")).toBe(true);
    expect(matchesCatalogQuery("tac ke dan", "Tắc kê sắt 6x50 TK-650 Tắc kê đạn")).toBe(true);
  });
});
