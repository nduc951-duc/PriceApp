import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";
import type { StoredConversationMessageInput } from "../schemas/rag-conversations.schema.js";
import type { RagHistoryMessage } from "../rag/retrieved-context.js";

const conversationColumns = "id,created_at";
const messageColumns = "id,role,content,metadata,created_at";

export async function createConversation(client: SupabaseClient, ownerId: string) {
  const { data, error } = await client.from("rag_conversations")
    .insert({ owner_id: ownerId })
    .select(conversationColumns)
    .single();
  if (error || !data) throw new Error("Unable to create conversation");
  return data;
}

export async function listConversations(client: SupabaseClient, ownerId: string) {
  const { data, error } = await client.from("rag_conversations")
    .select(conversationColumns)
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Unable to list conversations");
  return { conversations: data ?? [] };
}

export async function requireOwnedConversation(client: SupabaseClient, ownerId: string, conversationId: string) {
  const { data, error } = await client.from("rag_conversations")
    .select("id")
    .eq("id", conversationId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) throw new Error("Unable to read conversation");
  if (!data) throw new ApiError(404, "NOT_FOUND", "Conversation not found");
}

export async function readConversation(client: SupabaseClient, ownerId: string, conversationId: string) {
  await requireOwnedConversation(client, ownerId, conversationId);
  const { data, error } = await client.from("rag_conversation_messages")
    .select(messageColumns)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw new Error("Unable to read conversation messages");
  return { messages: data ?? [] };
}

export async function latestUserQuestion(client: SupabaseClient, ownerId: string, conversationId: string) {
  await requireOwnedConversation(client, ownerId, conversationId);
  const { data, error } = await client.from("rag_conversation_messages")
    .select("content")
    .eq("conversation_id", conversationId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Unable to read conversation context");
  return typeof data?.content === "string" ? data.content : undefined;
}

/** Keep previous assistant selections as context, never as a historical price authority. */
export async function recentConversationHistory(client: SupabaseClient, ownerId: string, conversationId: string): Promise<RagHistoryMessage[]> {
  await requireOwnedConversation(client, ownerId, conversationId);
  const { data, error } = await client.from("rag_conversation_messages").select("role,content,metadata")
    .eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(6);
  if (error) throw new Error("Unable to read recent conversation context");
  return (data ?? []).reverse().flatMap<RagHistoryMessage>(row => {
    if (row.role === "user" && typeof row.content === "string") return [{ role: "user" as const, content: row.content.slice(0, 1000) }];
    if (row.role === "assistant") {
      const values = row.metadata?.variantIds;
      const ids = Array.isArray(values) ? values.filter((id: unknown) => Number.isSafeInteger(id) && Number(id) > 0).slice(0, 40) : [];
      return [{ role: "assistant" as const, content: JSON.stringify({ previous_result_variant_ids: ids, status: row.metadata?.status ?? "unknown" }) }];
    }
    return [];
  });
}

export async function latestAssistantVariantIds(client: SupabaseClient, ownerId: string, conversationId: string) {
  await requireOwnedConversation(client, ownerId, conversationId);
  const { data, error } = await client.from("rag_conversation_messages")
    .select("metadata")
    .eq("conversation_id", conversationId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("Unable to read prior assistant result context");
  const metadata = data?.metadata;
  if (typeof metadata !== "object" || metadata === null || !("variantIds" in metadata)) return [];
  const variantIds = (metadata as { variantIds?: unknown }).variantIds;
  if (!Array.isArray(variantIds)) return [];
  return [...new Set(variantIds.filter((id): id is number => Number.isSafeInteger(id) && id > 0))].slice(0, 40);
}

export async function appendConversationMessage(client: SupabaseClient, ownerId: string, conversationId: string, input: StoredConversationMessageInput) {
  await requireOwnedConversation(client, ownerId, conversationId);
  const { data, error } = await client.from("rag_conversation_messages")
    .insert({ conversation_id: conversationId, role: input.role, content: input.role === "user" ? input.content : null, metadata: input.metadata ?? {} })
    .select(messageColumns)
    .single();
  if (error || !data) throw new Error("Unable to append conversation message");
  return data;
}
