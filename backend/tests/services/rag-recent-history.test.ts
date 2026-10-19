import { expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recentConversationHistory } from "../../src/services/rag-conversations.service.js";

it("checks ownership and reads only the last six turns, without replaying stored assistant money", async () => {
  const messages = {
    select: vi.fn(() => messages), eq: vi.fn(() => messages), order: vi.fn(() => messages),
    limit: vi.fn(async () => ({ error: null, data: [
      { role: "assistant", content: "Giá cũ 999999 đồng", metadata: { status: "grounded", variantIds: [47, -1] } },
      { role: "user", content: "Bulong 8×30", metadata: {} },
    ] })),
  };
  const owned = { select: vi.fn(() => owned), eq: vi.fn(() => owned), maybeSingle: vi.fn(async () => ({ data: { id: "conversation" }, error: null })) };
  const client = { from: vi.fn((table: string) => table === "rag_conversations" ? owned : messages) } as unknown as SupabaseClient;
  const result = await recentConversationHistory(client, "owner", "conversation");
  expect(owned.eq).toHaveBeenCalledWith("owner_id", "owner");
  expect(messages.limit).toHaveBeenCalledWith(6);
  expect(messages.order).toHaveBeenCalledWith("created_at", { ascending: false });
  expect(result[0]).toEqual({ role: "user", content: "Bulong 8×30" });
  expect(result[1]?.role).toBe("assistant");
  expect(result[1]?.content).toContain("47");
  expect(result[1]?.content).not.toContain("999999");
});

it("rejects another owner's conversation before reading any message", async () => {
  const owned = { select: vi.fn(() => owned), eq: vi.fn(() => owned), maybeSingle: vi.fn(async () => ({ data: null, error: null })) };
  const from = vi.fn(() => owned);
  await expect(recentConversationHistory({ from } as unknown as SupabaseClient, "owner", "other")).rejects.toMatchObject({ statusCode: 404 });
  expect(from).toHaveBeenCalledTimes(1);
  expect(from).toHaveBeenCalledWith("rag_conversations");
});
