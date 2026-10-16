import { z } from "zod";
import { ApiRequestError } from "@/lib/api/client";
export const priceSchema=z.coerce.number().finite().nonnegative().max(999_999_999_999);
export const formatVnd=(amount:number)=>new Intl.NumberFormat("vi-VN",{style:"currency",currency:"VND",maximumFractionDigits:2}).format(amount);

export function parsePriceInput(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

export function priceWriteErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) {
    if (error.status === 409 && error.code === "CONFLICT") return "Giá đã được thay đổi hoặc dữ liệu bị trùng. Tải lại bảng giá rồi thử lại.";
    if (error.status === 403 || error.code === "FORBIDDEN") return "Tài khoản của bạn không có quyền thực hiện thao tác này.";
    if (error.status === 422 || error.code === "INVALID_INPUT") return "Thông tin chưa hợp lệ. Kiểm tra lại các trường vừa nhập.";
    if (error.status === 401) return "Phiên đăng nhập đã hết hạn. Đăng nhập lại rồi thử lại.";
  }
  if (error instanceof Error && error.message === "Offline writes are disabled") return "Đang ngoại tuyến: chỉ xem được bảng giá đã lưu. Hãy kết nối mạng để sửa giá.";
  return "Không lưu được thay đổi. Kiểm tra kết nối rồi thử lại.";
}
