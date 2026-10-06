import { expect, it } from "vitest";
import { ApiRequestError } from "@/lib/api/client";
import { priceWriteErrorMessage } from "./validation";

it.each([
  [new ApiRequestError(409, "CONFLICT"), "Giá đã được thay đổi hoặc dữ liệu bị trùng. Tải lại bảng giá rồi thử lại."],
  [new ApiRequestError(403, "FORBIDDEN"), "Tài khoản của bạn không có quyền thực hiện thao tác này."],
  [new ApiRequestError(422, "INVALID_INPUT"), "Thông tin chưa hợp lệ. Kiểm tra lại các trường vừa nhập."],
  [new ApiRequestError(401, "UNAUTHORIZED"), "Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử lại."],
])("explains price write API failures safely", (error, expected) => {
  expect(priceWriteErrorMessage(error)).toBe(expected);
});
