import type { SupabaseClient } from "@supabase/supabase-js";

export async function allRagRows(query: (start: number, end: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  const rows: unknown[] = [];
  for (let start = 0;; start += 500) {
    const { data, error } = await query(start, start + 499);
    if (error) throw new Error("RAG repository unavailable");
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}

export function ragChunksRepository(client: SupabaseClient, publicCatalogOnly = false) {
  return {
    match: (vector: string, model: string) => client.rpc(publicCatalogOnly ? "match_public_rag_chunks" : "match_rag_chunks", { p_embedding: vector, p_embedding_model: model, p_match_count: 8 }),
    count: () => client.from("rag_chunks").select("id", { count: "exact", head: true }),
    latestRun: () => client.from("rag_index_runs").select("id,status,checkpoint,total_chunks,changed,reused,removed,model,corpus_hash").order("id", { ascending: false }).limit(1).maybeSingle(),
    existing: (start: number, end: number, keys: string[]) => client.from("rag_chunks").select("chunk_key,content_hash,embedding_model,embedding_fingerprint,embedding").in("chunk_key", keys).order("id").range(start, end),
    start: (hash: string, fingerprint: string, model: string, total: number) => client.rpc("rag_start_index_run", { p_corpus_hash: hash, p_fingerprint: fingerprint, p_model: model, p_total: total }),
    abandon: (id: number) => client.rpc("rag_abandon_index_run", { p_run_id: id }),
    stage: (payload: Record<string, unknown>[]) => client.from("rag_chunks").upsert(payload, { onConflict: "generation_id,chunk_key" }),
    advance: (args: { p_run_id: number; p_expected: number; p_next: number; p_changed: number; p_reused: number; p_keys: string[] }) => client.rpc("rag_advance_index_run", args),
    publish: (id: number) => client.rpc("rag_publish_index_run", { p_run_id: id }),
  };
}
