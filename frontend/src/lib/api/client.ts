import { createClient } from "@/lib/supabase/client";

export class ApiRequestError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

/** Calls the configured API with the current caller session. */
export async function requestApi<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!base) throw new ApiRequestError(503, "API_NOT_CONFIGURED");
  const baseUrl = new URL(base);
  const url = new URL(path, baseUrl);
  if (!path.startsWith("/api/v1/") || url.origin !== baseUrl.origin || !url.pathname.startsWith("/api/v1/")) {
    throw new ApiRequestError(400, "INVALID_API_PATH");
  }
  const supabase = createClient();
  if (!supabase) throw new ApiRequestError(503, "AUTH_NOT_CONFIGURED");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new ApiRequestError(401, "Authentication required");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${data.session.access_token}`);
  const response = await fetch(url.toString(), { ...init, headers, cache: "no-store" });
  if (!response.ok) {
    let code = "API_REQUEST_FAILED";
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "error" in body) {
        const failure = body.error;
        if (typeof failure === "object" && failure !== null && "code" in failure && typeof failure.code === "string") code = failure.code;
      }
    } catch { /* error response is not JSON */ }
    throw new ApiRequestError(response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
