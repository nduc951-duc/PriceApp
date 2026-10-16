import type { FastifyRequest } from "fastify";
import { ApiError } from "../middleware/errors.js";
import { appendConversationMessage, createConversation, listConversations, readConversation } from "../services/rag-conversations.service.js";
import { appendConversationMessageBodySchema, conversationIdParamsSchema } from "../schemas/rag-conversations.schema.js";

function validate<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(400, "INVALID_INPUT", "Invalid conversation request");
  return parsed.data;
}

export async function ragConversationCreate(request: FastifyRequest) {
  return createConversation(request.auth!.client, request.auth!.user.id);
}

export async function ragConversationList(request: FastifyRequest) {
  return listConversations(request.auth!.client, request.auth!.user.id);
}

export async function ragConversationRead(request: FastifyRequest) {
  const { conversationId } = validate(conversationIdParamsSchema, request.params);
  return readConversation(request.auth!.client, request.auth!.user.id, conversationId);
}

export async function ragConversationAppend(request: FastifyRequest) {
  const { conversationId } = validate(conversationIdParamsSchema, request.params);
  const body = validate(appendConversationMessageBodySchema, request.body);
  return appendConversationMessage(request.auth!.client, request.auth!.user.id, conversationId, body);
}
