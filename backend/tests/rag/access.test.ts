import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ embeddingModel: vi.fn(), embeddingFingerprint: vi.fn(), embedTexts: vi.fn() }));
vi.mock("../../src/rag/provider.js", () => ({ EMBEDDING_DIMENSIONS: 1024, embeddingModel: mocks.embeddingModel, embeddingFingerprint: mocks.embeddingFingerprint, embedTexts: mocks.embedTexts }));
import { indexRag } from "../../src/services/rag-index.service.js";

describe("catalog generation cleanup", () => {
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
      ? { id: 4, corpus_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", fingerprint: "catalog-1100-overlap160-v5:ollama:bge-m3:digest:1024", checkpoint: 0, total_chunks: 0, changed: 0, reused: 0 }
      : { id: 4, changed: 0, reused: 0, removed: 1 }, error: null }));
    const body = await indexRag({ from, rpc } as unknown as SupabaseClient);
    expect(body).toMatchObject({ status: "completed", indexed: 0, removed: 1, chunks: 0 });
    expect(rpc).toHaveBeenCalledWith("rag_publish_index_run", { p_run_id: 4 });
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });
});
