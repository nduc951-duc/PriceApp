import { describe, expect, it } from "vitest";
import { priceAnswer } from "./price-answer.js";

describe("priceAnswer", () => {
  it("uses authoritative SQL amount and package without converting it", () => {
    const answer = priceAnswer([{ productName: "Tắc kê", variant: "6x50", sourcePages: [1], prices: [
      { amount: 90000, priceType: "wholesale", packagingName: "Bịch", minimumQuantity: 2 },
    ] }]);
    expect(answer).toContain("90.000");
    expect(answer).toContain("tối thiểu 2 gói");
    expect(answer).toContain("trang 1");
  });
  it("does not invent a price when the SQL result is empty", () => {
    expect(priceAnswer([{ productName: "Tắc kê", variant: "6x50", sourcePages: [1], prices: [] }])).toContain("Chưa có giá hiện hành");
  });
  it("preserves fractional digits in the authoritative SQL amount", () => {
    const answer = priceAnswer([{ productName: "Tắc kê", variant: "6x50", sourcePages: [], prices: [
      { amount: 12345.67, priceType: "retail", packagingName: "Hộp", minimumQuantity: 1 },
    ] }]);
    expect(answer).toContain("12.345,67 ₫/gói");
  });
  it("does not claim an uncertain wholesale threshold is met", () => {
    const answer = priceAnswer([{ productName: "Tắc kê", variant: "6x50", sourcePages: [1], prices: [
      { amount: 90000, priceType: "wholesale", packagingName: "Bịch", minimumQuantity: 1, packageNote: "Chưa rõ số lượng tối thiểu" },
    ] }]);
    expect(answer).toContain("chưa xác nhận ngưỡng");
    expect(answer).not.toContain("tối thiểu 1 gói");
  });
});
