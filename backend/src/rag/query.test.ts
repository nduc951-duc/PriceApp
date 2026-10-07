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

const ask = () => queryRag({ question: "Giá tắc kê sắt 6x50?" }, client);

function clientWithPrice(amount: () => number | null, sourceActive = true) {
  return {
    rpc: vi.fn(async (name: string) => name === "match_rag_chunks"
      ? { data: sourceActive ? [{ id: 9, chunk_key: "page:1:variant:1:0", source_page_id: 1, product_variant_id: 1, content: "Tắc kê sắt 6x50", metadata: { page_number: 1 }, similarity: 0.9 }] : [], error: null }
      : name === "current_rag_variant_sources"
        ? { data: sourceActive ? [{ product_variant_id: 1, source_page_id: 1, page_number: 1 }] : [], error: null }
        : { data: [{ id: 1, result_type: "variant" }], error: null }),
    from: vi.fn((table: string) => {
      if (table === "product_variants") return { select: () => ({ in: () => ({ eq: () => ({ eq: async () => ({ data: [{
        id: 1, display_name: "Tắc kê sắt 6x50", raw_specification: "6x50", verification_status: "verified",
        products: { name: "Tắc kê sắt", categories: { name: "Tắc kê" }, product_aliases: [] },
        variant_sources: [{ source_page_id: 1, source_pages: { page_number: 1 } }],
        packaging_options: [{ id: 2, name: "Bịch", quantity: 10, base_unit: "cái", prices: amount() === null ? [] : [{
          id: 3, amount: amount(), price_type: "retail", minimum_quantity: 1, active: true,
          valid_from: "2020-01-01T00:00:00Z", valid_to: null,
          price_lists: { name: "Sổ giá", effective_date: "2020-01-01", suppliers: { name: "Cửa hàng" } },
        }] }],
      }], error: null }) }) }) }) };
      if (table === "source_pages") return { select: () => ({ in: async () => ({ data: [{ id: 1, page_number: 1 }], error: null }) }) };
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
    expect(mocks.generateAnswer).not.toHaveBeenCalled();
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
