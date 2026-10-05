import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  embedTexts: vi.fn(), generateAnswer: vi.fn(),
}));

vi.mock("./provider.js", () => ({
  embeddingModel: () => "bge-m3", chatModel: () => "qwen2.5:1.5b", providerName: () => "ollama",
  embedTexts: mocks.embedTexts, generateGroundedAnswer: mocks.generateAnswer,
}));

import { healthRag } from "../services/rag-health.service.js";
import type { SupabaseClient } from "@supabase/supabase-js";
let client: SupabaseClient;



describe("RAG health diagnostics", () => {
  beforeEach(() => {
    client = { from: (table: string) => ({ select: () => ({
        eq: async () => ({ count: table === "rag_page_texts" ? 2 : 0, error: null }),
        then: (resolve: (value: { count: number; error: null }) => unknown) => resolve({ count: 10, error: null }),
      }) }) } as unknown as SupabaseClient;
    mocks.embedTexts.mockResolvedValue([Array(1024).fill(0.01)]);
    mocks.generateAnswer.mockResolvedValue("OK");
  });

  it("reports the three checks and vector dimension separately", async () => {
    const body = await healthRag(client);
    expect(body.database).toMatchObject({ ok: true, count: 10 });
    expect(body.embedding).toMatchObject({ ok: true, dimensions: 1024, model: "bge-m3" });
    expect(body.embedding.fingerprint).toHaveLength(16);
    expect(body.chat).toMatchObject({ ok: true, model: "qwen2.5:1.5b" });
  });

  it("keeps database and chat results visible when embedding fails", async () => {
    mocks.embedTexts.mockRejectedValueOnce(new Error("model offline"));
    const body = await healthRag(client);
    expect(body.database.ok).toBe(true);
    expect(body.embedding).toMatchObject({ ok: false, detail: "Không kiểm tra được dịch vụ." });
    expect(body.chat.ok).toBe(true);
  });
});
