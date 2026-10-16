import type { FastifyRequest } from "fastify";
import { ApiError } from "../middleware/errors.js";
import { ragFeedbackBodySchema, ragFeedbackParamsSchema } from "../schemas/rag-feedback.schema.js";
import { ragFeedbackSummary, submitRagFeedback } from "../services/rag-feedback.service.js";

export async function ragFeedbackSubmit(request: FastifyRequest) {
  const params = ragFeedbackParamsSchema.safeParse(request.params);
  const body = ragFeedbackBodySchema.safeParse(request.body);
  if (!params.success || !body.success) throw new ApiError(400, "INVALID_INPUT", "Invalid RAG feedback request");
  return submitRagFeedback(request.auth!.client, request.auth!.user.id, params.data.conversationId, body.data);
}

export async function ragFeedbackRead(request: FastifyRequest) {
  return ragFeedbackSummary(request.auth!.client);
}
