import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { AuthContext } from "../services/auth.service.js";
import { listRagPages, saveRagPage } from "../services/rag-pages.service.js";

const mocks = vi.hoisted(() => ({ embeddingModel: vi.fn(), embeddingFingerprint: vi.fn(), embedTexts: vi.fn() }));
vi.mock("./provider.js", () => ({ EMBEDDING_DIMENSIONS: 1024, embeddingModel: mocks.embeddingModel, embeddingFingerprint: mocks.embeddingFingerprint, embedTexts: mocks.embedTexts }));
import { indexRag } from "../services/rag-index.service.js";

describe("migrated source review and cleanup", () => {
  it("returns approved and draft source text with its current revision", async () => {
    const rows = [
      { source_page_id: 1, title: "Trang 1", extracted_text: "đã duyệt", review_status: "approved", revision: 2, source_pages: { page_number: 1 } },
      { source_page_id: 2, title: "Trang 2", extracted_text: "bản nháp riêng", review_status: "draft", revision: 4, source_pages: { page_number: 2 } },
    ];
    const client = { from: () => ({ select: () => ({ order: async () => ({ data: rows, error: null }) }) }) } as unknown as SupabaseClient;
    const body = await listRagPages(client);
    expect(body.pages).toHaveLength(2);
    expect(body.pages[1]).toMatchObject({ sourcePageId: 2, pageNumber: 2, reviewStatus: "draft", revision: 4, extractedText: "bản nháp riêng" });
  });

  it("revokes an entire page and returns its new revision", async () => {
    const upsert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: { revision: 7 }, error: null }) }) }));
    const auth = { user: { id: "owner-id" }, role: "owner", client: { from: () => ({ upsert }) } } as unknown as AuthContext;
    const body = await saveRagPage({ sourcePageId: 1, title: "Trang 1", extractedText: "Đã đối chiếu", reviewStatus: "rejected" }, auth);
    expect(body).toMatchObject({ saved: true, reviewStatus: "rejected", revision: 7 });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ review_status: "rejected", reviewed_by: null }), { onConflict: "source_page_id" });
  });

  it("publishes an empty generation to remove stale chunks without embedding", async () => {
    mocks.embeddingModel.mockReturnValue("bge-m3");
    mocks.embeddingFingerprint.mockResolvedValue("ollama:bge-m3:digest:1024");
    const chain = (rows: unknown[]) => {
      const query: Record<string, unknown> = {};
      query.eq = () => query;
      query.order = () => query;
      query.range = async () => ({ data: rows, error: null });
      return query;
    };
    const from = vi.fn((table: string) => ({ select: () => chain(table === "rag_chunks" ? [{ chunk_key: "old" }] : []) }));
    const rpc = vi.fn(async (name: string) => ({ data: name === "rag_start_index_run"
      ? { id: 4, corpus_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", fingerprint: "lines-1100-overlap160-v1:ollama:bge-m3:digest:1024", checkpoint: 0, total_chunks: 0, changed: 0, reused: 0 }
      : { id: 4, changed: 0, reused: 0, removed: 1 }, error: null }));
    const body = await indexRag({ from, rpc } as unknown as SupabaseClient);
    expect(body).toMatchObject({ status: "completed", indexed: 0, removed: 1, chunks: 0 });
    expect(rpc).toHaveBeenCalledWith("rag_publish_index_run", { p_run_id: 4 });
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });
});
