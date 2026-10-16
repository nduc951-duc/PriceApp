import { describe, expect, it } from "vitest";
import { matchesHardFilters, resolveFollowUpQuestion, toHardFilters, understandQuery } from "./query-understanding.js";

describe("Vietnamese query understanding", () => {
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

  it("does not add hard filters for attributes absent from the question", () => {
    const parsed = understandQuery("Tắc kê");
    expect(toHardFilters(parsed)).toEqual({});
    expect(matchesHardFilters({ dimensions: ["6x50"], material: "sắt", package: "bịch" }, parsed)).toBe(true);
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
});
