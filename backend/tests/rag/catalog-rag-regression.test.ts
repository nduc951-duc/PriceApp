import { beforeEach, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const ai = vi.hoisted(() => ({ plan: vi.fn(), embed: vi.fn(), answer: vi.fn() }));
vi.mock("../../src/rag/provider.js", () => ({
  embeddingModel: () => "test-1024", embedTexts: ai.embed,
  generateQueryPlanText: ai.plan, generateGroundedResponseText: ai.answer,
  RagProviderUnavailableError: class extends Error {},
}));
import { queryRag } from "../../src/services/rag-query.service.js";
import { buildApp } from "../../src/app.js";

const rows = [
  { id: 1, name: "Tắc kê sắt", spec: "8x60" },
  { id: 2, name: "Tắc kê sắt", spec: "8x80" },
  { id: 3, name: "Bulong có tán", spec: "8 ly x 3F" },
].map(({ id, name, spec }) => ({
  id, product_id: id === 3 ? 2 : 1, display_name: spec, raw_specification: spec,
  verification_status: "verified", products: { name, categories: { name: "Vật tư" }, product_aliases: [] },
  attributes: {}, source_pages: [1],
  packaging_options: [{ id: id + 10, name: "Bịch", quantity: 10, base_unit: "con", note: null,
    prices: [{ id: id + 20, version: 1, amount: 12345, price_type: "retail", minimum_quantity: 1, active: true,
      valid_from: "2020-01-01T00:00:00Z", valid_to: null, price_lists: { name: "Sổ giá", is_sample: false, suppliers: { name: "Cửa hàng", active: true } } }] }],
}));
const fixtureRpc = async (name: string, _args?: Record<string, unknown>) => {
  if (name === "list_public_rag_catalog_page" || name === "list_staff_rag_catalog_page") return { data: { items: rows, total_count: rows.length, next_cursor: null }, error: null };
  if (name === "match_public_rag_chunks" || name === "match_rag_chunks") return { data: [{ id: 50, product_variant_id: 3, similarity: 0.95, metadata: { kind: "verified_catalog" }, content: "Bulong có tán 8 ly x 3F" }], error: null };
  throw new Error(`Unexpected RPC ${name}`);
};
const rpc = vi.fn(fixtureRpc);
const client = { rpc } as unknown as SupabaseClient;
const ask = (question: string) => queryRag({ question }, client, {}, { publicCatalogOnly: true });

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation(fixtureRpc);
  ai.embed.mockResolvedValue([Array(1024).fill(0.01)]);
  ai.plan.mockImplementation(async ({ question }: { question: string }) => JSON.stringify({
    intent: question.includes("quy cách") ? "catalog_list" : "product_info", confidence: 0.95,
    requests: [{ intent: question.includes("quy cách") ? "catalog_list" : "product_info", productText: question.startsWith("Bulong") ? "Bulong" : "tắc kê sắt", specifications: [], requestedFields: ["facts"], constraints: [] }],
  }));
  ai.answer.mockResolvedValue(JSON.stringify({ blocks: [{ kind: "clarification", text: "Bạn muốn xem chiều dài nào trong các lựa chọn tìm được?", evidenceIds: ["variant:1"] }] }));
});

it.each(["tắc kê sắt 8 ly x 3f", "Tắc kê sắt 8 ly x 3F có quy cách gì?"])("retrieves same-family alternatives instead of substituting a bolt: %s", async (question) => {
  const result = await ask(question);
  expect(result.status).toBe("insufficient_evidence");
  expect(result.items).toEqual([]);
  expect(result.answer).toContain("8x60");
  expect(result.answer).toContain("8x80");
  expect(result.answer).not.toContain("Bulong");
  expect(ai.plan).toHaveBeenCalledOnce();
  expect(ai.embed).toHaveBeenCalledOnce();
  expect(ai.answer).toHaveBeenCalledOnce();
});

it.each(["Bulong 8 ly x 3F có quy cách gì?", "Bulong 8x30", "Bulong 8 mm x 3 cm"])("resolves equivalent dimensions against original catalog spelling: %s", async (question) => {
  const result = await ask(question);
  expect(result.status).toBe("answered");
  expect(result.items.map(item => item.id)).toEqual([3]);
  expect(result.items[0]?.variant).toBe("8 ly x 3F");
  expect(result.answer).not.toContain("Tắc kê");
});

it("does not let the model change SQL prices or invent a missing specification", async () => {
  ai.answer.mockResolvedValue(JSON.stringify({ blocks: [{ kind: "narrative", text: "Tắc kê sắt 8x30 giá 999 đồng", evidenceIds: ["variant:1"] }] }));
  const result = await ask("tắc kê sắt 8 ly x 3f");
  expect(result.answer).not.toContain("999");
  expect(result.items).toEqual([]);
});

it("retains exact SQL amounts when returning prices", async () => {
  ai.plan.mockResolvedValue(JSON.stringify({ intent: "price_lookup", confidence: 0.95, requests: [{ intent: "price_lookup", productText: "Bulong", specifications: ["8x30"], requestedFields: ["price"], constraints: [] }] }));
  const result = await ask("Giá Bulong 8x30?");
  expect(result.items[0]?.prices[0]?.amount).toBe(12345);
  expect(result.answer).toContain("12.345");
});

it("pins an explicitly named product family even when the model extracts another family", async () => {
  ai.plan.mockResolvedValue(JSON.stringify({ intent: "product_info", confidence: 0.95,
    requests: [{ intent: "product_info", productText: "Bulong", specifications: ["8x30"], requestedFields: ["facts"], constraints: [] }] }));
  const result = await ask("tắc kê sắt 8x30");
  expect(result.status).toBe("insufficient_evidence");
  expect(result.answer).not.toContain("Bulong");
  expect(result.answer).toContain("8x60");
});

it("never substitutes an unrelated model family when the requested family is absent", async () => {
  const wrong = { ...rows[2]!, products: { ...rows[2]!.products, name: "Bulong sắt" } };
  rpc.mockImplementation(async (name, args) => name === "list_public_rag_catalog_page"
    ? { data: { items: String(args?.p_query).startsWith("Bulong") ? [wrong] : [], total_count: 0, next_cursor: null }, error: null }
    : { data: [], error: null } as never);
  ai.plan.mockResolvedValue(JSON.stringify({ intent: "product_info", confidence: 0.95,
    requests: [{ intent: "product_info", productText: "Bulong", specifications: ["8x30"], requestedFields: ["facts"], constraints: [] }] }));
  const result = await ask("tắc kê sắt 8x30");
  expect(result.status).toBe("insufficient_evidence");
  expect(result.items).toEqual([]);
  expect(result.answer).not.toContain("Bulong");
});

it("does not turn a vector database failure into a claim that no product matches", async () => {
  rpc.mockImplementationOnce(async () => ({ data: { items: rows, total_count: rows.length, next_cursor: null }, error: null }));
  rpc.mockImplementationOnce(async () => ({ data: null, error: { message: "database unavailable" } }) as never);
  await expect(ask("Bulong 8x30")).rejects.toThrow("RAG semantic retrieval unavailable");
});

it("renders validated model prose alongside authoritative catalog facts", async () => {
  ai.answer.mockResolvedValue(JSON.stringify({ blocks: [{ kind: "narrative", text: "Mình đã đối chiếu các quy cách trong danh mục.", evidenceIds: ["variant:3"] }] }));
  const result = await ask("Bulong 8x30");
  expect(result.answer).toContain("Mình đã đối chiếu");
  expect(result.items[0]?.variant).toBe("8 ly x 3F");
});

it("groups parent products when the user asks for product discovery", async () => {
  ai.plan.mockResolvedValue(JSON.stringify({ intent: "catalog_list", confidence: 0.95,
    requests: [{ intent: "catalog_list", productText: "tắc kê", specifications: [], requestedFields: ["products"], constraints: [] }] }));
  const result = await ask("Có sản phẩm gì về tắc kê?");
  expect(result.answer).toContain("1 nhóm sản phẩm");
  expect(result.answer).toContain("Tắc kê sắt: 2 quy cách");
  expect(result.items).toEqual([]);
});

it.each(["tôi muốn mua bulong, giới thiệu cho tôi", "tôi muốn mua bulong và hãy giới thiệu cho tôi", "giới thiệu cho tôi các mặt hàng bulong"])("uses the model identity across both clauses without treating conversational words as specifications: %s", async question => {
  ai.plan.mockResolvedValue(JSON.stringify({ intent: "catalog_list", conversationPhrases: ["tôi muốn mua", "giới thiệu cho tôi", "và hãy", "các mặt hàng"], requests: [{ intent: "catalog_list", productText: "bulong", specifications: [], requestedFields: ["products"], constraints: [] }] }));
  const result = await ask(question);
  expect(result.status).toBe("answered");
  expect(result.answer).toContain("Bulong có tán: 1 quy cách");
  expect(result.answer).not.toContain("Chưa tìm thấy");
  expect(result.catalogPage?.total).toBe(1);
  expect(ai.answer).toHaveBeenCalledWith(expect.objectContaining({ question }));
});

it.each([{ conversationPhrases: [] }, { conversationPhrases: ["giới thiệu cho tôi"] }, { conversationPhrases: ["tôi muốn mua bulong và hãy giới thiệu cho tôi"] }])("keeps the subject when the model under- or over-extracts a conversational span: $conversationPhrases", async ({ conversationPhrases }) => {
  ai.plan.mockResolvedValue(JSON.stringify({ intent: "catalog_list", conversationPhrases, requests: [{ intent: "catalog_list", productText: "bulong", specifications: [], requestedFields: ["products"], constraints: [] }] }));
  const result = await ask("tôi muốn mua bulong và hãy giới thiệu cho tôi");
  expect(result.status).toBe("answered");
  expect(result.answer).toContain("Bulong có tán: 1 quy cách");
});

it.each([true, false])("clears inherited dimensions for a new introduction in public/staff mode: %s", async publicCatalogOnly => {
  ai.plan.mockImplementation(async ({ context }: { context?: string[] }) => JSON.stringify({ intent: "catalog_list", conversationPhrases: ["tôi muốn mua", "và hãy giới thiệu cho tôi"], requests: [{ intent: "catalog_list", productText: "tắc kê sắt", specifications: context?.length ? ["8x30"] : [], requestedFields: ["products"], constraints: [] }] }));
  const result = await queryRag({ question: "tôi muốn mua tắc kê sắt và hãy giới thiệu cho tôi" }, client,
    { previousQuestion: "Giá tắc kê sắt 8x30" }, { publicCatalogOnly });
  expect(result.status).toBe("answered");
  expect(result.answer).toContain("Tắc kê sắt: 2 quy cách");
  expect(rpc).toHaveBeenCalledWith(publicCatalogOnly ? "list_public_rag_catalog_page" : "list_staff_rag_catalog_page", expect.any(Object));
});

it.each([{ conversationPhrases: [] }, { conversationPhrases: ["đỏ mận"] }])("does not discard an explicit color modifier omitted or mislabelled by the model: $conversationPhrases", async ({ conversationPhrases }) => {
  const green = { ...rows[2]!, products: { ...rows[2]!.products, name: "Bánh xe xanh" }, display_name: "100mm xanh", raw_specification: "100mm xanh" };
  rpc.mockImplementation(async name => name === "list_public_rag_catalog_page" ? { data: { items: [green], total_count: 1, next_cursor: null }, error: null } : { data: [], error: null } as never);
  ai.plan.mockResolvedValue(JSON.stringify({ intent: "price_lookup", conversationPhrases, requests: [{ intent: "price_lookup", productText: "Bánh xe", specifications: [], requestedFields: ["price"], constraints: [] }] }));
  const result = await ask("Giá bánh xe đỏ mận?");
  expect(result.status).toBe("insufficient_evidence");
  expect(result.items).toEqual([]);
});

it("serializes the new pipeline through the actual public HTTP API", async () => {
  const app = buildApp({ env: { supabaseUrl: "https://fixture.supabase.co", supabasePublishableKey: "fixture", port: 4000, allowedOrigins: ["http://localhost:3000"] }, supabaseFactory: () => client });
  const errors: string[] = [];
  app.addHook("onError", async (_request, _reply, error) => { errors.push(error.message); });
  try {
    const response = await app.inject({ method: "POST", url: "/api/v1/public/rag/query", payload: { question: "Bulong 8x30" } });
    expect(response.statusCode, errors.join("\n")).toBe(200);
    expect(response.json().items[0].prices[0].amount).toBe(12345);
  } finally { await app.close(); }
});
