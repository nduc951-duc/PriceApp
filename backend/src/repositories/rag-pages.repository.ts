import type { SupabaseClient } from "@supabase/supabase-js";

export function ragPagesRepository(client: SupabaseClient) {
  return {
    list: () => client.from("rag_page_texts").select("source_page_id,title,extracted_text,review_status,revision,source_pages!inner(page_number)").order("source_page_id"),
    save: (row: Record<string, unknown>) => client.from("rag_page_texts").upsert(row, { onConflict: "source_page_id" }).select("revision").single(),
    numbers: (ids: number[]) => client.from("source_pages").select("id,page_number").in("id", ids),
    approved: (start: number, end: number) => client.from("rag_page_texts").select("source_page_id,title,extracted_text,revision,source_pages!inner(page_number,verification_status)").eq("review_status", "approved").order("source_page_id").range(start, end),
    rejected: (start: number, end: number) => client.from("rag_page_texts").select("source_page_id").eq("review_status", "rejected").order("source_page_id").range(start, end),
    approvedCount: () => client.from("rag_page_texts").select("source_page_id", { count: "exact", head: true }).eq("review_status", "approved"),
  };
}
