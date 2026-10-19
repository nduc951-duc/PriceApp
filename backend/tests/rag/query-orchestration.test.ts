import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embedTexts: vi.fn(),
  generateQueryPlanText: vi.fn(),
  generateGroundedResponseText: vi.fn(),
}));

vi.mock("../../src/rag/provider.js", () => ({
  embeddingModel: () => "test-1024",
  embedTexts: mocks.embedTexts,
  generateQueryPlanText: mocks.generateQueryPlanText,
  generateGroundedResponseText: mocks.generateGroundedResponseText,
  RagProviderUnavailableError: class RagProviderUnavailableError extends Error {},
}));

import { queryRag } from "../../src/services/rag-query.service.js";
import type { SupabaseClient } from "@supabase/supabase-js";

function catalogRow(id: number, page: number, amount: number | null) {
  return {
    id,
    product_id: 8,
    display_name: `Tắc kê đạn ${id}`,
    raw_specification: `${id}x50`,
    verification_status: "verified",
    products: { name: "Tắc kê đạn", categories: { name: "Tắc kê" }, product_aliases: [{ alias: "tắc kê nở" }] },
    source_pages: [page],
    packaging_options: amount === null ? [] : [{
      id: id + 100,
      name: "Bịch",
      quantity: 10,
      base_unit: "cái",
      note: null,
      prices: [{
        id: id + 200, version: 2, amount, price_type: "retail", minimum_quantity: 1,
        active: true, valid_from: "2026-01-01T00:00:00.000Z", valid_to: null,
        price_lists: { name: "Bảng giá hiện hành", effective_date: "2026-01-01", suppliers: { name: "Cửa hàng" } },
      }],
    }],
  };
}

describe("RAG orchestration for complete catalog requests", () => {
  beforeEach(() => {
    mocks.embedTexts.mockReset();
    mocks.generateQueryPlanText.mockReset();
    mocks.generateGroundedResponseText.mockReset();
    mocks.embedTexts.mockResolvedValue([Array(1024).fill(0.1)]);
  });

  it("abstains when the complete catalog query has no verified match", async () => {
    mocks.generateQueryPlanText.mockResolvedValue(JSON.stringify({
      intent: "catalog_list",
      requests: [{ intent: "catalog_list", productText: "vật tư không có", specifications: [], requestedFields: ["variants"], constraints: [] }],
      confidence: 0.95,
    }));
    const rpc = vi.fn(async (name: string) => name === "match_public_rag_chunks" ? { data: [], error: null } : { data: { items: [], total_count: 0, next_cursor: null }, error: null });
    const result = await queryRag({ question: "Có những loại vật tư không có nào?" }, { rpc } as unknown as SupabaseClient, {}, { publicCatalogOnly: true });
    expect(result.status).toBe("insufficient_evidence");
    expect(result.items).toEqual([]);
    expect(result.sources).toEqual([]);
  });

  it("answers each independently named catalog group instead of silently dropping the second", async () => {
    mocks.generateQueryPlanText.mockResolvedValue(JSON.stringify({
      intent: "multi_intent",
      requests: ["tắc kê đạn", "bánh xe"].map((productText) => ({
        intent: "catalog_list", productText, specifications: [], requestedFields: ["variants"], constraints: [],
      })),
      confidence: 0.95,
    }));
    const rpc = vi.fn(async (name: string, args: { p_query: string }) => {
      if (name !== "list_public_rag_catalog_page") throw new Error(name);
      const row = catalogRow(args.p_query === "bánh xe" ? 2 : 1, 3, 34000);
      if (args.p_query === "bánh xe") row.products.name = "Bánh xe";
      return { data: { items: [row], total_count: 1, next_cursor: null }, error: null };
    });
    const result = await queryRag({ question: "Liệt kê tắc kê đạn và bánh xe" }, { rpc } as unknown as SupabaseClient, {}, { publicCatalogOnly: true });
    expect(result.status).toBe("answered");
    expect(result.items.map((item) => item.id)).toEqual([1, 2]);
    expect(result.answer).toContain("Bánh xe");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(mocks.generateQueryPlanText).toHaveBeenCalledOnce();
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });

  it("keeps a supported list but explicitly abstains from its unsupported fact request", async () => {
    mocks.generateQueryPlanText.mockResolvedValue(JSON.stringify({
      intent: "multi_intent",
      requests: [
        { intent: "catalog_list", productText: "tắc kê đạn", specifications: [], requestedFields: ["variants"], constraints: [] },
        { intent: "product_info", productText: "tắc kê đạn", specifications: [], requestedFields: ["facts"], constraints: [] },
      ],
      confidence: 0.95,
    }));
    const rpc = vi.fn(async (name: string) => {
      if (name === "list_public_rag_catalog_page") return { data: { items: [catalogRow(1, 3, 34000)], total_count: 1, next_cursor: null }, error: null };
      if (name === "match_public_rag_chunks" || name === "search_public_rag_catalog") return { data: [], error: null };
      throw new Error(name);
    });
    const result = await queryRag({ question: "Liệt kê tắc kê đạn và cho biết chất liệu" }, { rpc } as unknown as SupabaseClient, {}, { publicCatalogOnly: true });
    expect(result.status).toBe("insufficient_evidence");
    expect(result.items.map((item) => item.id)).toEqual([1]);
    expect(result.answer).toContain("1 quy cách");
    expect(result.answer).toMatch(/chưa tìm thấy/i);
    expect(mocks.embedTexts).not.toHaveBeenCalled();
    expect(mocks.generateQueryPlanText).toHaveBeenCalledOnce();
  });

  it("uses the paged catalog source, keeps unpriced verified variants, and reports completeness", async () => {
    mocks.generateQueryPlanText.mockResolvedValue(JSON.stringify({
      intent: "catalog_list",
      requests: [{ intent: "catalog_list", productText: "tắc kê đạn", specifications: [], requestedFields: ["variants"], constraints: [] }],
      confidence: 0.92,
      unresolvedFields: [],
    }));
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      if (name === "match_public_rag_chunks") return { data: [], error: null };
      if (name !== "list_public_rag_catalog_page") throw new Error(`Unexpected RPC ${name}`);
      if (args.p_after_variant_id === null) return { data: { items: [catalogRow(1, 3, 34000)], total_count: 2, next_cursor: 1 }, error: null };
      return { data: { items: [catalogRow(2, 4, null)], total_count: 2, next_cursor: null }, error: null };
    });
    const client = { rpc } as unknown as SupabaseClient;

    const result = await queryRag({ question: "Cửa hàng có bao nhiêu loại tắc kê đạn?" }, client, {}, { publicCatalogOnly: true });

    expect(calls.filter(({ name }) => name === "list_public_rag_catalog_page").map(({ name }) => name)).toEqual(["list_public_rag_catalog_page", "list_public_rag_catalog_page"]);
    expect(calls[0]?.args).toMatchObject({ p_query: "tắc kê đạn", p_after_variant_id: null });
    expect(result.status).toBe("answered");
    expect(result.catalogPage).toEqual({ total: 2, nextCursor: null, complete: true });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.prices[0]).toMatchObject({ amount: 34000, unit: "cái", priceType: "retail" });
    expect(result.items[1]?.prices).toEqual([]);
    expect(result.answer).toContain("2 quy cách");
    expect(mocks.embedTexts).toHaveBeenCalledOnce();
  });

  it("returns a safe clarification without retrieving or embedding when planning is uncertain", async () => {
    mocks.generateQueryPlanText.mockResolvedValue(JSON.stringify({
      intent: "clarification", requests: [], confidence: 0.2, unresolvedFields: ["product"],
      clarificationQuestion: "Bạn muốn hỏi mặt hàng nào?",
    }));
    const rpc = vi.fn();
    const result = await queryRag({ question: "Cho tôi hỏi chút" }, { rpc } as unknown as SupabaseClient, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("clarify");
    expect(result.answer).toBe("Bạn muốn hỏi mặt hàng nào?");
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });

  it("satisfies a catalog list and price request together from the same current SQL page", async () => {
    mocks.generateQueryPlanText.mockResolvedValue(JSON.stringify({
      intent: "multi_intent",
      requests: [
        { intent: "catalog_list", productText: "tắc kê đạn", specifications: [], requestedFields: ["variants"], constraints: [] },
        { intent: "price_lookup", productText: "tắc kê đạn", specifications: [], requestedFields: ["price", "unit"], priceTier: "retail", constraints: [] },
      ],
      confidence: 0.9,
      unresolvedFields: [],
    }));
    const rpc = vi.fn(async (name: string) => name === "list_public_rag_catalog_page"
      ? { data: { items: [catalogRow(1, 3, 34000), catalogRow(2, 4, null)], total_count: 2, next_cursor: null }, error: null }
      : Promise.reject(new Error(`Unexpected RPC ${name}`)));

    const result = await queryRag({ question: "Liệt kê tắc kê đạn và giá lẻ" }, { rpc } as unknown as SupabaseClient, {}, { publicCatalogOnly: true });

    expect(result.catalogPage).toMatchObject({ total: 2, complete: true });
    expect(result.items[0]?.prices).toMatchObject([{ amount: 34000, priceType: "retail" }]);
    expect(result.items[1]?.prices).toEqual([]);
    expect(result.answer).toContain("Chưa có giá lẻ");
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });

  it("never claims a truncated catalog list is complete", async () => {
    mocks.generateQueryPlanText.mockResolvedValue(JSON.stringify({
      intent: "catalog_list",
      requests: [{ intent: "catalog_list", productText: "tắc kê đạn", specifications: [], requestedFields: ["variants"], constraints: [] }],
      confidence: 0.9,
      unresolvedFields: [],
    }));
    const rpc = vi.fn(async (name: string) => name === "match_public_rag_chunks" ? { data: [], error: null } : { data: { items: [catalogRow(1, 3, 34000)], total_count: 5001, next_cursor: 1 }, error: null });

    const result = await queryRag({ question: "Liệt kê tắc kê đạn" }, { rpc } as unknown as SupabaseClient, {}, { publicCatalogOnly: true });

    expect(result.catalogPage).toEqual({ total: 5001, nextCursor: 1, complete: false });
    expect(result.answer).toContain("Danh sách chưa tải hết");
  });

  it("re-reads current prices for an ordinal reference from the previous result IDs", async () => {
    const row = {
      product_id: 8, product_name: "Tắc kê đạn", category_name: "Tắc kê", product_aliases: ["tắc kê nở"],
      variant_id: 2, display_name: "8x60", raw_specification: "8x60", source_pages: [4],
      packaging_id: 102, packaging_name: "Bịch", package_quantity: 10, unit: "cái", package_note: null,
      price_id: 302, price_version: 4, price_amount: 41000, price_type: "retail", minimum_quantity: 1,
      price_list_name: "Bảng giá hiện hành", supplier_name: "Cửa hàng",
    };
    const rpc = vi.fn(async (name: string) => name === "list_public_rag_product_variants"
      ? { data: [row], error: null }
      : Promise.reject(new Error(`Unexpected RPC ${name}`)));

    const result = await queryRag(
      { question: "Giá loại thứ hai bao nhiêu?" },
      { rpc } as unknown as SupabaseClient,
      { previousVariantIds: [1, 2] },
      { publicCatalogOnly: true },
    );

    expect(result.status).toBe("answered");
    expect(result.items).toMatchObject([{ id: 2, variant: "8x60", prices: [{ id: 302, amount: 41000 }] }]);
    expect(result.answer).toContain("41.000");
    expect(mocks.generateQueryPlanText).not.toHaveBeenCalled();
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });

  it("clarifies a singular reference when the prior result has multiple candidates", async () => {
    const rpc = vi.fn();
    const result = await queryRag(
      { question: "Cái đó giá bao nhiêu?" },
      { rpc } as unknown as SupabaseClient,
      { previousVariantIds: [1, 2] },
      { publicCatalogOnly: true },
    );

    expect(result.status).toBe("clarify");
    expect(result.items).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });

  it("abstains early for an out-of-domain request", async () => {
    mocks.generateQueryPlanText.mockResolvedValue(JSON.stringify({ intent: "out_of_domain", requests: [], confidence: 0.98, unresolvedFields: [] }));
    const rpc = vi.fn();
    const result = await queryRag({ question: "Dự báo thời tiết ngày mai" }, { rpc } as unknown as SupabaseClient, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("insufficient_evidence");
    expect(result.items).toEqual([]);
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });
});
