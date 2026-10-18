import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";
import { requireOwnedConversation } from "./rag-conversations.service.js";
import type { RagFeedbackInput } from "../schemas/rag-feedback.schema.js";
import type { VerifiedRagPublicFeedbackHandle } from "./rag-public-feedback-handle.js";

const reasons = ["missing_data", "wrong_product_specification", "wrong_price_or_unit", "missing_or_incorrect_citation", "retrieval_or_provider_failure", "retrieval_error", "answer_error", "other"] as const;
export type RagFeedbackReason = typeof reasons[number];

export async function submitRagFeedback(
  client: SupabaseClient,
  userId: string,
  conversationId: string,
  input: RagFeedbackInput,
) {
  await requireOwnedConversation(client, userId, conversationId);
  const { data: message, error: messageError } = await client.from("rag_conversation_messages")
    .select("id")
    .eq("id", input.assistantMessageId)
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .maybeSingle();
  if (messageError) throw new Error("Unable to validate feedback target");
  if (!message) throw new ApiError(404, "NOT_FOUND", "Assistant response not found");

  const { error } = await client.from("rag_feedback").insert({
    user_id: userId,
    conversation_id: conversationId,
    assistant_message_id: input.assistantMessageId,
    helpful: input.helpful,
    reason: input.helpful ? null : input.reason,
  }).select("id").single();
  if (error?.code === "23505") return { saved: true as const };
  if (error) throw new Error("Unable to save feedback");
  return { saved: true as const };
}

export async function submitPublicRagFeedback(
  client: SupabaseClient,
  handle: VerifiedRagPublicFeedbackHandle,
  input: { helpful: boolean; reason?: RagFeedbackReason },
) {
  const { error } = await client.rpc("submit_public_rag_feedback", {
    p_response_id: handle.responseId,
    p_expires_at: handle.expiresAt,
    p_signature: handle.signature,
    p_helpful: input.helpful,
    p_reason: input.helpful ? null : input.reason ?? null,
  });
  if (error && /invalid_submission_signature|feedback_reason_required|invalid_feedback_reason/i.test(error.message)) {
    throw new ApiError(400, "INVALID_INPUT", "Feedback handle expired or invalid");
  }
  if (error && /feedback_not_configured/i.test(error.message)) throw new ApiError(503, "INTERNAL_ERROR", "Public feedback is not configured");
  if (error) throw new ApiError(503, "INTERNAL_ERROR", "Could not save public feedback");
  return { saved: true as const };
}

export async function ragFeedbackSummary(client: SupabaseClient) {
  const [{ data, error }, { data: publicData, error: publicError }] = await Promise.all([
    client.from("rag_feedback")
    .select("helpful,reason,created_at")
    .order("created_at", { ascending: false })
    .limit(1000),
    client.from("rag_public_feedback")
      .select("helpful,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);
  if (error || publicError) throw new Error("Unable to read feedback summary");
  const rows = [...(data ?? []), ...(publicData ?? [])] as Array<{ helpful: boolean; reason: RagFeedbackReason | null; created_at: string }>;
  return {
    total: rows.length,
    helpful: rows.filter((row) => row.helpful).length,
    notHelpful: rows.filter((row) => !row.helpful).length,
    reasons: reasons.map((reason) => ({ reason, count: rows.filter((row) => row.reason === reason).length })),
    truncated: (data?.length ?? 0) === 1000 || (publicData?.length ?? 0) === 1000,
  };
}
