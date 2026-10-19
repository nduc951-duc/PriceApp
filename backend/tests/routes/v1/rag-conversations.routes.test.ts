import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "../../../src/app.js";
import type { SupabaseFactory } from "../../../src/repositories/supabase-client.js";

const env = { supabaseUrl: "https://project.supabase.co", supabasePublishableKey: "public-key", allowedOrigins: [], port: 3001 };
const conversationId = "00000000-0000-4000-8000-000000000001";
const token = (userId: string) => `header.${Buffer.from(JSON.stringify({ iss: `${env.supabaseUrl}/auth/v1`, exp: Math.floor(Date.now() / 1000) + 600, sub: userId })).toString("base64url")}.signature`;

function fixture() {
  const calls: Array<{ userId: string; table: string; operation: string; filters: Array<[string, unknown]>; payload?: unknown }> = [];
  const factory = ((authToken: string) => {
    const claims = JSON.parse(Buffer.from(authToken.split(".")[1]!, "base64url").toString()) as { sub: string };
    const userId = claims.sub;
    return {
      auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
      from: (table: string) => {
        let operation = "select";
        let payload: unknown;
        const filters: Array<[string, unknown]> = [];
        const entry = () => { if (table !== "profiles") calls.push({ userId, table, operation, filters: [...filters], payload }); };
        const query: Record<string, (...args: unknown[]) => unknown> = {
          select: () => query,
          insert: (value: unknown) => { operation = "insert"; payload = value; return query; },
          eq: (column: unknown, value: unknown) => { filters.push([String(column), value]); return query; },
          order: () => query,
          limit: async () => { entry(); return { data: [], error: null }; },
          maybeSingle: async () => {
            entry();
            const ownerFilter = filters.find(([column]) => column === "owner_id")?.[1];
            const data = table === "profiles" ? { role: "viewer" } : ownerFilter && ownerFilter !== "user-a" ? null : { id: conversationId };
            return { data, error: null };
          },
          single: async () => { entry(); return { data: table === "rag_conversations"
            ? { id: conversationId, created_at: "2026-10-10T00:00:00Z" }
            : { id: conversationId, role: (payload as { role: string }).role, content: (payload as { content: string | null }).content, metadata: (payload as { metadata: unknown }).metadata, created_at: "2026-10-10T00:00:00Z" }, error: null }; },
        };
        return query;
      },
    };
  }) as unknown as SupabaseFactory;
  return { app: buildApp({ env, supabaseFactory: factory }), calls };
}

describe("user-scoped RAG conversations API", () => {
  it("requires authentication and never caches conversation responses", async () => {
    const { app } = fixture();
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/rag/conversations" });
      expect(response.statusCode).toBe(401);
      expect(response.headers["cache-control"]).toContain("no-store");
    } finally { await app.close(); }
  });

  it("creates a conversation using the authenticated user's caller-scoped client", async () => {
    const { app, calls } = fixture();
    try {
      const response = await app.inject({ method: "POST", url: "/api/v1/rag/conversations", headers: { authorization: `Bearer ${token("user-a")}` }, payload: {} });
      expect(response.statusCode).toBe(200);
      expect(calls).toEqual([{ userId: "user-a", table: "rag_conversations", operation: "insert", filters: [], payload: { owner_id: "user-a" } }]);
      expect(response.headers["cache-control"]).toContain("private");
      expect(response.headers["cache-control"]).toContain("no-store");
    } finally { await app.close(); }
  });

  it("applies the authenticated owner filter when listing conversations", async () => {
    const { app, calls } = fixture();
    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/rag/conversations", headers: { authorization: `Bearer ${token("user-b")}` } });
      expect(response.statusCode).toBe(200);
      expect(calls[0]).toMatchObject({ userId: "user-b", table: "rag_conversations", operation: "select", filters: [["owner_id", "user-b"]] });
    } finally { await app.close(); }
  });

  it("hides another user's conversation when reading it", async () => {
    const { app, calls } = fixture();
    try {
      const response = await app.inject({ method: "GET", url: `/api/v1/rag/conversations/${conversationId}`, headers: { authorization: `Bearer ${token("user-b")}` } });
      expect(response.statusCode).toBe(404);
      expect(calls[0]).toMatchObject({ userId: "user-b", table: "rag_conversations", filters: [["id", conversationId], ["owner_id", "user-b"]] });
      expect(calls.some(call => call.table === "rag_conversation_messages")).toBe(false);
    } finally { await app.close(); }
  });

  it("rejects assistant prose and price values", async () => {
    const { app, calls } = fixture();
    try {
      const headers = { authorization: `Bearer ${token("user-a")}` };
      const badText = await app.inject({ method: "POST", url: `/api/v1/rag/conversations/${conversationId}/messages`, headers, payload: { role: "assistant", content: "price text" } });
      const badMetadata = await app.inject({ method: "POST", url: `/api/v1/rag/conversations/${conversationId}/messages`, headers, payload: { role: "assistant", metadata: { amount: 500000, price: 500000 } } });
      const forgedAssistant = await app.inject({ method: "POST", url: `/api/v1/rag/conversations/${conversationId}/messages`, headers, payload: { role: "assistant", metadata: { status: "grounded", variantIds: [7], priceIds: [9] } } });
      expect(badText.statusCode).toBe(400);
      expect(badMetadata.statusCode).toBe(400);
      expect(forgedAssistant.statusCode).toBe(400);
      expect(calls).toHaveLength(0);
    } finally { await app.close(); }
  });

  it("filters reads by authenticated owner and stores only user questions or allowlisted metadata", async () => {
    const { app, calls } = fixture();
    try {
      const response = await app.inject({
        method: "POST", url: `/api/v1/rag/conversations/${conversationId}/messages`, headers: { authorization: `Bearer ${token("user-a")}` },
        payload: { role: "user", content: "question", metadata: { confirmedAttributes: { size: "M8" } } },
      });
      expect(response.statusCode).toBe(200);
      expect(calls).toEqual([
        { userId: "user-a", table: "rag_conversations", operation: "select", filters: [["id", conversationId], ["owner_id", "user-a"]] },
        { userId: "user-a", table: "rag_conversation_messages", operation: "insert", filters: [], payload: { conversation_id: conversationId, role: "user", content: "question", metadata: { confirmedAttributes: { size: "M8" } } } },
      ]);
    } finally { await app.close(); }
  });

  it("stores feedback only for an assistant message in the caller's conversation", async () => {
    const { app, calls } = fixture();
    try {
      const response = await app.inject({
        method: "POST", url: `/api/v1/rag/conversations/${conversationId}/feedback`, headers: { authorization: `Bearer ${token("user-a")}` },
        payload: { assistantMessageId: conversationId, helpful: false, reason: "retrieval_error" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ saved: true });
      expect(calls.at(-1)).toMatchObject({
        userId: "user-a", table: "rag_feedback", operation: "insert",
        payload: { user_id: "user-a", conversation_id: conversationId, assistant_message_id: conversationId, helpful: false, reason: "retrieval_error" },
      });
    } finally { await app.close(); }
  });

  it("requires a reason for negative feedback and owner access for the summary", async () => {
    const { app } = fixture();
    try {
      const invalid = await app.inject({ method: "POST", url: `/api/v1/rag/conversations/${conversationId}/feedback`, headers: { authorization: `Bearer ${token("user-a")}` }, payload: { assistantMessageId: conversationId, helpful: false } });
      const forbidden = await app.inject({ method: "GET", url: "/api/v1/admin/rag/feedback", headers: { authorization: `Bearer ${token("user-a")}` } });
      expect(invalid.statusCode).toBe(400);
      expect(forbidden.statusCode).toBe(403);
    } finally { await app.close(); }
  });

  it("declares forced owner RLS for both tables and parent-checked message access", () => {
    const migrationPath = resolve(import.meta.dirname, "../../../../supabase/migrations/202610100001_rag_conversations.sql");
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/owner_id\s*=\s*\(select auth\.uid\(\)\)/i);
    expect(sql).toMatch(/rag_conversations\.owner_id\s*=\s*\(select auth\.uid\(\)\)/i);
    expect(sql).toMatch(/GRANT SELECT, INSERT ON TABLE public\.rag_conversations TO authenticated/i);
  });

  it("declares user-scoped feedback RLS and validates feedback target ownership", () => {
    const migrationPath = resolve(import.meta.dirname, "../../../../supabase/migrations/202610120001_rag_feedback.sql");
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/i);
    expect(sql).toMatch(/user_id\s*=\s*\(select auth\.uid\(\)\)/i);
    expect(sql).toMatch(/m\.role\s*=\s*'assistant'/i);
    expect(sql).toMatch(/reason is not null/i);
  });
});
