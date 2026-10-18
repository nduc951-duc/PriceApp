import { createClient } from "@/lib/supabase/client";
import type { ApiPaths } from "./generated/api-types";

type ApiErrorEnvelope = ApiPaths["/api/v1/me"]["get"]["responses"]["401"]["content"]["application/json"];

function isApiErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== "object" || value === null || !("error" in value) || typeof value.error !== "object" || value.error === null) return false;
  return "code" in value.error && typeof value.error.code === "string";
}

const statusMessages: Record<number, string> = {
  400: "Yêu cầu chưa hợp lệ. Vui lòng kiểm tra lại.",
  401: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.",
  403: "Tài khoản của bạn chưa được cấp quyền thực hiện thao tác này.",
  404: "Không tìm thấy dữ liệu được yêu cầu.",
  409: "Dữ liệu vừa được người khác cập nhật. Hãy tải lại rồi thử lại.",
  422: "Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.",
  429: "Cửa hàng đang nhận nhiều yêu cầu. Vui lòng đợi ít phút rồi thử lại.",
  503: "Dịch vụ đang tạm thời gián đoạn. Vui lòng thử lại sau.",
};

const codeMessages: Record<string, string> = {
  SESSION_REQUIRED: statusMessages[401],
  AUTH_NOT_CONFIGURED: "Chưa cấu hình đăng nhập. Vui lòng báo quản trị viên.",
  API_NOT_CONFIGURED: "Chưa cấu hình máy chủ API. Vui lòng báo quản trị viên.",
  VERSION_CONFLICT: statusMessages[409],
  SOURCE_CHANGED: "Nguồn dữ liệu vừa thay đổi. Hãy tải lại rồi thử lại.",
  INVALID_INPUT: statusMessages[422],
  INVALID_API_RESPONSE: "Máy chủ trả về dữ liệu không đúng định dạng.",
  API_UNAVAILABLE: statusMessages[503],
  TOO_MANY_REQUESTS: statusMessages[429],
  CONFLICT: "Giá vừa thay đổi. Kiểm tra lại giỏ hàng rồi gửi yêu cầu lần nữa.",
};

export class ApiRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(codeMessages[code] ?? statusMessages[status] ?? "Đã xảy ra lỗi. Vui lòng thử lại.");
    this.name = "ApiRequestError";
  }
}

/** Calls the configured API with the current caller session. */
async function sendApi<T>(path: string, init: RequestInit, options: {
  acceptedStatuses?: readonly number[];
  validateAcceptedResponse?: (value: unknown) => value is T;
}, accessToken?: string): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) throw new ApiRequestError(503, "API_NOT_CONFIGURED");
  const baseUrl = new URL(base);
  const url = new URL(path, baseUrl);
  if (!path.startsWith("/api/v1/") || url.origin !== baseUrl.origin || !url.pathname.startsWith("/api/v1/")) {
    throw new ApiRequestError(400, "INVALID_API_PATH");
  }
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");
  if (init.body !== undefined && init.body !== null && !headers.has("Content-Type") && !(typeof FormData !== "undefined" && init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(url.toString(), { ...init, headers, cache: "no-store" });
  } catch {
    throw new ApiRequestError(503, "API_UNAVAILABLE");
  }
  if (!response.ok) {
    let code = "API_REQUEST_FAILED";
    try {
      const body: unknown = await response.json();
      const hasError = isApiErrorEnvelope(body);
      if (options.acceptedStatuses?.includes(response.status) && !hasError) {
        if (options.validateAcceptedResponse?.(body)) return body;
        code = "INVALID_API_RESPONSE";
      }
      if (hasError) code = body.error.code;
    } catch { /* error response is not JSON */ }
    throw new ApiRequestError(response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

/** Calls the configured API with the current caller session. */
export async function requestApi<T>(path: string, init: RequestInit = {}, options: {
  acceptedStatuses?: readonly number[];
  validateAcceptedResponse?: (value: unknown) => value is T;
} = {}): Promise<T> {
  const supabase = createClient();
  if (!supabase) throw new ApiRequestError(503, "AUTH_NOT_CONFIGURED");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new ApiRequestError(401, "SESSION_REQUIRED");
  return sendApi(path, init, options, data.session.access_token);
}

/** Calls a deliberately public endpoint without reading or requiring a staff session. */
export function requestPublicApi<T>(path: string, init: RequestInit = {}, options: {
  acceptedStatuses?: readonly number[];
  validateAcceptedResponse?: (value: unknown) => value is T;
} = {}): Promise<T> {
  return sendApi(path, init, options);
}

export const apiRequest = requestApi;
