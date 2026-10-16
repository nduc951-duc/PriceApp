import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embedTexts: vi.fn(), generateAnswer: vi.fn(),
}));

vi.mock("./provider.js", () => ({
  embeddingModel: () => "test-1024", embedTexts: mocks.embedTexts,
  generateGroundedAnswer: mocks.generateAnswer,
  RagProviderUnavailableError: class RagProviderUnavailableError extends Error {},
}));

import { queryRag } from "../services/rag-query.service.js";
import { RagProviderUnavailableError } from "./provider.js";
import type { SupabaseClient } from "@supabase/supabase-js";
let client: SupabaseClient;

const ask = (question = "Giá tắc kê sắt 6x50?") => queryRag({ question }, client);

function clientWithPrice(amount: () => number | null, sourceActive = true, trackReads?: (name: string) => () => void, variantIds = [1]) {
  return {
    rpc: vi.fn(async (name: string) => {
      if (name === "match_rag_chunks") return { data: sourceActive ? variantIds.map((variantId, index) => ({ id: 9 + index, chunk_key: `page:${variantId}:variant:${variantId}:0`, source_page_id: variantId, source_revision: null, source_start: null, source_end: null, product_variant_id: variantId, content: `Tắc kê sắt ${variantId === 1 ? "6x50" : "8x50"}`, metadata: { kind: "verified_catalog", page_number: variantId }, similarity: 0.9 - index * 0.01 })) : [], error: null };
      const finish = trackReads?.(name);
      if (finish) await new Promise<void>((resolve) => setTimeout(() => { finish(); resolve(); }, 5));
      if (name === "current_rag_variant_sources") return { data: sourceActive ? variantIds.map((variantId) => ({ product_variant_id: variantId, source_page_id: variantId, page_number: variantId })) : [], error: null };
      return { data: variantIds.map((id) => ({ id, result_type: "variant" })), error: null };
    }),
    from: vi.fn((table: string) => {
      if (table === "product_variants") return { select: () => ({ in: () => ({ eq: () => ({ eq: async () => {
        const finish = trackReads?.("prices");
        if (finish) await new Promise<void>((resolve) => setTimeout(() => { finish(); resolve(); }, 5));
        return { data: variantIds.map((id) => ({
          id, display_name: `Tắc kê sắt ${id === 1 ? "6x50" : "8x50"}`, raw_specification: id === 1 ? "6x50" : "8x50", verification_status: "verified",
          products: { name: "Tắc kê sắt", categories: { name: "Tắc kê" }, product_aliases: [] },
          variant_sources: [{ source_page_id: id, source_pages: { page_number: id } }],
          packaging_options: [{ id: id + 1, name: "Bịch", quantity: 10, base_unit: "cái", note: null, prices: amount() === null ? [] : [{
            id: id + 2, version: 1, amount: amount(), price_type: "retail", minimum_quantity: 1, active: true,
            valid_from: "2020-01-01T00:00:00Z", valid_to: null,
            price_lists: { name: "Sổ giá", effective_date: "2020-01-01", suppliers: { name: "Cửa hàng" } },
          }] }],
        })), error: null };
      } }) }) }) };
      if (table === "source_pages") return { select: () => ({ in: async () => {
        const finish = trackReads?.("source-pages");
        if (finish) await new Promise<void>((resolve) => setTimeout(() => { finish(); resolve(); }, 5));
        return { data: variantIds.map((id) => ({ id, page_number: id })), error: null };
      } }) };
      throw new Error(table);
    }),
  };
}

describe("RAG query uses current SQL prices", () => {
  beforeEach(() => {
    mocks.embedTexts.mockClear();
    mocks.generateAnswer.mockClear();
    mocks.embedTexts.mockResolvedValue([Array(1024).fill(0.01)]);
    mocks.generateAnswer.mockResolvedValue("Giá được lấy từ SQL [Trang 1].");
  });

  it("reads an updated price on the next question without rebuilding embeddings", async () => {
    let amount = 10000;
    client = clientWithPrice(() => amount) as unknown as SupabaseClient;
    const first = await ask();
    amount = 12000;
    const second = await ask();
    expect(first.items[0].prices[0]).toMatchObject({ id: 3, amount: 10000 });
    expect(second.items[0].prices[0]).toMatchObject({ id: 3, amount: 12000 });
    expect(second.retrieval.trace).toMatchObject({ chunkIds: [9], variantIds: [1], priceIds: [3] });
    expect(mocks.embedTexts).toHaveBeenCalledWith(["Giá tắc kê sắt 6x50?"]);
    expect(first.answer).toContain("10.000");
    expect(second.answer).toContain("12.000");
    expect(second.answer).toContain("10 cái");
    expect(second.answer).toContain("/ Bịch");
    expect(second.answer).toContain("Sổ giá");
    expect(second.answer).toContain("Cửa hàng");
    expect(second.answer).toContain("trang 1");
    expect(second.sources).toMatchObject([{ pageNumber: 1, evidenceKind: "verified_catalog", sourceRevision: null, sourceSpan: null, verifiedVariantId: 1 }]);
    expect(mocks.generateAnswer).not.toHaveBeenCalled();
  });

  it("uses only public verified-catalog RPCs for guest price questions", async () => {
    const publicRpc = vi.fn(async (name: string) => {
      if (name === "match_public_rag_chunks") return { data: [{ id: 9, chunk_key: "page:1:variant:1:0", source_page_id: 1, source_revision: null, source_start: null, source_end: null, product_variant_id: 1, content: "Tắc kê sắt 6x50", metadata: { kind: "verified_catalog", page_number: 1 }, similarity: 0.9 }], error: null };
      if (name === "search_public_rag_catalog") return { data: [{ id: 1, result_type: "variant", relevance: 90 }], error: null };
      if (name === "current_public_rag_variant_sources") return { data: [{ product_variant_id: 1, source_page_id: 1, page_number: 1 }], error: null };
      if (name === "get_public_rag_catalog") return { data: [{ variant_id: 1, display_name: "Tắc kê sắt 6x50", raw_specification: "6x50", verification_status: "verified", product_name: "Tắc kê sắt", category_name: "Tắc kê", source_pages: [1], packaging_id: 2, packaging_name: "Bịch", package_quantity: 10, unit: "cái", package_note: "", price_id: 3, price_version: 1, price_amount: 12000, price_type: "retail", minimum_quantity: 1, price_list_name: "Sổ giá", supplier_name: "Cửa hàng" }], error: null };
      throw new Error(`Unexpected RPC ${name}`);
    });
    const publicClient = { rpc: publicRpc, from: vi.fn(() => { throw new Error("Guest queries must not read tables directly"); }) } as unknown as SupabaseClient;

    const body = await queryRag({ question: "Giá tắc kê sắt 6x50?" }, publicClient, {}, { publicCatalogOnly: true });

    expect(body.status).toBe("answered");
    expect(body.items[0].prices[0]).toMatchObject({ amount: 12000, verificationStatus: "verified" });
    expect(body.sources[0]).toMatchObject({ pageNumber: 1, evidenceKind: "verified_catalog" });
    expect(publicRpc.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining([
      "match_public_rag_chunks", "search_public_rag_catalog", "current_public_rag_variant_sources", "get_public_rag_catalog",
    ]));
  });

  it("caps guest candidate IDs at the public RPC limit", async () => {
    const vectorIds = Array.from({ length: 8 }, (_, index) => index + 1);
    const lexicalIds = Array.from({ length: 8 }, (_, index) => index + 9);
    let requestedPriceIds: number[] = [];
    const publicRpc = vi.fn(async (name: string, args: { p_variant_ids?: number[] }) => {
      if (name === "match_public_rag_chunks") return { data: vectorIds.map((id) => ({ id: id + 100, chunk_key: `page:1:variant:${id}:0`, source_page_id: 1, source_revision: null, source_start: null, source_end: null, product_variant_id: id, content: "Tắc kê sắt 6x50", metadata: { kind: "verified_catalog", page_number: 1 }, similarity: 0.9 })), error: null };
      if (name === "search_public_rag_catalog") return { data: lexicalIds.map((id) => ({ id, result_type: "variant", relevance: 50 })), error: null };
      if (name === "current_public_rag_variant_sources") return { data: [{ product_variant_id: 1, source_page_id: 1, page_number: 1 }], error: null };
      if (name === "get_public_rag_catalog") {
        requestedPriceIds = args.p_variant_ids ?? [];
        if (requestedPriceIds.length > 8) return { data: [], error: null };
        return { data: [{ variant_id: 1, display_name: "Tắc kê sắt 6x50", raw_specification: "6x50", verification_status: "verified", product_name: "Tắc kê sắt", category_name: "Tắc kê", source_pages: [1], packaging_id: 2, packaging_name: "Bịch", package_quantity: 10, unit: "cái", package_note: "", price_id: 3, price_version: 1, price_amount: 12000, price_type: "retail", minimum_quantity: 1, price_list_name: "Sổ giá", supplier_name: "Cửa hàng" }], error: null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });
    const publicClient = { rpc: publicRpc, from: vi.fn(() => { throw new Error("Guest queries must not read tables directly"); }) } as unknown as SupabaseClient;

    const body = await queryRag({ question: "Giá tắc kê sắt 6x50?" }, publicClient, {}, { publicCatalogOnly: true });

    expect(requestedPriceIds).toHaveLength(8);
    expect(body.status).toBe("answered");
    expect(body.items.map((item) => item.id)).toEqual([1]);
  });

  it("asks the customer to choose a specification when a price question matches multiple variants", async () => {
    client = clientWithPrice(() => 10000, true, undefined, [1, 2]) as unknown as SupabaseClient;
    const body = await ask("Giá tắc kê sắt?");

    expect(body.status).toBe("clarify");
    expect(body.items).toEqual([]);
    expect(body.answer).toContain("nhóm Tắc kê");
    expect(body.answer).toContain("6x50");
    expect(body.answer).toContain("8x50");
    expect(body.answer).not.toContain("10.000");
  });

  it("compares only the explicitly named variants instead of asking to choose one", async () => {
    client = clientWithPrice(() => 10000, true, undefined, [1, 2]) as unknown as SupabaseClient;
    const body = await ask("So sánh giá tắc kê sắt 6x50 với tắc kê sắt 8x50");

    expect(body.status).toBe("answered");
    expect(body.items.map((item) => item.variant)).toEqual(["6x50", "8x50"]);
    expect(body.answer).toContain("Tắc kê sắt — 6x50");
    expect(body.answer).toContain("Tắc kê sắt — 8x50");
  });

  it("does not mark a comparison target missing when its requested package has a current price", async () => {
    client = clientWithPrice(() => 10000, true, undefined, [1, 2]) as unknown as SupabaseClient;
    const body = await ask("So sánh giá tắc kê sắt 6x50 bịch với tắc kê sắt 8x50 bịch");

    expect(body.status).toBe("answered");
    expect(body.items.map((item) => item.variant)).toEqual(["6x50", "8x50"]);
    expect(body.answer).not.toContain("Chưa tìm thấy mặt hàng hoặc giá hiện hành phù hợp");
  });

  it("names a missing comparison target instead of substituting another variant", async () => {
    client = clientWithPrice(() => 10000, true, undefined, [1]) as unknown as SupabaseClient;
    const body = await ask("So sánh giá tắc kê sắt 6x50 với tắc kê sắt 8x50");

    expect(body.status).toBe("insufficient_evidence");
    expect(body.items.map((item) => item.variant)).toEqual(["6x50"]);
    expect(body.answer).toContain("Chưa tìm thấy mặt hàng hoặc giá hiện hành phù hợp cho: tắc kê sắt 8x50");
    expect(body.answer).not.toContain("Tắc kê sắt — 8x50: 10.000");
  });

  it("does not answer an out-of-catalog price question with an unrelated retrieved item", async () => {
    client = clientWithPrice(() => 10000) as unknown as SupabaseClient;
    const body = await ask("Giá pizza Hawaii size L là bao nhiêu?");

    expect(body.status).toBe("insufficient_evidence");
    expect(body.items).toEqual([]);
    expect(body.answer).toContain("chưa tìm thấy");
  });

  it("answers public knowledge questions only from verified public catalog evidence", async () => {
    const publicRpc = vi.fn(async (name: string) => {
      if (name === "match_public_rag_chunks") return { data: [{ id: 9, chunk_key: "page:5:variant:1:0", source_page_id: 5, source_revision: null, source_start: null, source_end: null, product_variant_id: 1, content: "Vít tole — thông tin quy cách trong sổ.", metadata: { kind: "verified_catalog", page_number: 5 }, similarity: 0.9 }], error: null };
      if (name === "search_public_rag_catalog") return { data: [{ id: 1, result_type: "variant", relevance: 90 }], error: null };
      if (name === "current_public_rag_variant_sources") return { data: [{ product_variant_id: 1, source_page_id: 5, page_number: 5 }], error: null };
      if (name === "get_public_rag_catalog") return { data: [{ variant_id: 1, display_name: "Vít tole", raw_specification: "4x20", verification_status: "verified", product_name: "Vít tole", category_name: "Vít", source_pages: [5], packaging_id: 2, packaging_name: "Gói", package_quantity: 100, unit: "cái", package_note: "", price_id: 3, price_version: 1, price_amount: 12000, price_type: "retail", minimum_quantity: 1, price_list_name: "Sổ giá", supplier_name: "Cửa hàng" }], error: null };
      throw new Error(`Unexpected RPC ${name}`);
    });
    const publicClient = { rpc: publicRpc, from: vi.fn() } as unknown as SupabaseClient;
    mocks.generateAnswer.mockResolvedValue("Thông tin vít tole có trong sổ ở trang 5.");

    const body = await queryRag({ question: "Trang nào có thông tin về vít tole?" }, publicClient, {}, { publicCatalogOnly: true });

    expect(body.status).toBe("answered");
    expect(body.items).toEqual([]);
    expect(body.answer).toContain("trang 5");
    expect(body.sources).toMatchObject([{ pageNumber: 5, evidenceKind: "verified_catalog" }]);
    expect(publicClient.from).not.toHaveBeenCalled();
    expect(publicRpc.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining([
      "match_public_rag_chunks", "search_public_rag_catalog", "current_public_rag_variant_sources", "get_public_rag_catalog",
    ]));
    expect(mocks.generateAnswer).toHaveBeenCalledWith(expect.objectContaining({ question: "Trang nào có thông tin về vít tole?" }));
  });

  it("abstains from an out-of-catalog public knowledge question despite unrelated retrieval hits", async () => {
    const publicRpc = vi.fn(async (name: string) => {
      if (name === "match_public_rag_chunks") return { data: [{ id: 9, chunk_key: "page:11:variant:1:0", source_page_id: 11, source_revision: null, source_start: null, source_end: null, product_variant_id: 1, content: "Bánh xe đỏ mận ĐL 1T2.", metadata: { kind: "verified_catalog", page_number: 11 }, similarity: 0.9 }], error: null };
      if (name === "search_public_rag_catalog") return { data: [{ id: 1, result_type: "variant", relevance: 90 }], error: null };
      if (name === "current_public_rag_variant_sources") return { data: [{ product_variant_id: 1, source_page_id: 11, page_number: 11 }], error: null };
      if (name === "get_public_rag_catalog") return { data: [{ variant_id: 1, display_name: "Đỏ mận ĐL 1T2", raw_specification: "Đỏ mận ĐL 1T2", verification_status: "verified", product_name: "Bánh xe", category_name: "Bánh xe", source_pages: [11], packaging_id: 2, packaging_name: "Bánh", package_quantity: 1, unit: "cái", package_note: "", price_id: 3, price_version: 1, price_amount: 12000, price_type: "retail", minimum_quantity: 1, price_list_name: "Sổ giá", supplier_name: "Cửa hàng" }], error: null };
      throw new Error(`Unexpected RPC ${name}`);
    });
    const publicClient = { rpc: publicRpc, from: vi.fn() } as unknown as SupabaseClient;

    const body = await queryRag({ question: "Pizza Hawaii có cay không?" }, publicClient, {}, { publicCatalogOnly: true });

    expect(body.status).toBe("insufficient_evidence");
    expect(body.items).toEqual([]);
    expect(body.sources).toEqual([]);
    expect(mocks.generateAnswer).not.toHaveBeenCalled();
  });

  it("starts price, source-validity, and page-number reads concurrently", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const trackReads = () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      return () => { inFlight -= 1; };
    };
    client = clientWithPrice(() => 10000, true, trackReads) as unknown as SupabaseClient;

    await ask();

    expect(peakInFlight).toBe(3);
  });

  it("starts lexical retrieval while query embedding is still running", async () => {
    let finishEmbedding!: (vectors: number[][]) => void;
    mocks.embedTexts.mockImplementationOnce(() => new Promise<number[][]>((resolve) => { finishEmbedding = resolve; }));
    client = clientWithPrice(() => 10000) as unknown as SupabaseClient;
    const pending = ask();
    await Promise.resolve();

    expect((client.rpc as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("search_catalog", expect.any(Object));

    finishEmbedding([Array(1024).fill(0.01)]);
    await pending;
  });

  it("reports missing current prices without asking the model to invent one", async () => {
    client = clientWithPrice(() => null) as unknown as SupabaseClient;
    mocks.generateAnswer.mockClear();
    const body = await ask()
    expect(body.items[0].prices).toEqual([]);
    expect(body.answer.toLowerCase()).toContain("chưa có giá hiện hành");
    expect(mocks.generateAnswer).not.toHaveBeenCalled();
  });

  it("does not return a lexical price when the only source page was revoked", async () => {
    client = clientWithPrice(() => 10000, false) as unknown as SupabaseClient;
    const body = await ask()
    expect(body.items).toEqual([]);
    expect(body.sources).toEqual([]);
    expect(body.answer).toContain("chưa tìm thấy");
    expect(mocks.generateAnswer).not.toHaveBeenCalled();
  });

  it("maps a transient embedding-provider failure to safe RAG unavailability", async () => {
    client = clientWithPrice(() => 10000) as unknown as SupabaseClient;
    mocks.embedTexts.mockRejectedValueOnce(new RagProviderUnavailableError("provider timed out private-token"));
    await expect(ask()).rejects.toMatchObject({ statusCode: 503, code: "RAG_UNAVAILABLE", message: expect.not.stringContaining("private-token") });
  });

  it("maps a transient chat-provider failure to safe RAG unavailability", async () => {
    client = clientWithPrice(() => 10000) as unknown as SupabaseClient;
    mocks.generateAnswer.mockRejectedValueOnce(new RagProviderUnavailableError("provider timeout private-token"));
    await expect(queryRag({ question: "Tắc kê sắt 6x50?" }, client))
      .rejects.toMatchObject({ statusCode: 503, code: "RAG_UNAVAILABLE", message: expect.not.stringContaining("private-token") });
  });

  it("leaves unexpected internal errors on the 500 path", async () => {
    client = clientWithPrice(() => 10000) as unknown as SupabaseClient;
    mocks.embedTexts.mockRejectedValueOnce(new Error("internal invariant failed"));
    await expect(ask()).rejects.toThrow("internal invariant failed");
  });
});
