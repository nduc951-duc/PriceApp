import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";

export async function signSourceFile(client: SupabaseClient, objectPath: string) {
  const { data, error } = await client.storage.from("source-pages").createSignedUrl(objectPath, 300);
  if (error || !data?.signedUrl) throw new ApiError(403, "FORBIDDEN", "Source file unavailable");
  return { signedUrl: data.signedUrl, expiresIn: 300 as const };
}
