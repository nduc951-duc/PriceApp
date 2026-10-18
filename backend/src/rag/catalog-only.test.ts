import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ embed: vi.fn(), generate: vi.fn(), search: vi.fn(), prices: vi.fn(), match: vi.fn(), sources: vi.fn() }));
vi.mock("./provider.js", () => ({
  embeddingModel: () => "bge-m3", embedTexts: mocks.embed, generateGroundedResponseText: mocks.generate,
  generateQueryPlanText: async () => JSON.stringify({ intent: "product_info", confidence: 0.95, requests: [{ intent: "product_info", productText: "tắc kê sắt", specifications: ["8x60"], requestedFields: ["facts"], constraints: [] }] }),
  RagProviderUnavailableError: class extends Error {},
}));
vi.mock("../repositories/rag-catalog.repository.js", () => ({ ragCatalogRepository: () => ({ search: mocks.search, prices: mocks.prices, currentSources: mocks.sources }) }));
vi.mock("../repositories/rag-chunks.repository.js", () => ({ ragChunksRepository: () => ({ match: mocks.match }) }));
vi.mock("../repositories/rag-pages.repository.js", () => ({ ragPagesRepository: () => ({ numbers: async () => ({ data: [], error: null }) }) }));
import { queryRag } from "../services/rag-query.service.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.embed.mockRejectedValue(new Error("embedding offline"));
  mocks.search.mockResolvedValue({ data: [{ id: 1, result_type: "variant", relevance: 100 }], error: null });
  mocks.sources.mockResolvedValue({ data: [], error: null });
  mocks.prices.mockResolvedValue({ data: [{
    id: 1, product_id: 2, display_name: "Tắc kê sắt 8x60", raw_specification: "8x60", verification_status: "verified", attributes: { material: "thép" },
    products: { name: "Tắc kê sắt", categories: { name: "Tắc kê" }, product_aliases: [] },
    packaging_options: [{ id: 3, name: "Bịch", quantity: 10, base_unit: "cái", note: null, prices: [] }],
  }], error: null });
});

it("answers verified specification and packaging rows without embeddings, chat, prices or scanned pages", async () => {
  const result = await queryRag({ question: "Thông tin tắc kê sắt 8x60" }, {} as SupabaseClient);
  expect(result.status).toBe("answered");
  expect(result.answer).toContain("8x60");
  expect(result.answer).toContain("10 cái");
  expect(result.answer).toContain("thép");
  expect(result.answer).toContain("Supabase");
  expect(result.answer).not.toContain("đường kính");
  expect(result.retrieval.embeddingModel).toBe("not_used");
  expect(mocks.embed).not.toHaveBeenCalled();
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(result.items.flatMap(item => item.prices)).toEqual([]);
});

it.each([
  { product: "Vít bắn tôn", category: "Vít", spec: "10x120", question: "Thông tin vít bắn tôn 10x120", expected: "đường kính 10 ly (10 mm), chiều dài 120 mm" },
  { product: "Vít gỗ", category: "Vít", spec: "10 ly 140", question: "Thông tin vít gỗ 10 ly 140", expected: "đường kính 10 ly (10 mm), chiều dài 140 mm" },
  { product: "Bánh xe", category: "Bánh xe", spec: "1F5", question: "Thông tin bánh xe 1F5", expected: "15 mm" },
  { product: "Bánh xe", category: "Bánh xe", spec: "Đỏ mận khóa ĐL 1T2", question: "Thông tin bánh xe Đỏ mận khóa ĐL 1T2", expected: "ký hiệu tấc 1T2 tương đương 120 mm" },
  { product: "Bánh xe", category: "Bánh xe", spec: "1 tấc 2", question: "Thông tin bánh xe 1 tấc 2", expected: "ký hiệu tấc 1T2 tương đương 120 mm" },
])("explains catalog size notation for $spec without changing its stored specification", async ({ product, category, spec, question, expected }) => {
  mocks.search.mockResolvedValue({ data: [{ id: 1, result_type: "variant", relevance: 100 }], error: null });
  mocks.prices.mockResolvedValue({ data: [{
    id: 1, product_id: 2, display_name: spec, raw_specification: spec, verification_status: "verified", attributes: {},
    products: { name: product, categories: { name: category }, product_aliases: [] },
    packaging_options: [],
  }], error: null });

  const result = await queryRag({ question }, {} as SupabaseClient);

  expect(result.status).toBe("answered");
  expect(result.answer).toContain(expected);
  expect(result.items[0]?.variant).toBe(spec);
});

it("identifies a missing catalog match without claiming the embedding is missing", async () => {
  mocks.search.mockResolvedValue({ data: [], error: null });
  const result = await queryRag({ question: "Thông tin tắc kê sắt 8x60" }, {} as SupabaseClient);
  expect(result.status).toBe("insufficient_evidence");
  expect(result.answer).toMatch(/danh mục|catalog/i);
  expect(result.answer).not.toMatch(/embedding/i);
});

it.each(["Đóng gói", "Chất liệu", "Kích thước"])("understands the catalog task phrase %s without treating it as a product attribute", async (phrase) => {
  const result = await queryRag({ question: `${phrase} tắc kê sắt 8x60` }, {} as SupabaseClient);
  expect(result.status).toBe("answered");
  expect(result.answer).toContain("8x60");
  expect(mocks.embed).not.toHaveBeenCalled();
});
