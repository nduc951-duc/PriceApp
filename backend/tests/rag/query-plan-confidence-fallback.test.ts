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

// SQL degradation and operation unit coverage; model-first orchestration is covered in catalog-rag-regression.test.ts.
import { queryRagOperation as queryRag } from "../../src/services/rag-query.service.js";
import type { SupabaseClient } from "@supabase/supabase-js";

const question = "Tắc kê nhựa xanh 6 mm";

function row(variantId: number, amount: number | null = 12000) {
  return {
    variant_id: variantId,
    display_name: `Tắc kê nhựa xanh ${variantId === 1 ? "6" : "8"} mm`,
    raw_specification: `${variantId === 1 ? "6" : "8"} mm, xanh`,
    verification_status: "verified",
    product_name: variantId === 1 ? "Tắc kê nhựa" : "Tắc kê nhựa gia cường",
    category_name: "Tắc kê",
    source_pages: [11],
    product_aliases: ["tắc kê nhựa"],
    packaging_id: amount === null ? null : 20 + variantId,
    packaging_name: amount === null ? null : "Bịch",
    package_quantity: amount === null ? null : 10,
    unit: amount === null ? null : "cái",
    package_note: null,
    price_id: amount === null ? null : 30 + variantId,
    price_version: amount === null ? null : 4,
    price_amount: amount,
    price_type: amount === null ? null : "retail",
    minimum_quantity: amount === null ? null : 1,
    price_list_name: amount === null ? null : "Bảng giá hiện hành",
    supplier_name: amount === null ? null : "Cửa hàng",
  };
}

function chunk(variantId = 1) {
  return {
    id: 91,
    chunk_key: "fixture:tacke:6mm",
    source_page_id: 11,
    source_revision: 1,
    source_start: null,
    source_end: null,
    product_variant_id: variantId,
    content: "Tắc kê nhựa xanh 6 mm dùng cho lắp đặt nhẹ.",
    metadata: { kind: "verified_catalog", page_number: 11 },
    similarity: 0.82,
  };
}

function client(options: { rows?: ReturnType<typeof row>[]; chunks?: ReturnType<typeof chunk>[] }) {
  const rpc = vi.fn(async (name: string) => {
    if (name === "search_public_rag_catalog") {
      return { data: (options.rows ?? [row(1)]).map((item) => ({ id: item.variant_id, result_type: "variant", relevance: 20 })), error: null };
    }
    if (name === "match_public_rag_chunks") return { data: options.chunks ?? [chunk()], error: null };
    if (name === "get_public_rag_catalog") return { data: options.rows ?? [row(1)], error: null };
    if (name === "current_public_rag_variant_sources") {
      return { data: (options.rows ?? [row(1)]).map((item) => ({ product_variant_id: item.variant_id, source_page_id: 11, page_number: 11 })), error: null };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  return { rpc } as unknown as SupabaseClient;
}

function plan(intent: "product_info" | "price_lookup" = "product_info") {
  return JSON.stringify({
    intent,
    requests: [{ intent, productText: "tắc kê nhựa", specifications: ["6 mm"], requestedFields: intent === "price_lookup" ? ["price", "unit"] : ["facts", "source"], constraints: [] }],
    unresolvedFields: [],
  });
}

describe("RAG planner fallback when confidence is omitted", () => {
  beforeEach(() => {
    mocks.embedTexts.mockReset().mockResolvedValue([Array(1024).fill(0.1)]);
    mocks.generateQueryPlanText.mockReset();
    mocks.generateGroundedResponseText.mockReset();
  });

  it("answers a uniquely matched catalog fact without requiring a chunk", async () => {
    mocks.generateQueryPlanText.mockResolvedValue(plan());
    mocks.generateGroundedResponseText.mockResolvedValue(JSON.stringify({
      blocks: [{ kind: "narrative", text: "Sản phẩm này dùng cho lắp đặt nhẹ.", evidenceIds: ["chunk:91"] }],
    }));

    const result = await queryRag({ question }, client({}), {}, { publicCatalogOnly: true });

    expect(result.status).toBe("answered");
    expect(result.answer).toContain("6 mm");
    expect(result.sources).toEqual([]);
    expect(mocks.embedTexts).not.toHaveBeenCalled();
  });

  it("asks for clarification when an omitted-confidence plan matches multiple variants", async () => {
    mocks.generateQueryPlanText.mockResolvedValue(plan());
    const result = await queryRag({ question: "Tắc kê nhựa" }, client({ rows: [row(1), row(2)], chunks: [chunk(1), chunk(2)] }), {}, { publicCatalogOnly: true });

    expect(result.status).toBe("clarify");
    expect(result.items).toEqual([]);
    expect(mocks.generateGroundedResponseText).not.toHaveBeenCalled();
  });

  it("abstains when the omitted-confidence plan has no catalog or chunk evidence", async () => {
    mocks.generateQueryPlanText.mockResolvedValue(plan());
    const result = await queryRag({ question: "Thông tin mặt hàng không tồn tại" }, client({ rows: [], chunks: [] }), {}, { publicCatalogOnly: true });

    expect(result.status).toBe("insufficient_evidence");
    expect(result.sources).toEqual([]);
    expect(mocks.generateGroundedResponseText).not.toHaveBeenCalled();
  });

  it("uses the current SQL price even when the model omits confidence", async () => {
    mocks.generateQueryPlanText.mockResolvedValue(plan("price_lookup"));
    const db = client({});
    const result = await queryRag({ question: "Tắc kê nhựa 6 mm" }, db, {}, { publicCatalogOnly: true });

    expect(result.status).toBe("answered");
    expect(result.answer).toContain("12.000");
    expect(result.answer).not.toContain("99.999");
    expect((db.rpc as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([name]) => name === "get_public_rag_catalog")).toBe(true);
    expect(mocks.generateQueryPlanText).toHaveBeenCalledOnce();
  });
});
