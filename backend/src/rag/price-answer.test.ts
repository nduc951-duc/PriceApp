import { describe, expect, it } from "vitest";
import { priceAnswer, variantListAnswer } from "./price-answer.js";

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

  it("explains screw diameter and length while retaining the catalog specification", () => {
    const answer = priceAnswer([{ productName: "Vít bắn tôn", variant: "10x120", sourcePages: [], prices: [
      { amount: 25000, priceType: "retail", packagingName: "Bịch", minimumQuantity: 1 },
    ] }]);
    expect(answer).toContain("10x120");
    expect(answer).toContain("đường kính 10 ly (10 mm), chiều dài 120 mm");
  });

  it("explains an F measurement using the stated phan-to-millimeter convention", () => {
    const answer = priceAnswer([{ productName: "Bánh xe", variant: "7F5", sourcePages: [], prices: [
      { amount: 75000, priceType: "retail", packagingName: "Cái", minimumQuantity: 1 },
    ] }]);
    expect(answer).toContain("7F5");
    expect(answer).toContain("ký hiệu phân 7F5 tương đương 75 mm");
  });

  it("explains a tấc measurement embedded in a catalog variant description", () => {
    const answer = priceAnswer([{ productName: "Bánh xe", variant: "Đỏ mận khóa ĐL 1T2", sourcePages: [], prices: [
      { amount: 75000, priceType: "retail", packagingName: "Cái", minimumQuantity: 1 },
    ] }]);
    expect(answer).toContain("Đỏ mận khóa ĐL 1T2");
    expect(answer).toContain("ký hiệu tấc 1T2 tương đương 120 mm");
  });

  it("explains an F measurement embedded in a catalog variant description", () => {
    const answer = priceAnswer([{ productName: "Bánh xe", variant: "Đỏ mận khóa ĐL 7F5", sourcePages: [], prices: [
      { amount: 75000, priceType: "retail", packagingName: "Cái", minimumQuantity: 1 },
    ] }]);
    expect(answer).toContain("ký hiệu phân 7F5 tương đương 75 mm");
  });
});

describe("variantListAnswer", () => {
  it("does not attribute a broad multi-product catalog count to its first product", () => {
    const answer = variantListAnswer([
      { productName: "Tắc kê đạn", variant: "6x50", sourcePages: [2], prices: [] },
      { productName: "Bánh xe", variant: "Đỏ mận 1T", sourcePages: [11], prices: [] },
    ]);
    expect(answer).not.toContain("Tắc kê đạn có 2 quy cách");
    expect(answer).toContain("Danh mục có 2 quy cách");
    expect(answer).toContain("Bánh xe");
  });

  it("counts every variant and includes current price, unit, source, and variants without a price", () => {
    const answer = variantListAnswer([
      { productName: "Tắc kê đạn", variant: "6x50", sourcePages: [2], prices: [
        { amount: 34000, priceType: "retail", packagingName: "Bịch", packageQuantity: 10, unit: "cái", minimumQuantity: 1, priceList: "Bảng giá hiện hành" },
      ] },
      { productName: "Tắc kê đạn", variant: "8x60", sourcePages: [3], prices: [] },
    ]);

    expect(answer).toContain("2 quy cách");
    expect(answer).toContain("6x50");
    expect(answer).toContain("34.000");
    expect(answer).toContain("10 cái");
    expect(answer).toContain("Bảng giá hiện hành");
    expect(answer).toContain("trang 2");
    expect(answer).toContain("8x60");
    expect(answer).toContain("Chưa có giá hiện hành");
  });

  it("explains screw dimensions for a listed variant even when it has no current price", () => {
    const answer = variantListAnswer([
      { productName: "Vít gỗ", variant: "10 ly 140", sourcePages: [], prices: [] },
    ]);
    expect(answer).toContain("10 ly 140");
    expect(answer).toContain("đường kính 10 ly (10 mm), chiều dài 140 mm");
    expect(answer).toContain("Chưa có giá hiện hành");
  });

  it("returns a safe no-results message for an empty group", () => {
    expect(variantListAnswer([])).toContain("Chưa tìm thấy quy cách");
  });
});
