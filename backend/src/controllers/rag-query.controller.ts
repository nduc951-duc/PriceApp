import type { FastifyRequest } from "fastify";
import { queryRag } from "../services/rag-query.service.js";
import { ApiError } from "../middleware/errors.js";
import { appendConversationMessage, createConversation, latestAssistantVariantIds, latestUserQuestion, recentConversationHistory } from "../services/rag-conversations.service.js";
import { retrievalFirstEnabled } from "../services/retrieval-first-rag.js";
import type { RagHistoryMessage } from "../rag/retrieved-context.js";
import { createRagPublicFeedbackHandle, verifyRagPublicFeedbackHandle } from "../services/rag-public-feedback-handle.js";
import { ragPublicFeedbackBodySchema } from "../schemas/rag-feedback.schema.js";
import { submitPublicRagFeedback } from "../services/rag-feedback.service.js";

export async function ragQuery(request: FastifyRequest) {
  try {
    const input = request.body as { question: string; conversationId?: string };
    const client = request.auth!.client;
    const ownerId = request.auth!.user.id;
    if (!input.conversationId) return await queryRag({ question: input.question }, client);
    const conversation = { id: input.conversationId };
    const [previousQuestion, previousVariantIds, history] = await Promise.all([
      latestUserQuestion(client, ownerId, conversation.id),
      latestAssistantVariantIds(client, ownerId, conversation.id),
      retrievalFirstEnabled() ? recentConversationHistory(client, ownerId, conversation.id) : Promise.resolve(undefined),
    ]);
    await appendConversationMessage(client, ownerId, conversation.id, { role: "user", content: input.question });
    const result = await queryRag({ question: input.question }, client, { previousQuestion, previousVariantIds, history });
    const resultStatus = result.status === "answered" ? "grounded" : result.status === "clarify" ? "needs_clarification" : "abstained";
    const assistantMessage = await appendConversationMessage(client, ownerId, conversation.id, {
      role: "assistant",
      metadata: {
        status: resultStatus,
        variantIds: [...new Set([
          ...("trace" in result.retrieval ? result.retrieval.trace?.variantIds ?? [] : []),
          ...result.items.map((item) => item.id),
        ])].slice(0, 40),
        priceIds: result.items.flatMap((item) => item.prices.map((price) => price.id)),
      },
    });
    return { ...result, conversationId: conversation.id, feedbackMessageId: assistantMessage.id };
  } catch (error) {
    if (error instanceof Error && /chưa được cấu hình/.test(error.message)) {
      throw new ApiError(503, "RAG_UNAVAILABLE", "Dịch vụ RAG chưa được cấu hình.");
    }
    throw error;
  }
}

export async function publicRagQuery(request: FastifyRequest) {
  try {
    const input = request.body as { question: string; previousQuestion?: string; previousVariantIds?: number[]; history?: RagHistoryMessage[] };
    const result = await queryRag({ question: input.question }, request.server.publicSupabaseFactory(), { previousQuestion: input.previousQuestion, previousVariantIds: input.previousVariantIds, history: input.history }, { publicCatalogOnly: true });
    const secret = request.server.ragFeedbackHmacSecret;
    return secret ? { ...result, publicFeedbackHandle: createRagPublicFeedbackHandle(secret) } : result;
  } catch (error) {
    if (error instanceof Error && /chưa được cấu hình/.test(error.message)) {
      throw new ApiError(503, "RAG_UNAVAILABLE", "Dịch vụ RAG chưa được cấu hình.");
    }
    throw error;
  }
}

export async function publicRagFeedback(request: FastifyRequest) {
  const parsed = ragPublicFeedbackBodySchema.safeParse(request.body);
  if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", "Invalid public RAG feedback request");
  const secret = request.server.ragFeedbackHmacSecret;
  if (!secret) throw new ApiError(503, "INTERNAL_ERROR", "Public feedback is not configured");
  const handle = verifyRagPublicFeedbackHandle(secret, parsed.data.feedbackHandle);
  if (!handle) throw new ApiError(400, "INVALID_INPUT", "Feedback handle expired or invalid");
  return submitPublicRagFeedback(request.server.publicSupabaseFactory(), handle, parsed.data);
}
