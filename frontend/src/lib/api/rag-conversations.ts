import { requestApi } from "./client";
import type { ApiRequestBody, ApiResponse } from "./generated/api-types";

export type RagConversation = ApiResponse<"/api/v1/rag/conversations", "post">;
export type RagConversationList = ApiResponse<"/api/v1/rag/conversations", "get">;
export type RagConversationMessages = ApiResponse<"/api/v1/rag/conversations/{conversationId}", "get">;
export type AppendRagConversationMessage = ApiRequestBody<"/api/v1/rag/conversations/{conversationId}/messages", "post">;
export type SubmitRagFeedback = ApiRequestBody<"/api/v1/rag/conversations/{conversationId}/feedback", "post">;
export type RagFeedbackSummary = ApiResponse<"/api/v1/admin/rag/feedback", "get">;

export function createRagConversation() {
  return requestApi<RagConversation>("/api/v1/rag/conversations", { method: "POST" });
}

export function listRagConversations() {
  return requestApi<RagConversationList>("/api/v1/rag/conversations", { method: "GET" });
}

export function readRagConversation(conversationId: string) {
  return requestApi<RagConversationMessages>(`/api/v1/rag/conversations/${encodeURIComponent(conversationId)}`, { method: "GET" });
}

export function appendRagConversationMessage(conversationId: string, message: AppendRagConversationMessage) {
  return requestApi(`/api/v1/rag/conversations/${encodeURIComponent(conversationId)}/messages`, { method: "POST", body: JSON.stringify(message) });
}

export function submitRagFeedback(conversationId: string, feedback: SubmitRagFeedback) {
  return requestApi<{ saved: true }>(`/api/v1/rag/conversations/${encodeURIComponent(conversationId)}/feedback`, { method: "POST", body: JSON.stringify(feedback) });
}

export function fetchRagFeedbackSummary() {
  return requestApi<RagFeedbackSummary>("/api/v1/admin/rag/feedback", { method: "GET" });
}
