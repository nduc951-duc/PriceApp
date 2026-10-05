import { describe, expect, it, vi } from "vitest";
import { embedTexts, normalizeIndexedEmbeddings } from "./provider.js";

const vector = () => Array(1024).fill(0.1);

describe("embedding response order", () => {
  it("restores input order from provider indexes", () => {
    const second = vector(); second[0] = 0.2;
    expect(normalizeIndexedEmbeddings([{ index: 1, embedding: second }, { index: 0, embedding: vector() }], 2))
      .toEqual([vector(), second]);
  });
  it("rejects missing, duplicate, and malformed vectors", () => {
    expect(() => normalizeIndexedEmbeddings([{ index: 0, embedding: vector() }], 2)).toThrow();
    expect(() => normalizeIndexedEmbeddings([{ index: 0, embedding: vector() }, { index: 0, embedding: vector() }], 2)).toThrow();
    expect(() => normalizeIndexedEmbeddings([{ index: 0, embedding: [0.1] }], 1)).toThrow();
  });
});

it("keeps provider response bodies out of errors", async () => {
  vi.stubEnv("RAG_AI_PROVIDER", "openai");
  vi.stubEnv("RAG_AI_BASE_URL", "https://provider.example/v1");
  vi.stubEnv("RAG_EMBEDDING_MODEL", "test-1024");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-token raw-OCR private-user", { status: 401 })));
  try {
    const error = await embedTexts(["question"]).catch(cause => cause);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("HTTP 401");
    expect(error.message).not.toMatch(/private-token|raw-OCR|private-user/);
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});
