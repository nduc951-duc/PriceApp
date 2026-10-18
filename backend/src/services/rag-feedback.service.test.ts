import { describe, expect, it, vi } from "vitest";
import { submitPublicRagFeedback } from "./rag-feedback.service.js";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("public RAG feedback persistence", () => {
  it("forwards only the signed response identifier and bounded rating to the RPC", async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const client = { rpc } as unknown as SupabaseClient;

    await expect(submitPublicRagFeedback(client, {
      responseId: "65ff0101-0101-4101-8101-010101010101", expiresAt: 1_800_000_600, signature: "a".repeat(64),
    }, { helpful: false, reason: "missing_or_incorrect_citation" })).resolves.toEqual({ saved: true });
    expect(rpc).toHaveBeenCalledWith("submit_public_rag_feedback", {
      p_response_id: "65ff0101-0101-4101-8101-010101010101", p_expires_at: 1_800_000_600, p_signature: "a".repeat(64),
      p_helpful: false, p_reason: "missing_or_incorrect_citation",
    });
  });

  it("keeps owner summary aggregation compatible with existing and public feedback reasons", async () => {
    const from = vi.fn((table: string) => {
      const value = table === "rag_feedback"
        ? [{ helpful: true, reason: null, created_at: "2026-10-17T00:00:00Z" }]
        : [{ helpful: false, reason: "wrong_price_or_unit", created_at: "2026-10-17T00:01:00Z" }];
      const query = {
        select: () => query,
        order: () => query,
        limit: async () => ({ data: value, error: null }),
      };
      return query;
    });
    const { ragFeedbackSummary } = await import("./rag-feedback.service.js");

    await expect(ragFeedbackSummary({ from } as unknown as SupabaseClient)).resolves.toMatchObject({
      total: 2, helpful: 1, notHelpful: 1, truncated: false,
      reasons: expect.arrayContaining([{ reason: "wrong_price_or_unit", count: 1 }]),
    });
    expect(from).toHaveBeenCalledWith("rag_feedback");
    expect(from).toHaveBeenCalledWith("rag_public_feedback");
  });
});
