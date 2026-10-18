import { describe, expect, it } from "vitest";
import { isVariantListIntent } from "./variant-list-intent.js";

describe("isVariantListIntent", () => {
  it.each([
    "Cửa hàng có bao nhiêu loại tắc kê đạn?",
    "Các quy cách tắc kê đạn giá bao nhiêu?",
    "Liệt kê quy cách tắc kê đạn",
    "Có các quy cách nào của tắc kê đạn?",
    "Các quy cách tắc kê đạn",
    "Cua hang co bao nhieu loai tac ke dan?",
    "Cac quy cach tac ke dan gia bao nhieu?",
    "liet ke quy cach tac ke dan",
    "Bulong có những quy cách gì?",
    "Bulong có quy cách gì?",
    "Bulong quy cách gì",
  ])("recognizes explicit list/count wording: %s", (question) => {
    expect(isVariantListIntent(question)).toBe(true);
  });

  it.each([
    "Giá tắc kê đạn bao nhiêu?",
    "Tắc kê đạn giá bao nhiêu?",
    "Giá tắc kê đạn 6x50?",
  ])("keeps ordinary price questions on the existing clarification path: %s", (question) => {
    expect(isVariantListIntent(question)).toBe(false);
  });
});
