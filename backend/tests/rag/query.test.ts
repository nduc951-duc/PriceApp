import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embedTexts: vi.fn(), generateAnswer: vi.fn(), generateBlocks: vi.fn(), generatePlan: vi.fn(),
}));

vi.mock("../../src/rag/provider.js", () => ({
  embeddingModel: () => "test-1024", embedTexts: mocks.embedTexts,
  generateGroundedAnswer: mocks.generateAnswer,
  generateGroundedResponseText: mocks.generateBlocks,
  generateQueryPlanText: mocks.generatePlan,
  RagProviderUnavailableError: class RagProviderUnavailableError extends Error {},
}));

// SQL degradation and operation unit coverage; model-first orchestration is covered in catalog-rag-regression.test.ts.
import { queryRagOperation as queryRag, queryRag as orchestrateRag } from "../../src/services/rag-query.service.js";
import { RagProviderUnavailableError } from "../../src/rag/provider.js";
import type { SupabaseClient } from "@supabase/supabase-js";
let client: SupabaseClient;

const ask = (question = "Giá tắc kê sắt 6x50?") => queryRag({ question }, client);

function clientWithPrice(amount: () => number | null, sourceActive = true, trackReads?: (name: string) => () => void, variantIds = [1], priceSource = { isSample: false, supplierActive: true }) {
  return {
    rpc: vi.fn(async (name: string) => {
      if (name === "match_rag_chunks") return { data: sourceActive ? variantIds.map((variantId, index) => ({ id: 9 + index, chunk_key: `page:${variantId}:variant:${variantId}:0`, source_page_id: variantId, source_revision: null, source_start: null, source_end: null, product_variant_id: variantId, content: `Tắc kê sắt ${variantId === 1 ? "6x50" : "8x50"}`, metadata: { kind: "verified_catalog", page_number: variantId }, similarity: 0.9 - index * 0.01 })) : [], error: null };
      const finish = trackReads?.(name);
      if (finish) await new Promise<void>((resolve) => setTimeout(() => { finish(); resolve(); }, 5));
      if (name === "current_rag_variant_sources") return { data: sourceActive ? variantIds.map((variantId) => ({ product_variant_id: variantId, source_page_id: variantId, page_number: variantId })) : [], error: null };
      return { data: variantIds.map((id) => ({ id, result_type: "variant" })), error: null };
    }),
    from: vi.fn((table: string) => {
      if (table === "product_variants") return { select: () => ({ in: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ eq: async () => {
        const finish = trackReads?.("prices");
        if (finish) await new Promise<void>((resolve) => setTimeout(() => { finish(); resolve(); }, 5));
        return { data: variantIds.map((id) => ({
          id, display_name: `Tắc kê sắt ${id === 1 ? "6x50" : "8x50"}`, raw_specification: id === 1 ? "6x50" : "8x50", verification_status: "verified",
          products: { name: "Tắc kê sắt", categories: { name: "Tắc kê" }, product_aliases: [] },
          variant_sources: [{ source_page_id: id, source_pages: { page_number: id } }],
          packaging_options: [{ id: id + 1, name: "Bịch", quantity: 10, base_unit: "cái", note: null, prices: amount() === null ? [] : [{
            id: id + 2, version: 1, amount: amount(), price_type: "retail", minimum_quantity: 1, active: true,
            valid_from: "2020-01-01T00:00:00Z", valid_to: null,
            price_lists: { name: "Sổ giá", effective_date: "2020-01-01", is_sample: priceSource.isSample, suppliers: { name: "Cửa hàng", active: priceSource.supplierActive } },
          }] }],
        })), error: null };
      } }) }) }) }) }) };
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
    mocks.embedTexts.mockReset();
    mocks.generateAnswer.mockReset();
    mocks.generateBlocks.mockReset();
    mocks.generateBlocks.mockImplementation(async ({ evidence }: { evidence: Array<{ id: string }> }) => JSON.stringify({
      blocks: [{ kind: "narrative", text: "Thông tin phù hợp được liệt kê bên dưới.", evidenceIds: evidence.slice(0, 2).map((entry) => entry.id) }],
    }));
    mocks.generatePlan.mockReset();
    mocks.generatePlan.mockImplementation(async ({ question }: { question: string }) => {
      const comparison = /so sánh/i.test(question);
      const asksPrice = /giá|bao nhiêu|báo giá/i.test(question);
      const request = { intent: comparison ? "comparison" : asksPrice ? "price_lookup" : "product_info", productText: "tắc kê sắt", specifications: [], requestedFields: [asksPrice ? "price" : "facts"], constraints: [] };
      return JSON.stringify({
        intent: comparison ? "comparison" : asksPrice ? "price_lookup" : "product_info",
        requests: comparison ? [request, request] : [request],
        confidence: 0.9,
        unresolvedFields: [],
      });
    });
    mocks.embedTexts.mockResolvedValue([Array(1024).fill(0.01)]);
    mocks.generateBlocks.mockResolvedValue(JSON.stringify({ blocks: [{ kind: "narrative", text: "Thông tin phù hợp được liệt kê bên dưới.", evidenceIds: ["chunk:9"] }] }));
  });

  it.each([
    ["sample price list", { isSample: true, supplierActive: true }],
    ["inactive supplier", { isSample: false, supplierActive: false }],
  ])("does not quote a staff price from a %s", async (_reason, priceSource) => {
    client = clientWithPrice(() => 12750, true, undefined, [1], priceSource) as unknown as SupabaseClient;
    const result = await ask();
    expect(result.status).toBe("insufficient_evidence");
    expect(result.items[0]?.prices).toEqual([]);
    expect(result.answer).not.toContain("12.750");
    expect(result.answer).toContain("Chưa có giá hiện hành");
  });

  it("does not turn a factual comparison follow-up into an unrequested price quote", async () => {
    const rpc = vi.fn(async () => ({ data: [1, 2].map((id) => ({
      variant_id: id, product_id: 8, product_name: "Tắc kê sắt", category_name: "Tắc kê", product_aliases: [],
      display_name: `${id}x50`, raw_specification: `${id}x50`, source_pages: [id],
      packaging_id: id + 10, packaging_name: "Bịch", package_quantity: 10, unit: "cái", package_note: null,
      price_id: id + 20, price_version: 1, price_amount: 12750, price_type: "retail", minimum_quantity: 1,
      price_list_name: "Sổ giá", supplier_name: "Cửa hàng",
    })), error: null }));
    const result = await queryRag({ question: "So sánh hai loại đó về chất liệu" }, { rpc } as unknown as SupabaseClient, { previousVariantIds: [1, 2] }, { publicCatalogOnly: true });
    expect(result.status).not.toBe("answered");
    expect(result.answer).not.toContain("12.750");
    expect(result.items).toEqual([]);
  });

  it("answers price and catalog facts independently without model-generated facts", async () => {
    mocks.generatePlan.mockResolvedValue(JSON.stringify({
      intent: "multi_intent",
      requests: [
        { intent: "price_lookup", productText: "tắc kê sắt", specifications: ["6x50"], requestedFields: ["price"], constraints: [] },
        { intent: "product_info", productText: "tắc kê sắt", specifications: ["6x50"], requestedFields: ["facts"], constraints: [] },
      ],
      confidence: 0.95,
    }));
    client = clientWithPrice(() => 12750) as unknown as SupabaseClient;
    const result = await orchestrateRag({ question: "Giá và thông tin tắc kê sắt 6x50?" }, client);
    expect(result.status).toBe("answered");
    expect(result.items).toMatchObject([{ id: 1, prices: [{ amount: 12750 }] }]);
    expect(result.answer).toContain("12.750");
    expect(result.answer).toContain("Đóng gói: Bịch: 10 cái");
    expect(result.sources).toEqual([]);
    expect(result.answerBlocks).toBeUndefined();
    expect(mocks.generatePlan).toHaveBeenCalledOnce();
    expect(mocks.generateBlocks).not.toHaveBeenCalled();
  });

  it("answers both SQL price and catalog facts even when the embedding provider is offline", async () => {
    mocks.generatePlan.mockResolvedValue(JSON.stringify({
      intent: "multi_intent",
      requests: [
        { intent: "price_lookup", productText: "tắc kê sắt", specifications: ["6x50"], requestedFields: ["price"], constraints: [] },
        { intent: "product_info", productText: "tắc kê sắt", specifications: ["6x50"], requestedFields: ["facts"], constraints: [] },
      ],
      confidence: 0.95,
    }));
    mocks.embedTexts.mockRejectedValueOnce(new RagProviderUnavailableError("provider timed out private-token"));
    client = clientWithPrice(() => 12750) as unknown as SupabaseClient;
    const result = await orchestrateRag({ question: "Giá và thông tin tắc kê sắt 6x50?" }, client);
    expect(result.status).toBe("answered");
    expect(result.items).toMatchObject([{ id: 1, prices: [{ amount: 12750 }] }]);
    expect(result.answer).toContain("12.750");
    expect(result.answer).toContain("6x50");
    expect(mocks.embedTexts).not.toHaveBeenCalled();
    expect(result.answer).not.toContain("private-token");
  });

  it("reads an updated price on the next question without rebuilding embeddings", async () => {
    let amount = 10000;
    client = clientWithPrice(() => amount) as unknown as SupabaseClient;
    const first = await ask();
    amount = 12000;
    const second = await ask();
    expect(first.items[0].prices[0]).toMatchObject({ id: 3, amount: 10000 });
    expect(second.items[0].prices[0]).toMatchObject({ id: 3, amount: 12000 });
    expect(second.retrieval.trace).toMatchObject({ chunkIds: [], variantIds: [1], priceIds: [3] });
    expect(mocks.embedTexts).not.toHaveBeenCalled();
    expect(first.answer).toContain("10.000");
    expect(second.answer).toContain("12.000");
    expect(second.answer).toContain("10 cái");
    expect(second.answer).toContain("/ Bịch");
    expect(second.answer).toContain("Sổ giá");
    expect(second.answer).toContain("Cửa hàng");
    expect(second.answer).toContain("trang 1");
    expect(second.items[0]?.sourcePages).toEqual([1]);
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
    expect(body.items[0]?.sourcePages).toEqual([1]);
    expect(publicRpc.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining([
      "search_public_rag_catalog", "current_public_rag_variant_sources", "get_public_rag_catalog",
    ]));
    expect(publicRpc.mock.calls.map(([name]) => name)).not.toContain("match_public_rag_chunks");
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
    expect(body.answer).toContain("8x50");
    expect(body.answer).not.toContain("Tắc kê sắt — 8x50: 10.000");
  });

  it("asks which dimension to compare when a non-price comparison does not name one", async () => {
    mocks.generatePlan.mockResolvedValueOnce(JSON.stringify({
      intent: "comparison",
      requests: [1, 2].map(() => ({ intent: "comparison", productText: "táº¯c kÃª sáº¯t", specifications: [], requestedFields: ["facts"], constraints: [] })),
      confidence: 0.9,
      unresolvedFields: [],
    }));
    client = clientWithPrice(() => 10000, true, undefined, [1, 2]) as unknown as SupabaseClient;

    const body = await queryRag({ question: "Compare the two variants" }, client);

    expect(body.status).toBe("clarify");
    expect(mocks.embedTexts).not.toHaveBeenCalled();
    expect((client.rpc as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
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
    mocks.generateBlocks.mockResolvedValue(JSON.stringify({ blocks: [{ kind: "narrative", text: "Thông tin phù hợp được liệt kê bên dưới.", evidenceIds: ["chunk:9"] }] }));

    const body = await queryRag({ question: "Trang nào có thông tin về vít tole?" }, publicClient, {}, { publicCatalogOnly: true });

    expect(body.status).toBe("answered");
    expect(body.items).toMatchObject([{ variant: "4x20", prices: [] }]);
    expect(body.answerBlocks).toBeUndefined();
    expect(body.answer).toContain("4x20");
    expect(body.sources).toEqual([]);
    expect(publicClient.from).not.toHaveBeenCalled();
    expect(publicRpc.mock.calls.map(([name]) => name)).toEqual(expect.arrayContaining([
      "search_public_rag_catalog", "current_public_rag_variant_sources", "get_public_rag_catalog",
    ]));
    expect(mocks.generateBlocks).not.toHaveBeenCalled();
  });

  it("answers a specification question without treating 'của' as a required catalog term", async () => {
    mocks.generatePlan.mockResolvedValueOnce(JSON.stringify({
      intent: "product_info",
      requests: [{ intent: "product_info", productText: "bánh xe", specifications: ["7F5"], requestedFields: ["facts"], constraints: [] }],
      confidence: 0.95,
      unresolvedFields: [],
    }));
    const publicRpc = vi.fn(async (name: string) => {
      if (name === "search_public_rag_catalog") return { data: [{ id: 252, result_type: "variant", relevance: 60 }], error: null };
      if (name === "current_public_rag_variant_sources") return { data: [{ product_variant_id: 252, source_page_id: 11, page_number: 11 }], error: null };
      if (name === "get_public_rag_catalog") return { data: [{
        variant_id: 252, display_name: "Đỏ mận khóa ĐL 7F5", raw_specification: "Đỏ mận khóa ĐL 7F5",
        verification_status: "verified", product_name: "Bánh xe", product_description: "Bánh xe dùng để giúp vật dụng di chuyển.", category_name: "Bánh xe", source_pages: [11],
        packaging_id: 145, packaging_name: "1 bánh/cái", package_quantity: 1, unit: "bánh", package_note: "",
        price_id: 145, price_version: 1, price_amount: 75000, price_type: "retail", minimum_quantity: 1,
        price_list_name: "Bảng giá hiện hành", supplier_name: "Cửa hàng",
      }], error: null };
      throw new Error(`Unexpected RPC ${name}`);
    });
    const publicClient = { rpc: publicRpc, from: vi.fn(() => { throw new Error("Guest queries must use public RPCs"); }) } as unknown as SupabaseClient;

    const result = await queryRag(
      { question: "Quy cách của bánh xe Đỏ mận khóa ĐL 7F5 là gì?" },
      publicClient,
      {},
      { publicCatalogOnly: true },
    );

    expect(result.status).toBe("answered");
    expect(result.items).toMatchObject([{ id: 252, productName: "Bánh xe", variant: "Đỏ mận khóa ĐL 7F5", verificationStatus: "verified" }]);
    expect(result.answer).toContain("Đỏ mận khóa ĐL 7F5");
    expect(result.answer).toContain("Mô tả sản phẩm: Bánh xe dùng để giúp vật dụng di chuyển.");
    expect(publicRpc.mock.calls.map(([name]) => name)).toContain("get_public_rag_catalog");
    expect(publicRpc.mock.calls.map(([name]) => name)).not.toContain("match_public_rag_chunks");
  });

  it("rejects a generated price or unit in a product-information response", async () => {
    const publicRpc = vi.fn(async (name: string) => {
      if (name === "match_public_rag_chunks") return { data: [{ id: 9, chunk_key: "page:5:variant:1:0", source_page_id: 5, source_revision: 1, source_start: 0, source_end: 20, product_variant_id: 1, content: "Vít tole đã được kiểm tra.", metadata: { kind: "verified_catalog", page_number: 5 }, similarity: 0.9 }], error: null };
      if (name === "search_public_rag_catalog") return { data: [{ id: 1, result_type: "variant", relevance: 90 }], error: null };
      if (name === "current_public_rag_variant_sources") return { data: [{ product_variant_id: 1, source_page_id: 5, page_number: 5 }], error: null };
      if (name === "get_public_rag_catalog") return { data: [{ variant_id: 1, display_name: "Vít tole", raw_specification: "4x20", verification_status: "verified", product_name: "Vít tole", category_name: "Vít", source_pages: [5], packaging_id: 2, packaging_name: "Gói", package_quantity: 100, unit: "cái", package_note: "", price_id: 3, price_version: 1, price_amount: 12000, price_type: "retail", minimum_quantity: 1, price_list_name: "Sổ giá", supplier_name: "Cửa hàng" }], error: null };
      throw new Error(`Unexpected RPC ${name}`);
    });
    const publicClient = { rpc: publicRpc, from: vi.fn() } as unknown as SupabaseClient;
    mocks.generateBlocks.mockResolvedValue(JSON.stringify({
      blocks: [{ kind: "narrative", text: "Giá là 50000 đồng mỗi cái.", evidenceIds: ["chunk:9"] }],
    }));

    const body = await queryRag({ question: "Thông tin vít tole" }, publicClient, {}, { publicCatalogOnly: true });

    expect(body.status).toBe("answered");
    expect(body.answer).not.toMatch(/50000|đồng mỗi cái/);
    expect(body.answerBlocks).toBeUndefined();
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

  it("starts current price and source-validity reads concurrently", async () => {
    let inFlight = 0;
    let peakInFlight = 0;
    const trackReads = () => {
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      return () => { inFlight -= 1; };
    };
    client = clientWithPrice(() => 10000, true, trackReads) as unknown as SupabaseClient;

    await ask();

    expect(peakInFlight).toBe(2);
  });

  it("keeps an exact catalog price lookup available without embedding service", async () => {
    mocks.embedTexts.mockRejectedValueOnce(new RagProviderUnavailableError("embedding service unavailable"));
    client = clientWithPrice(() => 10000) as unknown as SupabaseClient;
    const result = await ask();
    expect(result.status).toBe("answered");
    expect(mocks.embedTexts).not.toHaveBeenCalled();
    expect((client.rpc as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("search_catalog", expect.any(Object));
  });

  it("reports missing current prices without asking the model to invent one", async () => {
    client = clientWithPrice(() => null) as unknown as SupabaseClient;
    mocks.generateAnswer.mockClear();
    const body = await ask()
    expect(body.items[0].prices).toEqual([]);
    expect(body.answer.toLowerCase()).toContain("chưa có giá hiện hành");
    expect(mocks.generateAnswer).not.toHaveBeenCalled();
  });

  it("returns the current verified catalog price even without a scanned page", async () => {
    client = clientWithPrice(() => 10000, false) as unknown as SupabaseClient;
    const body = await ask()
    expect(body.items).toMatchObject([{ prices: [{ amount: 10000 }] }]);
    expect(body.sources).toEqual([]);
    expect(body.answer).toContain("10.000");
    expect(mocks.generateAnswer).not.toHaveBeenCalled();
  });

  it("maps a transient embedding-provider failure to safe RAG unavailability", async () => {
    client = clientWithPrice(() => 10000) as unknown as SupabaseClient;
    mocks.embedTexts.mockRejectedValueOnce(new RagProviderUnavailableError("provider timed out private-token"));
    await expect(ask()).resolves.toMatchObject({ status: "answered" });
  });

  it("maps a transient chat-provider failure to safe RAG unavailability", async () => {
    mocks.generatePlan.mockResolvedValue(JSON.stringify({ intent: "comparison", confidence: 0.95, requests: [1, 2].map(() => ({ intent: "comparison", productText: "tắc kê sắt", specifications: [], requestedFields: ["facts"], constraints: ["chất liệu"] })) }));
    client = clientWithPrice(() => 10000) as unknown as SupabaseClient;
    mocks.generateBlocks.mockRejectedValueOnce(new RagProviderUnavailableError("provider timeout private-token"));
    await expect(queryRag({ question: "So sánh tắc kê sắt 6x50 và tắc kê sắt 8x50 về chất liệu" }, client))
      .rejects.toMatchObject({ statusCode: 503, code: "RAG_UNAVAILABLE", message: expect.not.stringContaining("private-token") });
  });

  it("leaves unexpected internal errors on the 500 path", async () => {
    mocks.generatePlan.mockResolvedValue(JSON.stringify({ intent: "comparison", confidence: 0.95, requests: [1, 2].map(() => ({ intent: "comparison", productText: "tắc kê sắt", specifications: [], requestedFields: ["facts"], constraints: ["chất liệu"] })) }));
    client = clientWithPrice(() => 10000) as unknown as SupabaseClient;
    mocks.embedTexts.mockRejectedValueOnce(new Error("internal invariant failed"));
    await expect(queryRag({ question: "So sánh tắc kê sắt 6x50 và tắc kê sắt 8x50 về chất liệu" }, client)).rejects.toThrow("internal invariant failed");
  });
});

describe("RAG variant listing", () => {
  beforeEach(() => {
    mocks.embedTexts.mockReset().mockResolvedValue([Array(1024).fill(0.01)]);
    mocks.generatePlan.mockClear().mockResolvedValue(JSON.stringify({ intent: "product_info", confidence: 0.9, requests: [{ intent: "product_info", productText: "tắc kê đạn", specifications: [], requestedFields: ["facts"], constraints: [] }] }));
    mocks.generateBlocks.mockClear();
  });
  function listClient(rows: Array<Record<string, unknown>>, seedIds: number[]) {
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === "match_public_rag_chunks") return { data: seedIds.map((id, index) => ({ id: 100 + id, chunk_key: `page:${id}:variant:${id}:0`, source_page_id: id, source_revision: null, source_start: null, source_end: null, product_variant_id: id, content: `Catalog seed ${id}`, metadata: { kind: "verified_catalog", page_number: id }, similarity: 0.9 - index * 0.01 })), error: null };
      if (name === "search_public_rag_catalog") return { data: seedIds.map((id) => ({ id, result_type: "variant", relevance: 90 })), error: null };
      if (name === "list_public_rag_catalog_page") return { data: { items: rows.map((r) => ({ id: r.variant_id, product_id: r.product_id, display_name: r.display_name, raw_specification: r.raw_specification, verification_status: "verified", products: { name: r.product_name, categories: { name: r.category_name }, product_aliases: [] }, source_pages: r.source_pages, packaging_options: r.packaging_id === null ? [] : [{ id: r.packaging_id, name: r.packaging_name, quantity: r.package_quantity, base_unit: r.unit, note: r.package_note, prices: r.price_id === null ? [] : [{ id: r.price_id, version: r.price_version, amount: r.price_amount, price_type: r.price_type, minimum_quantity: 1, active: true, valid_from: "2020-01-01T00:00:00Z", valid_to: null, price_lists: { name: r.price_list_name, effective_date: "", suppliers: { name: r.supplier_name } } }] }] })), total_count: rows.length, next_cursor: null }, error: null };
      if (name === "list_public_rag_product_variants") return { data: rows, error: null };
      if (name === "current_public_rag_variant_sources") return { data: [], error: null };
      if (name === "get_public_rag_catalog") return { data: [], error: null };
      throw new Error(`Unexpected RPC ${name} ${JSON.stringify(args)}`);
    });
    return { rpc, from: vi.fn(() => { throw new Error("Public mode must not read tables directly"); }) } as unknown as SupabaseClient & { rpc: typeof rpc };
  }

  function publicLookupClient(rows: Array<Record<string, unknown>>) {
    const variantIds = [...new Set(rows.map((item) => Number(item.variant_id)))];
    const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
      if (name === "search_public_rag_catalog") return {
        data: variantIds.map((id) => ({ id, result_type: "variant", relevance: 90 })), error: null,
      };
      if (name === "current_public_rag_variant_sources") return {
        data: variantIds.map((id) => ({ product_variant_id: id, source_page_id: 5, page_number: 5 })), error: null,
      };
      if (name === "get_public_rag_catalog") return { data: rows, error: null };
      throw new Error(`Unexpected public catalog lookup RPC ${name} ${JSON.stringify(args)}`);
    });
    return { rpc, from: vi.fn(() => { throw new Error("Public mode must not read tables directly"); }) } as unknown as SupabaseClient & { rpc: typeof rpc };
  }

  const publicRow = (input: {
    product: string; variant: string; packageId: number; packageName: string; quantity: number; unit: string;
    priceId: number; amount: number; tier: string;
  }) => ({
    variant_id: 801, display_name: input.variant, raw_specification: input.variant,
    verification_status: "verified", product_name: input.product, product_description: null,
    category_name: input.product, product_aliases: [], source_pages: [5],
    packaging_id: input.packageId, packaging_name: input.packageName, package_quantity: input.quantity,
    unit: input.unit, package_note: "", price_id: input.priceId, price_version: 1,
    price_amount: input.amount, price_type: input.tier, minimum_quantity: 1,
    price_list_name: "Bảng giá hiện hành", supplier_name: "Cửa hàng",
  });

  const row = (variantId: number, productId: number, name: string, spec: string, page: number, withPrice: boolean, priceType = "retail") => ({
    product_id: productId, product_name: name, category_name: name, product_aliases: [],
    variant_id: variantId, display_name: spec, raw_specification: spec, source_pages: [page],
    packaging_id: withPrice ? variantId + 100 : null, packaging_name: withPrice ? "Bịch" : null,
    package_quantity: withPrice ? 10 : null, unit: withPrice ? "cái" : null, package_note: null,
    price_id: withPrice ? variantId + 200 : null, price_version: withPrice ? 1 : null,
    price_amount: withPrice ? 34000 : null, price_type: withPrice ? priceType : null,
    minimum_quantity: withPrice ? 1 : null, price_list_name: withPrice ? "Sổ hiện hành" : null,
    supplier_name: withPrice ? "Cửa hàng" : null,
  });

  it("answers a supported group with exact count, every variant, current prices, and explicit no-price state", async () => {
    const client = listClient([row(1, 10, "Tắc kê đạn", "6x50", 2, true), row(2, 10, "Tắc kê đạn", "8x60", 3, false)], [1]);

    const result = await queryRag({ question: "Cửa hàng có bao nhiêu loại tắc kê đạn?" }, client, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("answered");
    expect(result.items).toHaveLength(2);
    expect(result.answer).toContain("2 quy cách");
    expect(result.answer).toContain("6x50");
    expect(result.answer).toContain("34.000");
    expect(result.answer).toContain("10 cái");
    expect(result.answer).toContain("trang 2");
    expect(result.answer).toContain("8x60");
    expect(result.answer).toContain("Chưa có giá hiện hành");
    expect(client.rpc).toHaveBeenCalledWith("list_public_rag_catalog_page", expect.anything());
    expect(client.rpc).not.toHaveBeenCalledWith("get_public_rag_catalog", expect.anything());
    expect(mocks.generateAnswer).not.toHaveBeenCalled();
  });

  it("counts verified variants without the requested price tier and labels the missing tier", async () => {
    const client = listClient([
      row(1, 10, "Tắc kê đạn", "6x50", 2, true, "wholesale"),
      row(2, 10, "Tắc kê đạn", "8x60", 3, true, "retail"),
    ], [1]);

    const result = await queryRag({ question: "Cửa hàng có bao nhiêu loại tắc kê đạn giá sỉ?" }, client, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("answered");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.prices).toHaveLength(1);
    expect(result.items[1]?.prices).toEqual([]);
    expect(result.answer).toContain("2 quy cách");
    expect(result.answer).toContain("Chưa có giá sỉ hiện hành");
  });

  it("returns every matching variant price for a product family with an incomplete dimension", async () => {
    const client = listClient([
      row(11, 10, "Tắc kê sắt", "8x60", 1, true, "wholesale"),
      row(12, 10, "Tắc kê sắt", "8x80", 2, true, "wholesale"),
      row(13, 10, "Tắc kê sắt", "8x100", 3, true, "wholesale"),
      row(14, 10, "Tắc kê sắt", "8x120", 4, true, "retail"),
      row(15, 10, "Tắc kê sắt", "10x100", 5, true, "wholesale"),
    ], []);

    const result = await queryRag({ question: "Giá sỉ tắc kê sắt 8 ly là bao nhiêu?" }, client, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("answered");
    expect(result.items.map((item) => item.variant)).toEqual(["8x60", "8x80", "8x100", "8x120"]);
    expect(result.items.map((item) => item.prices.length)).toEqual([1, 1, 1, 0]);
    expect(result.answer).toContain("8x60");
    expect(result.answer).toContain("8x80");
    expect(result.answer).toContain("8x100");
    expect(result.answer).toContain("8x120");
    expect(result.answer).toContain("Chưa có giá sỉ hiện hành");
    expect(result.answer).not.toContain("10x100");
    expect(client.rpc).toHaveBeenCalledWith("list_public_rag_catalog_page", expect.objectContaining({ p_query: "tắc kê sắt" }));
  });

  it("uses the same family matching for different wording and a different product", async () => {
    const client = listClient([
      row(21, 20, "Bulong", "8x60", 1, true),
      row(22, 20, "Bulong", "8x100", 2, true),
      row(23, 20, "Bulong", "10x100", 3, true),
    ], []);

    const result = await queryRag({ question: "Báo giá các quy cách bulong 8 mm" }, client, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("answered");
    expect(result.items.map((item) => item.variant)).toEqual(["8x60", "8x100"]);
    expect(result.items.every((item) => item.prices.length === 1)).toBe(true);
    expect(result.answer).toContain("8x60");
    expect(result.answer).toContain("8x100");
    expect(result.answer).not.toContain("10x100");
    expect(client.rpc).toHaveBeenCalledWith("list_public_rag_catalog_page", expect.objectContaining({ p_query: "bulong" }));
  });

  it("filters a partial size before deciding whether a variant list is ambiguous", async () => {
    const client = listClient([
      row(31, 30, "Bulong", "8x60", 1, true),
      row(32, 30, "Bulong", "8x100", 2, true),
      row(33, 31, "Bulong đầu dù", "10x100", 3, true),
    ], []);

    const result = await queryRag({ question: "Bulong 8 ly có quy cách gì?" }, client, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("answered");
    expect(result.items.map((item) => item.variant)).toEqual(["8x60", "8x100"]);
    expect(result.answer).toContain("8x60");
    expect(result.answer).toContain("8x100");
    expect(result.answer).not.toContain("10x100");
    expect(client.rpc).toHaveBeenCalledWith("list_public_rag_catalog_page", expect.objectContaining({ p_query: "Bulong" }));
  });

  it("lists distinct parent products when the user asks what product groups are available", async () => {
    const client = listClient([
      row(41, 40, "Tắc kê sắt", "8x60", 1, true),
      row(42, 40, "Tắc kê sắt", "8x80", 2, true),
      row(43, 41, "Tắc kê đạn Đài Loan", "8 ly", 3, true),
      row(44, 42, "Tắc kê nhựa Tiến Phát", "8 ly đỏ", 4, true),
    ], []);

    const result = await queryRag({ question: "tôi muốn mua tắc kê, bên bạn có những sản phẩm gì về tắc kê" }, client, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("answered");
    expect(result.items).toEqual([]);
    expect(result.answer).toContain("Tắc kê sắt");
    expect(result.answer).toContain("Tắc kê đạn Đài Loan");
    expect(result.answer).toContain("Tắc kê nhựa Tiến Phát");
    expect(result.answer).toContain("2 quy cách");
    expect(result.answer).toMatch(/chọn|muốn xem/i);
    expect(result.answer).not.toContain("34.000");
    expect(client.rpc).toHaveBeenCalledWith("list_public_rag_catalog_page", expect.objectContaining({ p_query: "tắc kê" }));
  });

  it("suggests clearer questions using only sizes present in ambiguous verified product groups", async () => {
    const client = listClient([
      row(61, 60, "Tắc kê sắt", "8x60", 1, true),
      row(62, 60, "Tắc kê sắt", "8x100", 2, true),
      row(63, 60, "Tắc kê sắt", "10x100", 3, true),
      row(64, 61, "Tắc kê nhựa", "6 ly đỏ", 4, true),
    ], [61]);

    const result = await queryRag({ question: "Tắc kê có quy cách gì?" }, client, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("clarify");
    expect(result.answer).toContain("Tắc kê sắt: 3 quy cách; cỡ tìm thấy: 8 ly, 10 ly");
    expect(result.answer).toContain("Tắc kê nhựa: 1 quy cách; cỡ tìm thấy: 6 ly");
    expect(result.answer).toContain("Tắc kê sắt 8 ly có những quy cách nào?");
    expect(result.answer).toContain("Tắc kê sắt 10 ly có những quy cách nào?");
    expect(result.answer).toContain("Tắc kê nhựa 6 ly có những quy cách nào?");
    expect(result.answer).not.toContain("Tắc kê nhựa 8 ly");
  });

  it("returns variants for the named material family when the user says they want to buy it", async () => {
    const client = listClient([
      row(51, 50, "Tắc kê sắt", "6x50", 1, true),
      row(52, 50, "Tắc kê sắt", "8x80", 2, true),
      row(53, 51, "Tắc kê đạn Đài Loan", "8 ly", 3, true),
      row(54, 52, "Tắc kê nhựa Tiến Phát", "8 ly đỏ", 4, true),
    ], []);

    const result = await queryRag({ question: "Tôi muốn mua tắc kê sắt" }, client, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("answered");
    expect(result.items.map((item) => [item.productName, item.variant])).toEqual([
      ["Tắc kê sắt", "6x50"],
      ["Tắc kê sắt", "8x80"],
    ]);
    expect(result.answer).toContain("2 quy cách");
    expect(result.answer).not.toContain("Tắc kê đạn");
    expect(result.answer).not.toContain("Tắc kê nhựa");
    expect(client.rpc).toHaveBeenCalledWith("list_public_rag_catalog_page", expect.objectContaining({ p_query: "tắc kê sắt" }));
  });

  it("finds a named purchase family when the customer adds availability small talk", async () => {
    const client = listClient([
      row(61, 60, "Tắc kê sắt", "6x50", 1, true),
      row(62, 60, "Tắc kê sắt", "8x100", 2, true),
    ], []);

    const result = await queryRag({ question: "Tôi muốn mua tắc kê sắt, bạn có không" }, client, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("answered");
    expect(result.items.map((item) => item.variant)).toEqual(["6x50", "8x100"]);
    expect(client.rpc).toHaveBeenCalledWith("list_public_rag_catalog_page", expect.objectContaining({ p_query: "tắc kê sắt" }));
  });

  it("asks the user to choose when seeds support multiple product groups", async () => {
    const client = listClient([row(1, 10, "Tắc kê đạn", "6x50", 2, true), row(2, 20, "Vít tole", "4x20", 3, true)], [1, 2]);

    const result = await queryRag({ question: "Cửa hàng có những quy cách nào?" }, client, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("clarify");
    expect(result.items).toEqual([]);
    expect(result.answer).toContain("Tắc kê đạn");
    expect(result.answer).toContain("Vít tole");
    expect(result.answer).not.toContain("34.000");
  });

  it("finds product groups when the discovery question starts with a customer address", async () => {
    const client = listClient([
      row(71, 70, "Tắc kê sắt", "8x60", 1, true),
      row(72, 71, "Tắc kê đạn Đài Loan", "8 ly", 2, true),
      row(73, 72, "Tắc kê nhựa Tiến Phát", "8 ly đỏ", 3, true),
    ], []);

    const result = await queryRag({ question: "Bạn có sản phẩm gì về tắc kê?" }, client, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("answered");
    expect(result.answer).toContain("Tắc kê sắt");
    expect(result.answer).toContain("Tắc kê đạn Đài Loan");
    expect(result.answer).toContain("Tắc kê nhựa Tiến Phát");
    expect(client.rpc).toHaveBeenCalledWith("list_public_rag_catalog_page", expect.objectContaining({ p_query: "tắc kê" }));
  });

  it.each([
    {
      question: "Thông tin bulong 8 ly x 1F5",
      product: "Bulong",
      variant: "8 ly x 1F5",
      expectedQuery: "bulong 8 ly 1F5",
      expectedFact: "Diễn giải quy cách: ký hiệu phân 1F5 tương đương 15 mm.",
    },
    {
      question: "Đóng gói tắc kê sắt 8x100 thế nào?",
      product: "Tắc kê sắt",
      variant: "8x100",
      expectedQuery: "tắc kê 8x100",
      expectedFact: "Đóng gói: 10 con/bịch: 10 con.",
    },
  ])("answers the catalog fact question '$question' from the matching product variant", async ({ question, product, variant, expectedQuery, expectedFact }) => {
    const resultClient = publicLookupClient([publicRow({
      product, variant, packageId: 811, packageName: "10 con/bịch", quantity: 10, unit: "con",
      priceId: 812, amount: 30000, tier: "retail",
    })]);

    const result = await queryRag({ question }, resultClient, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("answered");
    expect(result.answer).toContain(variant);
    expect(result.answer).toContain(expectedFact);
    expect(resultClient.rpc).toHaveBeenCalledWith("search_public_rag_catalog", expect.objectContaining({ p_query: expectedQuery }));
    expect(mocks.generatePlan).not.toHaveBeenCalled();
    expect(mocks.generateBlocks).not.toHaveBeenCalled();
  });

  it("matches a requested package quantity when the catalog uses a different container word", async () => {
    const resultClient = publicLookupClient([publicRow({
      product: "Tắc kê sắt", variant: "8x100", packageId: 821, packageName: "10 con/bịch", quantity: 10, unit: "con",
      priceId: 822, amount: 30000, tier: "retail",
    })]);

    const result = await queryRag({ question: "Giá tắc kê sắt 8x100 gói 10 con?" }, resultClient, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("answered");
    expect(result.items).toMatchObject([{ variant: "8x100", prices: [{ amount: 30000, packageQuantity: 10, unit: "con" }] }]);
    expect(result.answer).toContain("30.000");
    expect(result.answer).not.toContain("Chưa tìm thấy");
  });

  it("returns every current package price when an exact variant price question omits the package", async () => {
    const resultClient = publicLookupClient([
      publicRow({
        product: "Tắc kê sắt", variant: "8x100", packageId: 831, packageName: "10 con/bịch", quantity: 10, unit: "con",
        priceId: 832, amount: 30000, tier: "retail",
      }),
      publicRow({
        product: "Tắc kê sắt", variant: "8x100", packageId: 833, packageName: "95 con/bịch", quantity: 95, unit: "con",
        priceId: 834, amount: 184000, tier: "wholesale",
      }),
    ]);

    const result = await queryRag({ question: "Giá tắc kê sắt 8x100 bao nhiêu?" }, resultClient, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("answered");
    expect(result.items).toMatchObject([{ variant: "8x100", prices: [
      { amount: 30000, packagingName: "10 con/bịch" },
      { amount: 184000, packagingName: "95 con/bịch" },
    ] }]);
    expect(result.answer).toContain("30.000");
    expect(result.answer).toContain("184.000");
  });

  it("rejects an unrelated expanded group rather than substituting its products", async () => {
    const client = listClient([row(1, 10, "Tắc kê đạn", "6x50", 2, true)], [1]);

    const result = await queryRag({ question: "Liệt kê quy cách pizza Hawaii" }, client, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("insufficient_evidence");
    expect(result.items).toEqual([]);
    expect(result.answer).toContain("chưa tìm thấy");
    expect(result.answer).not.toContain("34.000");
  });

  it("asks which product to list when a generic request has no product terms", async () => {
    const client = listClient([row(1, 10, "Tắc kê đạn", "6x50", 2, true)], [1]);

    const result = await queryRag({ question: "Cửa hàng có những quy cách nào?" }, client, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("clarify");
    expect(result.items).toEqual([]);
    expect(result.answer).toContain("mặt hàng nào");
    expect(result.answer).not.toContain("34.000");
  });
});
