import { describe, expect, it } from "vitest";
import { matchesHardFilters, resolveFollowUpQuestion, toHardFilters, understandQuery } from "../../src/rag/query-understanding.js";
import * as queryUnderstanding from "../../src/rag/query-understanding.js";

describe("Vietnamese query understanding", () => {
  it("keeps only the product name when a user asks which specifications it has", () => {
    expect(understandQuery("Bulong có những quy cách gì?").nameTerms).toEqual(["Bulong"]);
  });

  it("does not treat the Vietnamese connector 'của' as part of a product name", () => {
    expect(understandQuery("Quy cách của bánh xe Đỏ mận khóa ĐL 7F5 là gì?").nameTerms)
      .toEqual(["bánh", "xe", "Đỏ", "mận", "khóa", "ĐL"]);
  });

  it("creates a narrow deterministic hint only for a price question with one explicit specification", () => {
    expect(queryUnderstanding).toHaveProperty("specificPriceLookupHint");
    const createHint = (queryUnderstanding as Record<string, unknown>).specificPriceLookupHint;
    if (typeof createHint !== "function") return;

    expect(createHint("Tắc kê sắt 6x50 giá bao nhiêu?")).toMatchObject({
      productText: "Tắc kê",
      specifications: ["6x50"],
      material: "sắt",
    });
    expect(createHint("Cửa hàng có bao nhiêu loại tắc kê đạn?")).toBeNull();
    expect(createHint("So sánh tắc kê 6x50 và 8x80 theo giá")).toBeNull();
  });

  it("extracts diacritic-insensitive aliases and explicit product attributes", () => {
    const parsed = understandQuery("Báo giá vít bắn tôn 8 LY mạ kẽm, mua 2 hộp giá sỉ", {
      aliases: { "vit ban ton": "vít tôn" },
    });

    expect(parsed).toMatchObject({
      nameTerms: ["vít", "bắn", "tôn"],
      aliases: ["vít tôn"],
      dimensions: ["8 LY"],
      material: "mạ kẽm",
      package: "hộp",
      quantity: 2,
      unit: "hộp",
      tier: "wholesale",
    });
    expect(toHardFilters(parsed)).toMatchObject({ dimensions: ["8 LY"], material: "mạ kẽm", package: "hộp", tier: "wholesale" });
  });

  it("keeps 8 ly and 10 ly as distinct explicit dimensions", () => {
    expect(understandQuery("vít 8 ly").dimensions).toEqual(["8 ly"]);
    expect(understandQuery("vít 8ly").dimensions).toEqual(["8ly"]);
    expect(understandQuery("vít 10 ly").dimensions).toEqual(["10 ly"]);
    expect(matchesHardFilters({ dimensions: ["10 ly"] }, understandQuery("vít 8 ly"))).toBe(false);
  });

  it.each(["8 ly", "8ly", "8 mm", "8mm"])("treats a scalar size %s as a leading-dimension family filter", (size) => {
    expect(matchesHardFilters({ dimensions: ["8x100"] }, understandQuery(`tắc kê ${size}`))).toBe(true);
    expect(matchesHardFilters({ dimensions: ["10x100"] }, understandQuery(`tắc kê ${size}`))).toBe(false);
  });

  it("normalizes multiplication signs while preserving the entered specification", () => {
    expect(understandQuery("bulong 8×100").dimensions).toEqual(["8×100"]);
    expect(matchesHardFilters({ dimensions: ["8×100"] }, understandQuery("bulong 8x100"))).toBe(true);
  });

  it("keeps package size separate from requested quantity when wording is ambiguous", () => {
    const parsed = understandQuery("dây điện cuộn 100 cái");
    expect(parsed.package).toBe("cuộn 100 cái");
    expect(parsed.quantity).toBeUndefined();
    expect(parsed.unit).toBeUndefined();
    expect(toHardFilters(parsed).package).toBe("cuộn 100 cái");
  });

  it("preserves specification codes and decimal quantities without unit conversion", () => {
    const parsed = understandQuery("Tắc kê 2F5 1T5 1008 A300 6x50 lấy 1,5 kg giá đại lý");
    expect(parsed.specCodes).toEqual(["2F5", "1T5", "1008", "A300"]);
    expect(parsed.dimensions).toEqual(["6x50"]);
    expect(parsed.quantity).toBe(1.5);
    expect(parsed.unit).toBe("kg");
    expect(parsed.tier).toBe("dealer");
    expect(parsed.rawQuery).toBe("Tắc kê 2F5 1T5 1008 A300 6x50 lấy 1,5 kg giá đại lý");
  });

  it("recognizes letter-number specification codes such as 1T as complete tokens", () => {
    expect(understandQuery("Giá bánh xe Đỏ mận khóa ĐL 1T").specCodes).toEqual(["1T"]);
  });

  it("does not add hard filters for attributes absent from the question", () => {
    const parsed = understandQuery("Tắc kê");
    expect(toHardFilters(parsed)).toEqual({});
    expect(matchesHardFilters({ dimensions: ["6x50"], material: "sắt", package: "bịch" }, parsed)).toBe(true);
  });

  it("keeps question wording out of product terms for source questions", () => {
    expect(understandQuery("Trang nào có thông tin về vít tole?").nameTerms).toEqual(["vít", "tole"]);
  });

  it("marks conflicting explicit price tiers for clarification", () => {
    expect(understandQuery("giá sỉ hay giá lẻ tắc kê")).toMatchObject({ tierConflict: true });
    expect(understandQuery("giá sỉ tắc kê")).toMatchObject({ tier: "wholesale", tierConflict: false });
  });

  it("uses only prior product words for a follow-up and lets new attributes replace old ones", () => {
    expect(resolveFollowUpQuestion("Bulong 8 ly giá sỉ", "còn loại 10 ly?"))
      .toBe("Bulong 10 ly?");
    expect(resolveFollowUpQuestion("Bulong 8 ly", "còn vít 10 ly?"))
      .toBe("vít 10 ly?");
    expect(resolveFollowUpQuestion("Bulong 8 ly", "vít 10 ly?"))
      .toBe("vít 10 ly?");
  });

  it("carries product context into a short specification-only clarification reply", () => {
    expect(resolveFollowUpQuestion("Bánh xe giá bao nhiêu?", "1T2"))
      .toBe("Bánh xe 1T2");
  });
});
