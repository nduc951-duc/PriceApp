import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildApp } from "../../../src/app.js";
import type { SupabaseFactory } from "../../../src/repositories/supabase-client.js";
import { createRagPublicFeedbackHandle } from "../../../src/services/rag-public-feedback-handle.js";

const secret = "test-only-feedback-secret-0123456789";
const env = { supabaseUrl: "https://project.example", supabasePublishableKey: "publishable", ragFeedbackHmacSecret: secret, allowedOrigins: [], port: 3001 };

function fixture() {
  const rpc = vi.fn(async () => ({ data: true, error: null }));
  const factory = vi.fn(() => ({ rpc })) as unknown as SupabaseFactory;
  return { app: buildApp({ env, supabaseFactory: factory }), rpc };
}

describe("public response-bound RAG feedback route", () => {
  it("submits an anonymous rating only through a signed response handle", async () => {
    const { app, rpc } = fixture();
    try {
      const feedbackHandle = createRagPublicFeedbackHandle(secret);
      const response = await app.inject({ method: "POST", url: "/api/v1/public/rag/feedback", payload: { feedbackHandle, helpful: false, reason: "wrong_price_or_unit" } });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ saved: true });
      expect(rpc).toHaveBeenCalledWith("submit_public_rag_feedback", expect.objectContaining({
        p_response_id: expect.stringMatching(/^[0-9a-f-]{36}$/i),
        p_expires_at: expect.any(Number),
        p_signature: expect.stringMatching(/^[0-9a-f]{64}$/),
        p_helpful: false,
        p_reason: "wrong_price_or_unit",
      }));
    } finally { await app.close(); }
  });

  it("rejects missing reasons and invalid handles without a database call", async () => {
    const { app, rpc } = fixture();
    try {
      const noReason = await app.inject({ method: "POST", url: "/api/v1/public/rag/feedback", payload: { feedbackHandle: createRagPublicFeedbackHandle(secret), helpful: false } });
      const invalidHandle = await app.inject({ method: "POST", url: "/api/v1/public/rag/feedback", payload: { feedbackHandle: "not-signed", helpful: true } });

      expect(noReason.statusCode).toBe(400);
      expect(invalidHandle.statusCode).toBe(400);
      expect(rpc).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("limits repeated anonymous ratings per source IP without storing IP in the payload", async () => {
    const { app, rpc } = fixture();
    try {
      const feedbackHandle = createRagPublicFeedbackHandle(secret);
      const responses = [];
      for (let index = 0; index < 11; index += 1) {
        responses.push(await app.inject({ method: "POST", url: "/api/v1/public/rag/feedback", payload: { feedbackHandle, helpful: true } }));
      }
      expect(responses.slice(0, 10).every((response) => response.statusCode === 200)).toBe(true);
      expect(responses[10]?.statusCode).toBe(429);
      expect(JSON.stringify(rpc.mock.calls)).not.toContain("127.0.0.1");
    } finally { await app.close(); }
  });

  it("declares only a narrow anonymous RPC, no direct table writes, and forced owner-read RLS", () => {
    const migration = readFileSync(resolve(import.meta.dirname, "../../../../supabase/migrations/202610180006_rag_feedback_taxonomy_and_public_handles.sql"), "utf8");
    expect(migration).toMatch(/revoke all on public\.rag_public_feedback from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.submit_public_rag_feedback\([\s\S]+?\) to anon/i);
    expect(migration).toMatch(/security definer[\s\S]+?set search_path = public/i);
    expect(migration).toMatch(/enable row level security/i);
    expect(migration).toMatch(/force row level security/i);
    expect(migration).toMatch(/response_id uuid not null unique/i);
    expect(migration).toMatch(/on conflict \(response_id\) do nothing/i);
    expect(migration).not.toMatch(/create table[\s\S]*?ip_address/i);
  });
});
