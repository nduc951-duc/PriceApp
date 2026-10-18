import { describe, expect, it, vi } from "vitest";
import { latestAssistantVariantIds } from "./rag-conversations.service.js";
import type { SupabaseClient } from "@supabase/supabase-js";

function clientWithMetadata(metadata: unknown, owned = true) {
  const calls: Array<{ table: string; filters: Array<[string, unknown]>; selected?: string }> = [];
  const client = {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      let selected: string | undefined;
      const record = () => calls.push({ table, filters: [...filters], selected });
      const query = {
        select(value: string) { selected = value; return query; },
        eq(column: string, value: unknown) { filters.push([column, value]); return query; },
        order() { return query; },
        limit() { return query; },
        async maybeSingle() {
          record();
          if (table === "rag_conversations") return { data: owned ? { id: "conversation-a" } : null, error: null };
          return { data: { metadata }, error: null };
        },
      };
      return query;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("owner-scoped previous RAG result IDs", () => {
  it("reads only IDs from the latest assistant metadata and bounds them", async () => {
    const { client, calls } = clientWithMetadata({ variantIds: [7, 7, 8, -1, "9", ...Array.from({ length: 45 }, (_, i) => i + 10)] });

    const ids = await latestAssistantVariantIds(client, "user-a", "conversation-a");

    expect(ids).toEqual([7, 8, ...Array.from({ length: 38 }, (_, i) => i + 10)]);
    expect(calls).toContainEqual({
      table: "rag_conversation_messages",
      filters: [["conversation_id", "conversation-a"], ["role", "assistant"]],
      selected: "metadata",
    });
  });

  it("does not read assistant metadata for another owner's conversation", async () => {
    const { client, calls } = clientWithMetadata({ variantIds: [1] }, false);

    await expect(latestAssistantVariantIds(client, "user-b", "conversation-a")).rejects.toMatchObject({ statusCode: 404 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.filters).toEqual([["id", "conversation-a"], ["owner_id", "user-b"]]);
  });
});
