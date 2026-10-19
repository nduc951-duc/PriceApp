import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const mocks = vi.hoisted(() => ({ embed: vi.fn(), generate: vi.fn(), match: vi.fn(), expand: vi.fn(), prices: vi.fn() }));
vi.mock("../../src/rag/provider.js", () => ({ embeddingModel: () => "bge-m3", embedTexts: mocks.embed, generateRetrievedCatalogAnswer: mocks.generate }));
vi.mock("../../src/repositories/rag-chunks.repository.js", () => ({ ragChunksRepository: () => ({ match: mocks.match }) }));
vi.mock("../../src/repositories/rag-catalog.repository.js", () => ({ ragCatalogRepository: () => ({ expandVerifiedGroups: mocks.expand, prices: mocks.prices }) }));
import { queryRetrievalFirstRag } from "../../src/services/retrieval-first-rag.js";

const rows = [
  { id: 47, product_id: 2, display_name: "8 ly x 3F", raw_specification: "8 ly x 3F", verification_status: "verified", source_pages: [5], attributes: {},
    products: { name: "Bulong có tán", categories: { name: "Bulong" }, product_aliases: [] },
    packaging_options: [{ id: 84, name: "10 bộ/bịch", quantity: 10, base_unit: "bộ", note: null,
      prices: [{ id: 84, version: 1, amount: 9000, price_type: "retail", minimum_quantity: 1, active: true, valid_from: "2020-01-01T00:00:00Z", valid_to: null,
        price_lists: { name: "Sổ giá", is_sample: false, suppliers: { name: "Cửa hàng", active: true } } }] }] },
  { id: 48, product_id: 2, display_name: "8 ly x 4F", raw_specification: "8 ly x 4F", verification_status: "verified", source_pages: [5],
    products: { name: "Bulong có tán", categories: { name: "Bulong" }, product_aliases: [] }, packaging_options: [] },
];
const chunk = { id: 11, product_variant_id: 47, chunk_key: "variant:47:0", content: "Bulong có tán. Quy cách 8 ly x 3F. Đóng gói 10 bộ/bịch.", similarity: 0.7, metadata: { kind: "verified_catalog", page_number: 5 } };
const selection = { status: "answered", answer: "Bên mình có bulong có tán. Bạn muốn xem cỡ nào?", selectedVariantIds: [], selectedPriceIds: [], listedProductIds: [2], listingMode: "products", evidenceIds: ["chunk:11", "variant:47"] };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.embed.mockResolvedValue([Array(1024).fill(0.1)]);
  mocks.match.mockResolvedValue({ data: [chunk], error: null });
  mocks.expand.mockResolvedValue({ data: globalThis.structuredClone(rows), error: null });
  mocks.prices.mockResolvedValue({ data: globalThis.structuredClone(rows), error: null });
  mocks.generate.mockResolvedValue(JSON.stringify(selection));
});
const client = {} as SupabaseClient;
afterEach(() => vi.unstubAllEnvs());

it("uses the retrieval-first mode before invoking the legacy language planner", async () => {
  vi.stubEnv("RAG_QUERY_MODE", "retrieval_first");
  const { queryRag } = await import("../../src/services/rag-query.service.js");
  const result = await queryRag({ question: "tôi muốn bulong, thì bên bạn có những loại nào" }, client, {}, { publicCatalogOnly: true });
  expect(result.status).toBe("answered");
  expect(mocks.generate).toHaveBeenCalledOnce();
});

it.each([
  "tôi muốn bulong, thì bên bạn có những loại nào",
  "tôi muốn mua bulong và hãy giới thiệu cho tôi",
  "ờm cho mình tham khảo bulong với nhé",
  "bên mình có thể cho tôi biết những sản phẩm bulong đang bán không",
])("sends the whole utterance and actual evidence to the model without lexical filtering: %s", async question => {
  const result = await queryRetrievalFirstRag(question, client, {}, true);
  expect(mocks.embed).toHaveBeenCalledWith([question]);
  expect(mocks.generate).toHaveBeenCalledOnce();
  expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ question, chunks: [expect.objectContaining({ content: expect.stringContaining('"provenance":"current_sql"') })], catalog: expect.arrayContaining([expect.objectContaining({ id: 47, specification: "8 ly x 3F" })]) }));
  expect(result.status).toBe("answered");
  expect(result.answer).toContain("Bulong có tán: 2 quy cách");
  expect(result.catalogPage).toMatchObject({ total: 2, complete: false });
  expect(result.retrieval.vectorChunks).toBe(1);
});

it("passes bounded role-aware history and previous selection ordering without rewriting the current question", async () => {
  const history = [{ role: "user" as const, content: "Bulong 8 ly x 3F" }, { role: "assistant" as const, content: "Bạn muốn xem giá lẻ hay sỉ?" }];
  await queryRetrievalFirstRag("loại đó giá bao nhiêu?", client, { history, previousVariantIds: [47] }, true);
  expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ question: "loại đó giá bao nhiêu?", history, previousVariantIds: [47] }));
});

it("takes displayed prices from fresh SQL rows, not the model", async () => {
  mocks.generate.mockResolvedValue(JSON.stringify({ ...selection, answer: "Mình tìm được đúng mẫu bạn hỏi.", selectedVariantIds: [47], selectedPriceIds: [84], listedProductIds: [], listingMode: "none" }));
  mocks.prices.mockResolvedValue({ data: [{ ...rows[0], packaging_options: [{ ...rows[0]!.packaging_options[0], prices: [{ ...rows[0]!.packaging_options[0]!.prices[0], amount: 9500, version: 2 }] }] }], error: null });
  const result = await queryRetrievalFirstRag("Giá bulong 8×30?", client, {}, true);
  expect(result.items[0]?.prices[0]).toMatchObject({ amount: 9500, version: 2 });
  expect(result.answer).toContain("9.500");
});

it.each(["đồng", "VNĐ", "VND", "₫"])("discards monetary model prose (%s) when valid price selections can be rendered from fresh SQL", async currency => {
  mocks.generate.mockResolvedValue(JSON.stringify({ ...selection, answer: `Giá là 999 ${currency}, áp dụng miễn phí giao hàng.`, selectedVariantIds: [47], selectedPriceIds: [84], listedProductIds: [], listingMode: "none" }));
  const result = await queryRetrievalFirstRag("Giá bulong 8 ly x 3F?", client, {}, true);
  expect(result.status).toBe("answered");
  expect(result.answer).toContain("9.000");
  expect(result.answer).not.toMatch(/999|miễn phí giao hàng/);
  expect(result.items[0]?.prices[0]?.amount).toBe(9000);
});

it.each([{ selectedVariantIds: [999] }, { selectedPriceIds: [999] }, { evidenceIds: ["chunk:999"] }, { listedProductIds: [999] }, { answer: "Giá là 999 đồng" }])("rejects invented structured evidence or monetary prose: %j", async bad => {
  mocks.generate.mockResolvedValue(JSON.stringify({ ...selection, ...bad }));
  const result = await queryRetrievalFirstRag("bulong", client, {}, true);
  expect(result.status).toBe("clarify");
  expect(result.items).toEqual([]);
  expect(result.answer).not.toContain("999");
});

it("does not turn a provider outage into missing catalog data", async () => {
  mocks.embed.mockRejectedValue(new Error("embedding offline"));
  await expect(queryRetrievalFirstRag("bulong", client, {}, true)).rejects.toMatchObject({ statusCode: 503 });
  expect(mocks.generate).not.toHaveBeenCalled();
});

it.each([
  ["embed", "embedding"], ["match", "vector_search"], ["expand", "catalog"], ["generate", "generation"],
] as const)("retains a safe failure stage for %s without retaining private error text", async (dependency, stage) => {
  mocks[dependency].mockRejectedValue(new Error("private-token private question HTTP 429"));
  await expect(queryRetrievalFirstRag("bulong", client, {}, true)).rejects.toMatchObject({
    statusCode: 503, diagnostics: { stage, upstreamStatus: 429 },
  });
  try { await queryRetrievalFirstRag("bulong", client, {}, true); } catch (error) {
    expect(JSON.stringify(error)).not.toMatch(/private-token|private question/);
  }
});

it("does not call the model when no verified evidence was retrieved", async () => {
  mocks.match.mockResolvedValue({ data: [], error: null });
  const result = await queryRetrievalFirstRag("tàu vũ trụ", client, {}, true);
  expect(result.status).toBe("insufficient_evidence");
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("packs retrieved variant IDs before sibling rows when a model context limit is configured", async () => {
  vi.stubEnv("RAG_CONTEXT_MAX_VARIANTS", "1");
  mocks.match.mockResolvedValue({ data: [{ ...chunk, product_variant_id: 48 }], error: null });
  await queryRetrievalFirstRag("bulong", client, {}, true);
  expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({
    truncated: true, catalog: [expect.objectContaining({ id: 48 })],
  }));
});

it("does not expose dealer prices to customer model context or response", async () => {
  const dealer = globalThis.structuredClone(rows);
  dealer[0]!.packaging_options[0]!.prices[0]!.price_type = "dealer";
  mocks.expand.mockResolvedValue({ data: dealer, error: null });
  await queryRetrievalFirstRag("bulong", client, {}, true);
  expect(mocks.generate.mock.calls[0]?.[0].catalog[0].packages[0].prices).toEqual([]);
});

it("batches public expansion and current price reads within the eight-ID RPC limit", async () => {
  const manyRows = Array.from({ length: 17 }, (_, index) => ({ ...globalThis.structuredClone(rows[0]!), id: index + 1, packaging_options: [] }));
  const ids = manyRows.map(row => row.id);
  mocks.match.mockResolvedValue({ data: [{ ...chunk, product_variant_id: 1 }], error: null });
  const rpcResult = async (batch: number[]) => ({ data: batch.length <= 8 ? manyRows.filter(row => batch.includes(row.id)) : [], error: null });
  mocks.expand.mockImplementation(rpcResult);
  mocks.prices.mockImplementation(rpcResult);
  mocks.generate.mockResolvedValue(JSON.stringify({ ...selection, selectedVariantIds: ids, selectedPriceIds: [], listedProductIds: [], listingMode: "variants", evidenceIds: ["chunk:11"] }));
  const result = await queryRetrievalFirstRag("Các quy cách bulong?", client, { previousVariantIds: ids }, true);
  expect(result.status).toBe("answered");
  expect(result.items.map(item => item.id)).toEqual(ids);
  expect(mocks.expand.mock.calls.map(([batch]) => batch)).toEqual([ids.slice(0, 8), ids.slice(8, 16), ids.slice(16)]);
  expect(mocks.prices.mock.calls.map(([batch]) => batch)).toEqual([ids.slice(0, 8), ids.slice(8, 16), ids.slice(16)]);
});

it("uses current SQL facts and truthful citation provenance after indexed text becomes stale", async () => {
  const current = globalThis.structuredClone(rows);
  current[0]!.raw_specification = "8x40";
  current[0]!.display_name = "8x40";
  mocks.expand.mockResolvedValue({ data: current, error: null });
  mocks.match.mockResolvedValue({ data: [{ ...chunk, content: "STALE 8x30 supports ten tons", source_revision: 5 }], error: null });
  const result = await queryRetrievalFirstRag("Bulong?", client, {}, true);
  const input = mocks.generate.mock.calls[0]![0];
  expect(input.chunks[0]).toMatchObject({ id: 11, variantId: 47, similarity: 0.7 });
  expect(JSON.parse(input.chunks[0].content)).toMatchObject({ provenance: "current_sql", specification: "8x40" });
  expect(JSON.stringify(input)).not.toContain("STALE");
  expect(result.sources[0]).toMatchObject({ chunkKey: "current_sql:variant:47", pageNumber: null, sourceRevision: null, verifiedVariantId: 47 });
  expect(result.sources[0]?.excerpt).toBe(input.chunks[0].content);
});

it("does not claim an exhaustive product search from a small semantic result", async () => {
  const result = await queryRetrievalFirstRag("Có những sản phẩm bulong nào?", client, {}, true);
  expect(result.catalogPage).toMatchObject({ total: 2, complete: false });
});

it("reports a partial list when the retrieval context is truncated", async () => {
  const expanded = Array.from({ length: 201 }, (_, index) => ({ ...rows[1]!, id: index + 1 }));
  mocks.expand.mockResolvedValue({ data: expanded, error: null });
  const result = await queryRetrievalFirstRag("giới thiệu bulong", client, {}, true);
  expect(mocks.generate.mock.calls[0]?.[0].truncated).toBe(true);
  expect(result.catalogPage?.complete).toBe(false);
  expect(result.answer).toContain("trong phần đã tải");
});
