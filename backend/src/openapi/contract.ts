import { z } from "zod";
import { catalogUpdateSchema, priceUndoSchema, priceUpdateSchema } from "../schemas/prices.schema.js";
import { signedUrlBody } from "../schemas/source-files.schema.js";

const id = z.number().int().positive();
const text = z.string();
const role = z.enum(["owner", "editor", "viewer"]);
export const errorResponse = z.object({ error: z.object({ code: text, message: text }), requestId: text });
const catalogEntry = z.object({ categoryId: id, productId: id, variantId: id, name: text, category: text, spec: text, displayName: text, sourcePages: z.array(z.number()), sourceFiles: z.array(text) });
const catalogPrice = z.object({
  id, priceId: id, categoryId: id, productId: id, variantId: id, packagingId: id,
  name: text, category: text, variantDisplayName: text, spec: text, variantSpec: text,
  packageName: text, packageQuantity: z.number(), packageNote: text, priceType: text,
  minimumQuantity: z.number(), price: z.number(), unit: text, supplier: text,
  sourcePages: z.array(z.number()), sourceFiles: z.array(text),
  status: z.enum(["verified", "needs_review", "unreadable"]), version: z.number().int(),
});
const catalogResponse = z.object({ entries: z.array(catalogEntry), prices: z.array(catalogPrice), syncedAt: text });
const meResponse = z.object({ userId: text, role });
const priceWriteResponse = z.object({ amount: z.number(), version: z.number().int() });
const priceUpdateResponse = priceWriteResponse.extend({ historyId: id });
const catalogUpdateResponse = z.object({
  ok: z.literal(true), category: z.object({ id, name: text }), product: z.object({ id, name: text }),
  variant: z.object({ id, displayName: text, rawSpecification: text }),
  packaging: z.object({ id, name: text, quantity: z.number(), baseUnit: text }).nullable(),
  price: z.object({ id, amount: z.number(), version: z.number().int(), priceType: z.enum(["retail", "wholesale", "dealer"]), minimumQuantity: z.number() }).nullable(),
});
const signedUrlResponse = z.object({ signedUrl: z.url(), expiresIn: z.literal(300) });
const ragQueryBody = z.strictObject({ question: z.string().trim().min(1).max(1000) });
const verificationStatus = z.enum(["verified", "needs_review", "unreadable", "sample"]);
const ragPrice = z.object({
  id, amount: z.number(), priceType: z.enum(["retail", "wholesale", "dealer"]), minimumQuantity: z.number(),
  packagingName: text, packageQuantity: z.number(), unit: text, packageNote: text,
  priceList: text.nullable(), supplier: text.nullable(), verificationStatus,
});
const ragItem = z.object({
  id, productName: text, category: text, variant: text, verificationStatus,
  sourcePages: z.array(z.number()), prices: z.array(ragPrice),
});
const ragSource = z.object({ pageNumber: z.number(), excerpt: text });
const ragTrace = z.object({ question: text, chunkIds: z.array(id), variantIds: z.array(id), priceIds: z.array(id), answer: text });
const ragQueryResponse = z.object({
  answer: text, items: z.array(ragItem), sources: z.array(ragSource),
  retrieval: z.object({ vectorChunks: z.number(), lexicalProducts: z.number(), embeddingModel: text, trace: ragTrace.optional() }),
});
const ragPage = z.object({ sourcePageId: id, pageNumber: z.number().nullable(), title: text, extractedText: text, reviewStatus: z.enum(["draft", "approved", "rejected"]), revision: z.number().int() });
const pagesResponse = z.object({ pages: z.array(ragPage) });
const savePageBody = z.object({ sourcePageId: id, title: text, extractedText: text, reviewStatus: z.enum(["draft", "approved", "rejected"]) });
const savePageResponse = z.object({ saved: z.literal(true), reviewStatus: z.enum(["draft", "approved", "rejected"]), revision: z.number().int() });
const indexRun = z.object({ runId: id, status: z.enum(["running", "failed", "completed"]), checkpoint: z.number(), chunks: z.number(), indexed: z.number(), reused: z.number(), removed: z.number(), embeddingModel: text, contentHash: text });
const indexResponse = z.object({ run: indexRun.nullable() });
const indexRunResponse = indexRun.extend({ pages: z.number(), variants: z.number(), embeddingDimensions: z.number() });
const failedDiagnostic = z.object({ ok: z.literal(false), detail: text });
const databaseDiagnostic = z.union([failedDiagnostic, z.object({ ok: z.literal(true), detail: text, count: z.number() })]);
const embeddingDiagnostic = z.union([failedDiagnostic, z.object({ ok: z.literal(true), detail: text, model: text, dimensions: z.number(), fingerprint: text })]);
const chatDiagnostic = z.union([failedDiagnostic, z.object({ ok: z.literal(true), detail: text, model: text })]);
const ragHealthResponse = z.object({ ok: z.boolean(), provider: text, database: databaseDiagnostic, embedding: embeddingDiagnostic, chat: chatDiagnostic });
const previewBody = z.strictObject({ extractedText: z.string().max(100_000) });
const previewResponse = z.object({ source: text, chunks: z.array(z.object({ index: z.number(), content: text, start: z.number(), end: z.number() })) });
const priceIdPathParams = z.object({ priceId: z.string().regex(/^[1-9]\d*$/) });

export const apiContracts = [
  { method: "get", path: "/api/v1/health", operationId: "getHealth", summary: "Kiểm tra trạng thái API", response: { 200: z.object({ status: z.literal("ok") }) } },
  { method: "get", path: "/api/v1/me", operationId: "getCurrentUser", summary: "Lấy tài khoản và vai trò", auth: true, response: { 200: meResponse } },
  { method: "get", path: "/api/v1/catalog", operationId: "getCatalog", summary: "Đọc danh mục và giá", auth: true, response: { 200: catalogResponse } },
  { method: "post", path: "/api/v1/source-files/signed-url", operationId: "createSourceSignedUrl", summary: "Tạo URL ảnh nguồn có thời hạn", auth: true, body: signedUrlBody, response: { 200: signedUrlResponse } },
  { method: "post", path: "/api/v1/prices/{priceId}/update", operationId: "updatePrice", summary: "Cập nhật giá có kiểm toán", auth: true, body: priceUpdateSchema, params: priceIdPathParams, response: { 200: priceUpdateResponse } },
  { method: "post", path: "/api/v1/catalog/update", operationId: "updateCatalogItem", summary: "Cập nhật mặt hàng", auth: true, body: catalogUpdateSchema, response: { 200: catalogUpdateResponse } },
  { method: "post", path: "/api/v1/prices/undo", operationId: "undoPrice", summary: "Hoàn tác giá có kiểm toán", auth: true, body: priceUndoSchema, response: { 200: priceWriteResponse } },
  { method: "post", path: "/api/v1/rag/query", operationId: "queryKnowledgeBase", summary: "Tra cứu tài liệu và giá", auth: true, body: ragQueryBody, response: { 200: ragQueryResponse } },
  { method: "get", path: "/api/v1/admin/rag/pages", operationId: "listRagPages", summary: "Liệt kê trang nguồn", auth: true, owner: true, response: { 200: pagesResponse } },
  { method: "put", path: "/api/v1/admin/rag/pages", operationId: "saveRagPage", summary: "Lưu trạng thái duyệt trang", auth: true, owner: true, body: savePageBody, response: { 200: savePageResponse } },
  { method: "get", path: "/api/v1/admin/rag/index", operationId: "getRagIndex", summary: "Lấy tiến độ lập chỉ mục", auth: true, owner: true, response: { 200: indexResponse } },
  { method: "post", path: "/api/v1/admin/rag/index", operationId: "buildRagIndex", summary: "Lập chỉ mục tài liệu", auth: true, owner: true, response: { 200: indexRunResponse } },
  { method: "get", path: "/api/v1/admin/rag/health", operationId: "getRagHealth", summary: "Kiểm tra dịch vụ RAG", auth: true, owner: true, response: { 200: ragHealthResponse, 503: z.union([ragHealthResponse, errorResponse]) } },
  { method: "post", path: "/api/v1/admin/rag/preview", operationId: "previewRagPage", summary: "Xem trước phân đoạn văn bản", auth: true, owner: true, body: previewBody, response: { 200: previewResponse } },
] as const;

export type ApiContract = typeof apiContracts[number];

export function getApiContract(operationId: ApiContract["operationId"]): ApiContract {
  const contract = apiContracts.find((item) => item.operationId === operationId);
  if (!contract) throw new Error(`Missing API contract: ${operationId}`);
  return contract;
}

export function zodJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
  if (typeof json !== "object" || json === null || Array.isArray(json)) throw new Error("Expected an object JSON Schema");
  const { $schema: _draft, ...fastifySchema } = json;
  return fastifySchema;
}

export function fastifyRouteSchema(contract: ApiContract): Record<string, unknown> {
  const result: Record<string, unknown> = { summary: contract.summary, operationId: contract.operationId, tags: [contract.path.includes("/admin/") ? "RAG Admin" : "PriceApp"] };
  if ("auth" in contract && contract.auth) result.security = [{ bearerAuth: [] }];
  if ("owner" in contract && contract.owner) result["x-required-role"] = ["owner"];
  if ("body" in contract && contract.body) result.body = zodJsonSchema(contract.body);
  if ("params" in contract && contract.params) result.params = zodJsonSchema(contract.params);
  const response: Record<number, Record<string, unknown>> = {};
  for (const [status, schema] of Object.entries(contract.response)) response[Number(status)] = zodJsonSchema(schema);
  for (const status of [400, 401, 403, 409, 422, 503]) response[status] ??= zodJsonSchema(errorResponse);
  result.response = response;
  return result;
}
