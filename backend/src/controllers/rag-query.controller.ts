import type { FastifyRequest } from "fastify";
import { queryRag } from "../services/rag-query.service.js";
import { ApiError } from "../middleware/errors.js";
import { appendConversationMessage, createConversation, latestUserQuestion } from "../services/rag-conversations.service.js";

export async function ragQuery(request: FastifyRequest) {
  try {
    const input = request.body as { question: string; conversationId?: string };
    const client = request.auth!.client;
    const ownerId = request.auth!.user.id;
    if (!input.conversationId) return await queryRag({ question: input.question }, client);
    const conversation = { id: input.conversationId };
    const previousQuestion = await latestUserQuestion(client, ownerId, conversation.id);
    await appendConversationMessage(client, ownerId, conversation.id, { role: "user", content: input.question });
    const result = await queryRag({ question: input.question }, client, { previousQuestion });
    const resultStatus = result.status === "answered" ? "grounded" : result.status === "clarify" ? "needs_clarification" : "abstained";
    const assistantMessage = await appendConversationMessage(client, ownerId, conversation.id, {
      role: "assistant",
      metadata: {
        status: resultStatus,
        variantIds: result.items.map((item) => item.id),
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
    const input = request.body as { question: string; previousQuestion?: string };
    return await queryRag({ question: input.question }, request.server.publicSupabaseFactory(), { previousQuestion: input.previousQuestion }, { publicCatalogOnly: true });
  } catch (error) {
    if (error instanceof Error && /chưa được cấu hình/.test(error.message)) {
      throw new ApiError(503, "RAG_UNAVAILABLE", "Dịch vụ RAG chưa được cấu hình.");
    }
    throw error;
  }
}
