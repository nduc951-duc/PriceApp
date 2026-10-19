import { expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api/client";
import { formatVnd, parsePriceInput, priceSchema, priceWriteErrorMessage } from "../../../../src/features/pricing/validation";

it.each([-1, Number.NaN, "not-a-price"]) ("rejects invalid price value %s", (value) => {
  expect(priceSchema.safeParse(value).success).toBe(false);
});

it("accepts a zero price", () => {
  expect(priceSchema.safeParse(0)).toMatchObject({ success: true, data: 0 });
});

it.each([
  ["12345.50", 12345.5],
  ["12345,50", 12345.5],
  [" 0 ", 0],
])("parses price input %s without changing its value", (input, expected) => {
  expect(parsePriceInput(input)).toBe(expected);
});

it.each(["", "-100", "12.345", "abc", "1.000,50"]) (
  "rejects ambiguous or invalid price input %s",
  (input) => expect(parsePriceInput(input)).toBeNull(),
);

it("formats the fractional part of VND consistently", () => {
  expect(formatVnd(12345.5)).toContain("12.345,5");
});

it.each([
  [new ApiRequestError(409, "CONFLICT"), "Giá đã được thay đổi hoặc dữ liệu bị trùng. Tải lại bảng giá rồi thử lại."],
  [new ApiRequestError(403, "FORBIDDEN"), "Tài khoản của bạn không có quyền thực hiện thao tác này."],
  [new ApiRequestError(422, "INVALID_INPUT"), "Thông tin chưa hợp lệ. Kiểm tra lại các trường vừa nhập."],
  [new ApiRequestError(401, "UNAUTHORIZED"), "Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử lại."],
])("explains price write API failures safely", (error, expected) => {
  expect(priceWriteErrorMessage(error)).toBe(expected);
});
