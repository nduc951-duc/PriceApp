import type { SupabaseClient } from "@supabase/supabase-js";
import { ragChunksRepository } from "../repositories/rag-chunks.repository.js";
import { ragPagesRepository } from "../repositories/rag-pages.repository.js";
import { createHash } from "node:crypto";
import { chatModel, embedTexts, embeddingModel, generateGroundedAnswer, providerName } from "../rag/provider.js";


type Check = { ok: boolean; detail: string; count?: number; dimensions?: number; model?: string; fingerprint?: string };

function failure(): Check {
  return { ok: false, detail: "Không kiểm tra được dịch vụ." };
}

export async function healthRag(client: SupabaseClient) {
  const chunksRepo = ragChunksRepository(client);
  const pagesRepo = ragPagesRepository(client);
  const [database, embedding, chat] = await Promise.all([
    (async (): Promise<Check> => {
      try {
        const [{ count: pages, error: pageError }, { count: chunks, error: chunkError }] = await Promise.all([
          pagesRepo.approvedCount(),
          chunksRepo.count(),
        ]);
        if (pageError || chunkError) throw new Error(pageError?.message ?? chunkError?.message ?? "Không đọc được schema RAG.");
        return { ok: true, detail: `${pages ?? 0} trang đã duyệt; ${chunks ?? 0} chunk đã lưu.`, count: chunks ?? 0 };
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
