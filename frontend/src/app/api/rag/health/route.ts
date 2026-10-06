import { createHash } from "node:crypto";
import { authenticateRagRequest } from "@/lib/rag/auth";
import { ragJson } from "@/lib/rag/http";
import { chatModel, embedTexts, embeddingModel, generateGroundedAnswer, providerName } from "@/lib/rag/provider";

export const runtime = "nodejs";
export const maxDuration = 90;

type Check = { ok: boolean; detail: string; count?: number; dimensions?: number; model?: string; fingerprint?: string };

function failure(): Check {
  return { ok: false, detail: "Không kiểm tra được dịch vụ." };
}

export async function GET(request: Request) {
  const auth = await authenticateRagRequest(request, ["owner"]);
  if (!auth.ok) return ragJson({ error: auth.error }, { status: auth.status });

  const [database, embedding, chat] = await Promise.all([
    (async (): Promise<Check> => {
      try {
        const [{ count: pages, error: pageError }, { count: chunks, error: chunkError }] = await Promise.all([
          auth.client.from("rag_page_texts").select("source_page_id", { count: "exact", head: true }).eq("review_status", "approved"),
          auth.client.from("rag_chunks").select("id", { count: "exact", head: true }),
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
  return ragJson({ ok, provider: providerName(), database, embedding, chat }, { status: ok ? 200 : 503 });
}
