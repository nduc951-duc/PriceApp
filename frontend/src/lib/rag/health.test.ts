import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), embedTexts: vi.fn(), generateAnswer: vi.fn(),
}));

vi.mock("@/lib/rag/auth", () => ({ authenticateRagRequest: mocks.authenticate }));
vi.mock("@/lib/rag/provider", () => ({
  embeddingModel: () => "bge-m3", chatModel: () => "qwen2.5:1.5b", providerName: () => "ollama",
  embedTexts: mocks.embedTexts, generateGroundedAnswer: mocks.generateAnswer,
}));

import { GET } from "@/app/api/rag/health/route";

const request = () => new Request("http://localhost/api/rag/health");

describe("RAG health diagnostics", () => {
  beforeEach(() => {
    mocks.authenticate.mockResolvedValue({
      ok: true,
      client: { from: (table: string) => ({ select: () => ({
        eq: async () => ({ count: table === "rag_page_texts" ? 2 : 0, error: null }),
        then: (resolve: (value: { count: number; error: null }) => unknown) => resolve({ count: 10, error: null }),
      }) }) },
    });
    mocks.embedTexts.mockResolvedValue([Array(1024).fill(0.01)]);
    mocks.generateAnswer.mockResolvedValue("OK");
  });

  it("reports the three checks and vector dimension separately", async () => {
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.database).toMatchObject({ ok: true, count: 10 });
    expect(body.embedding).toMatchObject({ ok: true, dimensions: 1024, model: "bge-m3" });
    expect(body.embedding.fingerprint).toHaveLength(16);
    expect(body.chat).toMatchObject({ ok: true, model: "qwen2.5:1.5b" });
  });

  it("keeps database and chat results visible when embedding fails", async () => {
    mocks.embedTexts.mockRejectedValueOnce(new Error("model offline"));
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.database.ok).toBe(true);
    expect(body.embedding).toMatchObject({ ok: false, detail: "model offline" });
    expect(body.chat.ok).toBe(true);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});
