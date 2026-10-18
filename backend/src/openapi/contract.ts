import { z } from "zod";
import { catalogUpdateSchema, demoPriceApplySchema, demoPriceRollbackSchema, priceUndoSchema, priceUpdateSchema } from "../schemas/prices.schema.js";
import { signedUrlBody } from "../schemas/source-files.schema.js";
import { customerOrderBodySchema, customerOrderIdParamsSchema, customerOrderListSchema, customerOrderReceiptSchema, customerOrderStatusBodySchema, publicCatalogResponseSchema } from "../schemas/customer-orders.schema.js";

const id = z.number().int().positive();
const text = z.string();
const role = z.enum(["owner", "editor", "viewer"]);
export const errorResponse = z.object({ error: z.object({ code: text, message: text }), requestId: text });
const catalogEntry = z.object({ categoryId: id, productId: id, variantId: id, name: text, category: text, spec: text, displayName: text, productCode: text.nullable(), aliases: z.array(text), sourcePages: z.array(z.number()), sourceFiles: z.array(text), verificationStatus: z.enum(["verified", "needs_review", "unreadable"]) });
const catalogPrice = z.object({
  id, priceId: id, categoryId: id, productId: id, variantId: id, packagingId: id,
  name: text, category: text, variantDisplayName: text, spec: text, variantSpec: text,
  packageName: text, packageQuantity: z.number(), packageNote: text, priceType: text,
  minimumQuantity: z.number(), price: z.number(), isDemo: z.boolean(), purchasable: z.boolean(), unit: text, supplier: text,
  sourcePages: z.array(z.number()), sourceFiles: z.array(text), validFrom: text, validTo: text.nullable(),
  status: z.enum(["verified", "needs_review", "unreadable"]), version: z.number().int(),
});
const catalogResponse = z.object({ entries: z.array(catalogEntry), prices: z.array(catalogPrice), syncedAt: text });
const meResponse = z.object({ userId: text, role });
const priceWriteResponse = z.object({ amount: z.number(), version: z.number().int() });
const priceUpdateResponse = priceWriteResponse.extend({ historyId: id });
const demoPricePreviewResponse = z.object({
  batchId: z.string(), snapshotHash: z.string(), ruleVersion: z.string(), count: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(), remainingCount: z.number().int().nonnegative(),
  items: z.array(z.object({ variantId: id, productId: id, packagingId: id, quantity: z.number(), unit: text,
    amount: z.number(), method: z.enum(["same_package_median", "fallback_fixture"]), referencePriceIds: z.array(id) })),
});
const demoPriceApplyResponse = z.object({ batchId: z.string(), created: z.number().int().nonnegative(), resumed: z.boolean() });
const demoPriceRollbackResponse = z.object({ batchId: z.string(), deactivated: z.number().int().nonnegative() });
const catalogUpdateResponse = z.object({
  ok: z.literal(true), category: z.object({ id, name: text }), product: z.object({ id, name: text }),
  variant: z.object({ id, displayName: text, rawSpecification: text }),
  packaging: z.object({ id, name: text, quantity: z.number(), baseUnit: text }).nullable(),
  price: z.object({ id, amount: z.number(), version: z.number().int(), priceType: z.enum(["retail", "wholesale", "dealer"]), minimumQuantity: z.number() }).nullable(),
});
const signedUrlResponse = z.object({ signedUrl: z.url(), expiresIn: z.literal(300) });
const ragQueryBody = z.strictObject({ question: z.string().trim().min(1).max(1000), conversationId: z.uuid().optional() });
const publicRagQueryBody = z.strictObject({
  question: z.string().trim().min(1).max(1000),
  previousQuestion: z.string().trim().max(1000).optional(),
  previousVariantIds: z.array(id).max(40).optional(),
});
const conversationIdParams = z.strictObject({ conversationId: z.uuid() });
const conversation = z.object({ id: z.uuid(), created_at: text });
const conversationListResponse = z.object({ conversations: z.array(conversation) });
const conversationMessage = z.object({
  id: z.uuid(), role: z.enum(["user", "assistant"]), content: text.nullable(),
  metadata: z.record(z.string(), z.unknown()), created_at: text,
});
const conversationMessagesResponse = z.object({ messages: z.array(conversationMessage) });
// The controller applies the allowlist. Keep unknown metadata fields intact here so
// Fastify cannot silently strip a forbidden amount/price before strict validation.
const conversationMetadataInput = z.record(z.string(), z.unknown()).optional();
const appendConversationMessageBody = z.strictObject({
  role: z.literal("user"),
  content: z.string().trim().min(1).max(4000),
  metadata: conversationMetadataInput,
});
const ragFeedbackReason = z.enum(["missing_data", "wrong_product_specification", "wrong_price_or_unit", "missing_or_incorrect_citation", "retrieval_or_provider_failure", "retrieval_error", "answer_error", "other"]);
const submitRagFeedbackBody = z.union([
  z.strictObject({ assistantMessageId: z.uuid(), helpful: z.literal(true), reason: ragFeedbackReason.optional() }),
  z.strictObject({ assistantMessageId: z.uuid(), helpful: z.literal(false), reason: ragFeedbackReason }),
]);
const submitPublicRagFeedbackBody = z.union([
  z.strictObject({ feedbackHandle: z.string().min(1).max(512), helpful: z.literal(true), reason: ragFeedbackReason.optional() }),
  z.strictObject({ feedbackHandle: z.string().min(1).max(512), helpful: z.literal(false), reason: ragFeedbackReason }),
]);
const feedbackSummary = z.object({
  total: z.number().int().nonnegative(), helpful: z.number().int().nonnegative(), notHelpful: z.number().int().nonnegative(),
  reasons: z.array(z.object({ reason: ragFeedbackReason, count: z.number().int().nonnegative() })), truncated: z.boolean(),
});
const verificationStatus = z.enum(["verified", "needs_review", "unreadable", "sample"]);
const ragPrice = z.object({
  id, packagingId: id, version: z.number().int(), amount: z.number(), priceType: z.enum(["retail", "wholesale", "dealer"]), minimumQuantity: z.number(),
  packagingName: text, packageQuantity: z.number(), unit: text, packageNote: text,
  priceList: text.nullable(), supplier: text.nullable(), isDemo: z.boolean(), purchasable: z.boolean(), verificationStatus,
});
const ragItem = z.object({
  id, productName: text, category: text, variant: text, verificationStatus,
  sourcePages: z.array(z.number()), prices: z.array(ragPrice),
});
const ragSource = z.object({
  pageNumber: id.nullable(), chunkId: id, chunkKey: text, sourceRevision: id.nullable(),
  sourceSpan: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).nullable(),
  excerpt: text, evidenceKind: z.literal("verified_catalog"),
  verifiedVariantId: id.optional(), verifiedPriceId: id.optional(),
});
const ragTrace = z.object({ question: text, chunkIds: z.array(id), variantIds: z.array(id), priceIds: z.array(id), answer: text });
const ragCatalogPage = z.object({
  total: z.number().int().nonnegative(),
  nextCursor: id.nullable(),
  complete: z.boolean(),
});
const ragEvidenceIds = z.array(text);
const ragAnswerBlock = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("narrative"), text, evidenceIds: ragEvidenceIds }),
  z.strictObject({ kind: z.literal("clarification"), text, unresolvedFields: z.array(text), evidenceIds: ragEvidenceIds }),
  z.strictObject({ kind: z.literal("comparison"), text, variantIds: z.array(id), evidenceIds: ragEvidenceIds }),
  z.strictObject({ kind: z.literal("recommendation"), text, variantIds: z.array(id), evidenceIds: ragEvidenceIds }),
]);
const ragQueryResponse = z.object({
  status: z.enum(["answered", "clarify", "insufficient_evidence"]), clarification: text.optional(), conversationId: z.uuid().optional(), feedbackMessageId: z.uuid().optional(), publicFeedbackHandle: z.string().max(512).optional(),
  answer: text, answerBlocks: z.array(ragAnswerBlock).optional(), items: z.array(ragItem), sources: z.array(ragSource),
  catalogPage: ragCatalogPage.optional(),
  retrieval: z.object({ vectorChunks: z.number(), lexicalProducts: z.number(), embeddingModel: text, trace: ragTrace.optional() }),
});
const indexRun = z.object({ runId: id, status: z.enum(["running", "failed", "completed"]), checkpoint: z.number(), chunks: z.number(), indexed: z.number(), reused: z.number(), removed: z.number(), embeddingModel: text, contentHash: text });
const indexResponse = z.object({ run: indexRun.nullable() });
const indexRunResponse = indexRun.extend({ pages: z.number(), variants: z.number(), embeddingDimensions: z.number() });
const indexJobResponse = z.object({ job: z.object({
  status: z.enum(["queued", "running", "completed", "failed"]), requestedRevision: z.number().int(), completedRevision: z.number().int(),
  attempts: z.number().int(), maxAttempts: z.number().int(), availableAt: text, lastErrorCode: text.nullable(),
  lastErrorMessage: text.nullable(), updatedAt: text,
}).nullable() });
const failedDiagnostic = z.object({ ok: z.literal(false), detail: text });
const databaseDiagnostic = z.union([failedDiagnostic, z.object({ ok: z.literal(true), detail: text, count: z.number(), catalogVariants: z.number().optional(), embeddedVariants: z.number().optional(), missingVariants: z.number().optional(), activeGeneration: id.nullable().optional() })]);
const embeddingDiagnostic = z.union([failedDiagnostic, z.object({ ok: z.literal(true), detail: text, model: text, dimensions: z.number(), fingerprint: text })]);
const chatDiagnostic = z.union([failedDiagnostic, z.object({ ok: z.literal(true), detail: text, model: text })]);
const ragHealthResponse = z.object({ ok: z.boolean(), provider: text, database: databaseDiagnostic, embedding: embeddingDiagnostic, chat: chatDiagnostic });
const priceIdPathParams = z.object({ priceId: z.string().regex(/^[1-9]\d*$/) });

export const apiContracts = [
  { method: "get", path: "/api/v1/health", operationId: "getHealth", summary: "Kiểm tra trạng thái API", response: { 200: z.object({ status: z.literal("ok") }) } },
  { method: "get", path: "/api/v1/me", operationId: "getCurrentUser", summary: "Lấy tài khoản và vai trò", auth: true, response: { 200: meResponse } },
  { method: "get", path: "/api/v1/catalog", operationId: "getCatalog", summary: "Đọc danh mục và giá", auth: true, response: { 200: catalogResponse } },
  { method: "get", path: "/api/v1/public/catalog", operationId: "getPublicCustomerCatalog", summary: "Đọc danh mục và giá công khai cho khách", response: { 200: publicCatalogResponseSchema } },
  { method: "post", path: "/api/v1/public/order-requests", operationId: "createPublicCustomerOrder", summary: "Tạo yêu cầu đơn hàng công khai", body: customerOrderBodySchema, response: { 201: customerOrderReceiptSchema } },
  { method: "get", path: "/api/v1/customer-order-requests", operationId: "listCustomerOrderRequests", summary: "Liệt kê yêu cầu đơn của cửa hàng", auth: true, roles: ["owner", "editor"], response: { 200: customerOrderListSchema } },
  { method: "post", path: "/api/v1/customer-order-requests", operationId: "createStaffCustomerOrder", summary: "Nhân viên tạo đơn cho khách", auth: true, roles: ["owner", "editor"], body: customerOrderBodySchema, response: { 201: customerOrderReceiptSchema } },
  { method: "patch", path: "/api/v1/customer-order-requests/{requestId}/status", operationId: "updateCustomerOrderStatus", summary: "Cập nhật trạng thái xử lý yêu cầu đơn", auth: true, roles: ["owner", "editor"], params: customerOrderIdParamsSchema, body: customerOrderStatusBodySchema, response: { 200: z.object({ updated: z.literal(true) }) } },
  { method: "post", path: "/api/v1/source-files/signed-url", operationId: "createSourceSignedUrl", summary: "Tạo URL ảnh nguồn có thời hạn", auth: true, body: signedUrlBody, response: { 200: signedUrlResponse } },
  { method: "post", path: "/api/v1/prices/{priceId}/update", operationId: "updatePrice", summary: "Cập nhật giá có kiểm toán", auth: true, body: priceUpdateSchema, params: priceIdPathParams, response: { 200: priceUpdateResponse } },
  { method: "post", path: "/api/v1/catalog/update", operationId: "updateCatalogItem", summary: "Cập nhật mặt hàng", auth: true, body: catalogUpdateSchema, response: { 200: catalogUpdateResponse } },
  { method: "post", path: "/api/v1/prices/undo", operationId: "undoPrice", summary: "Hoàn tác giá có kiểm toán", auth: true, body: priceUndoSchema, response: { 200: priceWriteResponse } },
  { method: "get", path: "/api/v1/admin/demo-prices/preview", operationId: "previewDemoPrices", summary: "Xem trước giá demo còn thiếu", auth: true, owner: true, response: { 200: demoPricePreviewResponse } },
  { method: "post", path: "/api/v1/admin/demo-prices/apply", operationId: "applyDemoPrices", summary: "Tạo giá demo có kiểm toán", auth: true, owner: true, body: demoPriceApplySchema, response: { 200: demoPriceApplyResponse } },
  { method: "post", path: "/api/v1/admin/demo-prices/rollback", operationId: "rollbackDemoPrices", summary: "Hoàn tác một lô giá demo", auth: true, owner: true, body: demoPriceRollbackSchema, response: { 200: demoPriceRollbackResponse } },
  { method: "post", path: "/api/v1/rag/query", operationId: "queryKnowledgeBase", summary: "Tra cứu tài liệu và giá", auth: true, body: ragQueryBody, response: { 200: ragQueryResponse } },
  { method: "post", path: "/api/v1/public/rag/query", operationId: "queryPublicKnowledgeBase", summary: "Khách tra cứu giá từ catalog công khai đã xác minh", auth: false, body: publicRagQueryBody, response: { 200: ragQueryResponse } },
  { method: "post", path: "/api/v1/public/rag/feedback", operationId: "submitPublicRagFeedback", summary: "Khách gửi phản hồi gắn với một câu trả lời RAG", auth: false, body: submitPublicRagFeedbackBody, response: { 200: z.object({ saved: z.literal(true) }) } },
  { method: "post", path: "/api/v1/rag/conversations", operationId: "createRagConversation", summary: "Tạo hội thoại RAG của người dùng", auth: true, response: { 200: conversation } },
  { method: "get", path: "/api/v1/rag/conversations", operationId: "listRagConversations", summary: "Liệt kê hội thoại RAG của người dùng", auth: true, response: { 200: conversationListResponse } },
  { method: "get", path: "/api/v1/rag/conversations/{conversationId}", operationId: "readRagConversation", summary: "Đọc tin nhắn hội thoại RAG", auth: true, params: conversationIdParams, response: { 200: conversationMessagesResponse } },
  { method: "post", path: "/api/v1/rag/conversations/{conversationId}/messages", operationId: "appendRagConversationMessage", summary: "Thêm câu hỏi hoặc metadata trả lời vào hội thoại", auth: true, params: conversationIdParams, body: appendConversationMessageBody, response: { 200: conversationMessage } },
  { method: "post", path: "/api/v1/rag/conversations/{conversationId}/feedback", operationId: "submitRagFeedback", summary: "Gửi đánh giá câu trả lời RAG", auth: true, params: conversationIdParams, body: submitRagFeedbackBody, response: { 200: z.object({ saved: z.literal(true) }) } },
  { method: "get", path: "/api/v1/admin/rag/feedback", operationId: "getRagFeedbackSummary", summary: "Xem tổng hợp phản hồi RAG", auth: true, owner: true, response: { 200: feedbackSummary } },
  { method: "get", path: "/api/v1/admin/rag/index", operationId: "getRagIndex", summary: "Lấy tiến độ lập chỉ mục", auth: true, owner: true, response: { 200: indexResponse } },
  { method: "get", path: "/api/v1/admin/rag/index-job", operationId: "getRagIndexJobStatus", summary: "Lấy trạng thái job lập chỉ mục tự động", auth: true, owner: true, response: { 200: indexJobResponse } },
  { method: "post", path: "/api/v1/admin/rag/index", operationId: "buildRagIndex", summary: "Lập chỉ mục tài liệu", auth: true, owner: true, response: { 200: indexRunResponse } },
  { method: "get", path: "/api/v1/admin/rag/health", operationId: "getRagHealth", summary: "Kiểm tra dịch vụ RAG", auth: true, owner: true, response: { 200: ragHealthResponse, 503: z.union([ragHealthResponse, errorResponse]) } },
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
  const result: Record<string, unknown> = { summary: contract.summary, operationId: contract.operationId, tags: [contract.path.includes("customer-order") || contract.path.includes("public/") ? "Customer Orders" : contract.path.includes("/admin/") ? "RAG Admin" : "PriceApp"] };
  if ("auth" in contract && contract.auth) result.security = [{ bearerAuth: [] }];
  if ("owner" in contract && contract.owner) result["x-required-role"] = ["owner"];
  if ("roles" in contract && contract.roles) result["x-required-role"] = contract.roles;
  if ("body" in contract && contract.body) result.body = zodJsonSchema(contract.body);
  if ("params" in contract && contract.params) result.params = zodJsonSchema(contract.params);
  const response: Record<number, Record<string, unknown>> = {};
  for (const [status, schema] of Object.entries(contract.response)) response[Number(status)] = zodJsonSchema(schema);
  for (const status of [400, 401, 403, 409, 422, 429, 503]) response[status] ??= zodJsonSchema(errorResponse);
  result.response = response;
  return result;
}
