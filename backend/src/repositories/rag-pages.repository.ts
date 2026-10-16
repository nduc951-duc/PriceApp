import type { SupabaseClient } from "@supabase/supabase-js";

export function ragPagesRepository(client: SupabaseClient) {
  return {
    list: () => client.from("rag_page_texts").select("source_page_id,title,extracted_text,review_status,revision,reviewed_by,reviewed_at,updated_at,chunk_settings,chunk_links,source_pages!inner(page_number,storage_path,verification_status)").order("source_page_id"),
    save: (row: Record<string, unknown>) => client.from("rag_page_texts").upsert(row, { onConflict: "source_page_id" }).select("revision").single(),
    activeGeneration: () => client.from("rag_index_state").select("active_generation").eq("id", true).single(),
    indexedChunks: (generation: number, start: number, end: number) => client.from("rag_chunks").select("source_page_id,updated_at").eq("generation_id", generation).order("id").range(start, end),
    variants: (pageIds: number[]) => client.from("product_variants").select("id,display_name,raw_specification,products(name),variant_sources!inner(source_page_id)").eq("active", true).eq("verification_status", "verified").in("variant_sources.source_page_id", pageIds).order("id"),
    latestRun: () => client.from("rag_index_runs").select("status,error_message,updated_at").order("id", { ascending: false }).limit(1).maybeSingle(),
    numbers: (ids: number[]) => client.from("source_pages").select("id,page_number").in("id", ids),
    approved: (start: number, end: number) => client.from("rag_page_texts").select("source_page_id,title,extracted_text,revision,chunk_settings,chunk_links,source_pages!inner(page_number,verification_status)").eq("review_status", "approved").order("source_page_id").range(start, end),
    rejected: (start: number, end: number) => client.from("rag_page_texts").select("source_page_id").eq("review_status", "rejected").order("source_page_id").range(start, end),
    approvedCount: () => client.from("rag_page_texts").select("source_page_id", { count: "exact", head: true }).eq("review_status", "approved"),
  };
}
