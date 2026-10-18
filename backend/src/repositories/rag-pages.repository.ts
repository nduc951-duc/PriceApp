import type { SupabaseClient } from "@supabase/supabase-js";

/** Optional historical page labels for catalog provenance; no transcript access. */
export function ragPagesRepository(client: SupabaseClient) {
  return { numbers: (ids: number[]) => client.from("source_pages").select("id,page_number").in("id", ids) };
}
