import { describe, expect, it } from "vitest";
import { priceAnswer } from "./price-answer.js";

describe("priceAnswer", () => {
  it("uses authoritative SQL amount and package without converting it", () => {
    const answer = priceAnswer([{ productName: "Tắc kê", variant: "6x50", sourcePages: [1], prices: [
      { amount: 90000, priceType: "wholesale", packagingName: "Bịch", minimumQuantity: 2 },
    ] }]);
    expect(answer).toContain("90.000");
    expect(answer).toContain("tối thiểu 2 Bịch");
    expect(answer).toContain("trang 1");
  });
  it("does not invent a price when the SQL result is empty", () => {
    expect(priceAnswer([{ productName: "Tắc kê", variant: "6x50", sourcePages: [1], prices: [] }])).toContain("Chưa có giá hiện hành");
  });
  it("preserves fractional digits in the authoritative SQL amount", () => {
    const answer = priceAnswer([{ productName: "Tắc kê", variant: "6x50", sourcePages: [], prices: [
      { amount: 12345.67, priceType: "retail", packagingName: "Hộp", minimumQuantity: 1 },
    ] }]);
    expect(answer).toContain("12.345,67 ₫ / Hộp");
  });
  it("does not claim an uncertain wholesale threshold is met", () => {
    const answer = priceAnswer([{ productName: "Tắc kê", variant: "6x50", sourcePages: [1], prices: [
      { amount: 90000, priceType: "wholesale", packagingName: "Bịch", minimumQuantity: 1, packageNote: "Chưa rõ số lượng tối thiểu" },
    ] }]);
    expect(answer).toContain("chưa xác nhận ngưỡng");
    expect(answer).not.toContain("tối thiểu 1 gói");
  });

  it("shows the actual package quantity, unit, and price-list source without changing the stored amount", () => {
    const answer = priceAnswer([{ productName: "Tắc kê", variant: "6x50", sourcePages: [1], prices: [
      { amount: 90000, priceType: "retail", packagingName: "Bịch", packageQuantity: 10, unit: "cái", minimumQuantity: 2, priceList: "Bảng giá tháng 10", supplier: "Nhà cung cấp A" },
    ] }]);
    expect(answer).toContain("90.000");
    expect(answer).toContain("/ Bịch");
    expect(answer).toContain("10 cái");
    expect(answer).toContain("tối thiểu 2 Bịch");
    expect(answer).toContain("Bảng giá tháng 10");
    expect(answer).toContain("Nhà cung cấp A");
  });

  it("summarizes one variant in a compact answer without repeating its name for every price tier", () => {
    const answer = priceAnswer([{ productName: "Bánh xe", variant: "Đỏ mận khóa ĐL 1T", sourcePages: [11], prices: [
      { amount: 80000, priceType: "retail", packagingName: "1 bánh/cái", packageQuantity: 1, unit: "bánh", minimumQuantity: 1, priceList: "Sổ giá viết tay" },
      { amount: 70000, priceType: "wholesale", packagingName: "1 bánh/cái", packageQuantity: 1, unit: "bánh", minimumQuantity: 5, priceList: "Sổ giá viết tay" },
    ] }]);
    expect(answer).toContain("Bánh xe — Đỏ mận khóa ĐL 1T");
    expect(answer).toContain("Giá lẻ: 80.000 ₫ / 1 bánh/cái · 1 bánh");
    expect(answer).toContain("Giá sỉ: 70.000 ₫ / 1 bánh/cái · 1 bánh (tối thiểu 5 1 bánh/cái)");
    expect(answer).toContain("Nguồn: Sổ giá viết tay · trang 11");
    expect(answer.match(/Bánh xe/g)).toHaveLength(1);
  });
});
