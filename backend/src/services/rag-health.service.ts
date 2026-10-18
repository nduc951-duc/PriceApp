import type { SupabaseClient } from "@supabase/supabase-js";


import { createHash } from "node:crypto";
import { chatModel, embedTexts, embeddingModel, generateGroundedAnswer, providerName } from "../rag/provider.js";


type Check = { catalogVariants?: number; embeddedVariants?: number; missingVariants?: number; activeGeneration?: number | null; ok: boolean; detail: string; count?: number; dimensions?: number; model?: string; fingerprint?: string };

function failure(): Check {
  return { ok: false, detail: "Không kiểm tra được dịch vụ." };
}

export async function healthRag(client: SupabaseClient) {


  const [database, embedding, chat] = await Promise.all([
    (async (): Promise<Check> => {
      try {
        const [state] = await Promise.all([
          client.from("rag_index_state").select("active_generation").eq("id", true).maybeSingle(),
        ]);
        if (state.error) throw new Error("Catalog diagnostics unavailable");
        const catalogIds = new Set<number>();
        for (let start = 0;; start += 500) {
          const catalog = await client.from("product_variants")
            .select("id,products!inner(categories!inner(id))")
            .eq("active", true).eq("verification_status", "verified")
            .eq("products.active", true).eq("products.categories.active", true)
            .order("id").range(start, start + 499);
          if (catalog.error) throw new Error("Catalog diagnostics unavailable");
          for (const row of catalog.data) catalogIds.add(row.id);
          if (catalog.data.length < 500) break;
        }
        const generation = state.data?.active_generation ?? null;
        const variants = new Set<number>();
        let count = 0;
        if (generation !== null) for (let start = 0;; start += 500) {
          const result = await client.from("rag_chunks").select("product_variant_id,embedding_model")
            .eq("generation_id", generation).eq("metadata->>kind", "verified_catalog").order("id").range(start, start + 499);
          if (result.error) throw new Error("Catalog index diagnostics unavailable");
          for (const row of result.data) if (row.product_variant_id !== null && catalogIds.has(row.product_variant_id)) {
            count += 1;
            if (row.embedding_model === process.env.RAG_EMBEDDING_MODEL?.trim()) variants.add(row.product_variant_id);
          }
          if (result.data.length < 500) break;
        }
        const total = catalogIds.size;
        return { ok: true, detail: `${total} verified catalog variants; ${count} active catalog chunks; ${variants.size} variants embedded with the configured model.`,
          count, catalogVariants: total, embeddedVariants: variants.size, missingVariants: Math.max(0, total - variants.size), activeGeneration: generation };

      } catch { return failure(); }
    })(),
    (async (): Promise<Check> => {
      try {
        const model = embeddingModel();
        const [vector] = await embedTexts(["kiểm tra kết nối embedding tiếng Việt"]);
        if (!vector) throw new Error("Embedding không trả vector.");
        const fingerprint = createHash("sha256")
          .update(`${providerName()}:${model}:${vector.map((value) => value.toFixed(5)).join(",")}`)
          .digest("hex").slice(0, 16);
        return { ok: true, detail: "Embedding hoạt động.", model, dimensions: vector.length, fingerprint };
      } catch { return failure(); }
    })(),
    (async (): Promise<Check> => {
      try {
        const model = chatModel();
        await generateGroundedAnswer({ question: "Trả lời một từ: OK", evidence: [] });
        return { ok: true, detail: "Chat model hoạt động.", model };
      } catch { return failure(); }
    })(),
  ]);

  const ok = database.ok && embedding.ok && chat.ok;
  return { ok, provider: providerName(), database, embedding, chat };
}
