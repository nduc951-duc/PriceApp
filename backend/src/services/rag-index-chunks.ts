import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";

/** Browse published text only; never return vectors or an unfinished generation. */
export async function listIndexedChunks(client: SupabaseClient, page: number) {
  const pageSize = 20;
  const state = await client.from("rag_index_state").select("active_generation").eq("id", true).maybeSingle();
  if (state.error) throw new ApiError(503, "RAG_UNAVAILABLE", "Không tải được danh sách chunk đã lập chỉ mục.");
  const generation = state.data?.active_generation ?? null;
  if (generation === null) return { generation, page, pageSize, total: 0, items: [] };
  const result = await client.from("rag_chunks").select("id,content,metadata", { count: "exact" })
    .eq("generation_id", generation).eq("metadata->>kind", "verified_catalog")
    .order("id").range((page - 1) * pageSize, page * pageSize - 1);
  if (result.error) throw new ApiError(503, "RAG_UNAVAILABLE", "Không tải được danh sách chunk đã lập chỉ mục.");
  return { generation, page, pageSize, total: result.count ?? 0, items: (result.data ?? []).map(row => ({
    id: row.id as number, content: row.content as string,
    productName: typeof row.metadata?.product_name === "string" ? row.metadata.product_name : "",
    variantName: typeof row.metadata?.variant_name === "string" ? row.metadata.variant_name : "",
  })) };
}
