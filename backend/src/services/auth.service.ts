import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { AppEnv } from "../config/env.js";
import { ApiError } from "../middleware/errors.js";
import { inspectAccessToken } from "../middleware/auth-diagnostics.js";
import type { SupabaseFactory } from "../repositories/supabase-client.js";

export type AppRole = "owner" | "editor" | "viewer";
export type AuthContext = { user: User; client: SupabaseClient; role: AppRole };

const unauthorized = () => new ApiError(401, "UNAUTHORIZED", "Authentication required");

export async function authenticateToken(token: string, env: AppEnv, supabaseFactory: SupabaseFactory): Promise<AuthContext> {
  const diagnostic = inspectAccessToken(token, env.supabaseUrl);
  if (!diagnostic.issuerHost || diagnostic.issuerHost !== diagnostic.expectedHost || diagnostic.expired !== false) throw unauthorized();

  const client = supabaseFactory(token);
  let user: User | null = null;
  try {
    const result = await client.auth.getUser(token);
    if (result.error) {
      const status = "status" in result.error ? result.error.status : undefined;
      if (typeof status === "number" && status >= 400 && status < 500 && status !== 429) throw unauthorized();
      throw new ApiError(503, "AUTH_UNAVAILABLE", "Authentication service unavailable");
    }
    user = result.data.user;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "AUTH_UNAVAILABLE", "Authentication service unavailable");
  }
  if (!user) throw unauthorized();

  try {
    const { data, error } = await client.from("profiles").select("role").eq("id", user.id).maybeSingle();
    if (error) throw new ApiError(503, "AUTH_UNAVAILABLE", "Authentication service unavailable");
    if (!data || !["owner", "editor", "viewer"].includes(data.role)) throw new ApiError(403, "FORBIDDEN", "Access denied");
    return { user, client, role: data.role as AppRole };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "AUTH_UNAVAILABLE", "Authentication service unavailable");
  }
}
