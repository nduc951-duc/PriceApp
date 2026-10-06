import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";

export async function signSourceFile(client: SupabaseClient, objectPath: string) {
  try {
    const { data, error } = await client.storage.from("source-pages").createSignedUrl(objectPath, 300);
    if (error) {
      const status = error.status ?? Number(error.statusCode);
      if (status === 401 || status === 403 || status === 404) {
        throw new ApiError(403, "FORBIDDEN", "Source file unavailable");
      }
      throw new ApiError(503, "INTERNAL_ERROR", "Source file service unavailable");
    }
    if (!data?.signedUrl) throw new ApiError(503, "INTERNAL_ERROR", "Source file service unavailable");
    return { signedUrl: data.signedUrl, expiresIn: 300 as const };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "INTERNAL_ERROR", "Source file service unavailable");
  }
}
