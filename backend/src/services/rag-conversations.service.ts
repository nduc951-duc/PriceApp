import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";
import type { StoredConversationMessageInput } from "../schemas/rag-conversations.schema.js";

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

export async function appendConversationMessage(client: SupabaseClient, ownerId: string, conversationId: string, input: StoredConversationMessageInput) {
  await requireOwnedConversation(client, ownerId, conversationId);
  const { data, error } = await client.from("rag_conversation_messages")
    .insert({ conversation_id: conversationId, role: input.role, content: input.role === "user" ? input.content : null, metadata: input.metadata ?? {} })
    .select(messageColumns)
    .single();
  if (error || !data) throw new Error("Unable to append conversation message");
  return data;
}
