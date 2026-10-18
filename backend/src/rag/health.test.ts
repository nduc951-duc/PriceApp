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
    vi.stubEnv("RAG_EMBEDDING_MODEL", "bge-m3");
    client = { from: (table: string) => {
      if (table === "rag_page_texts") throw new Error("OCR must never be read");
      const query: Record<string, unknown> = {};
      query.eq = () => query; query.order = () => query;
      query.maybeSingle = async () => ({ data: { active_generation: 4 }, error: null });
      query.range = async () => table === "product_variants"
        ? { data: Array.from({ length: 12 }, (_, index) => ({ id: index + 1 })), error: null }
        : { data: Array.from({ length: 10 }, (_, index) => ({ product_variant_id: index < 8 ? index + 1 : index - 7, embedding_model: "bge-m3" })), error: null };
      query.then = (resolve: (value: unknown) => unknown) => resolve({ count: 12, error: null });
      return { select: () => query };
    } } as unknown as SupabaseClient;
    mocks.embedTexts.mockResolvedValue([Array(1024).fill(0.01)]);
    mocks.generateAnswer.mockResolvedValue("OK");
  });

  it("reports the three checks and vector dimension separately", async () => {
    const body = await healthRag(client);
    expect(body.database).toMatchObject({ ok: true, count: 10, catalogVariants: 12, embeddedVariants: 8, missingVariants: 4, activeGeneration: 4 });
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
