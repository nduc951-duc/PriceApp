import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { inspectAccessToken } from "@/lib/rag/auth-diagnostics";
// The project does not ship generated Supabase Database types; API tables are added via SQL migrations.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type RagRole = "owner" | "editor" | "viewer";
export async function authenticateRagRequest(request: Request, allowed: RagRole[] = ["owner", "editor", "viewer"]): Promise<
  | { ok: true; client: SupabaseClient<any>; user: User; role: RagRole }
  | { ok: false; status: number; error: string }
> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!url || !key) return { ok: false, status: 503, error: "Chưa cấu hình kết nối Supabase." };
  if (!token) return { ok: false, status: 401, error: "Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại." };

  const client = createClient<any>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) {
    if (process.env.NODE_ENV !== "production") {
      const errorDetails = userError as { name?: unknown; status?: unknown; code?: unknown } | null;
      console.warn("[rag-auth] access token rejected", {
        ...inspectAccessToken(token, url),
        errorName: typeof errorDetails?.name === "string" ? errorDetails.name : null,
        errorStatus: typeof errorDetails?.status === "number" ? errorDetails.status : null,
        errorCode: typeof errorDetails?.code === "string" ? errorDetails.code : null,
      });
    }
    return { ok: false, status: 401, error: "Không xác thực được phiên đăng nhập." };
  }
  const { data: profile, error: profileError } = await client.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (profileError || !profile?.role || !allowed.includes(profile.role as RagRole)) {
    return { ok: false, status: 403, error: "Tài khoản không có quyền thực hiện thao tác này." };
  }
  return { ok: true, client, user: userData.user, role: profile.role as RagRole };
}


