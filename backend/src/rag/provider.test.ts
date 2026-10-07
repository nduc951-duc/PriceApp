import { describe, expect, it, vi } from "vitest";
import { embedTexts, normalizeIndexedEmbeddings, RagProviderUnavailableError } from "./provider.js";

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

it.each([429, 500, 503])("classifies provider HTTP %i as a safe transient outage", async (status) => {
  vi.stubEnv("RAG_AI_PROVIDER", "openai");
  vi.stubEnv("RAG_AI_BASE_URL", "https://provider.example/v1");
  vi.stubEnv("RAG_EMBEDDING_MODEL", "test-1024");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-token raw-OCR", { status })));
  try {
    const error = await embedTexts(["question"]).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(RagProviderUnavailableError);
    expect(String(error)).not.toMatch(/private-token|raw-OCR/);
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});

it.each([new TypeError("private network details"), Object.assign(new Error("private timeout details"), { name: "TimeoutError" })])(
  "classifies network failures as a safe provider outage",
  async (failure) => {
    vi.stubEnv("RAG_AI_PROVIDER", "openai");
    vi.stubEnv("RAG_AI_BASE_URL", "https://provider.example/v1");
    vi.stubEnv("RAG_EMBEDDING_MODEL", "test-1024");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(failure));
    try {
      const error = await embedTexts(["question"]).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(RagProviderUnavailableError);
      expect(error).toMatchObject({ message: "RAG provider unavailable" });
      expect(String(error)).not.toMatch(/private network|private timeout/);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  },
);

it("preserves unexpected provider programming errors for 500 handling", async () => {
  vi.stubEnv("RAG_AI_PROVIDER", "openai");
  vi.stubEnv("RAG_AI_BASE_URL", "https://provider.example/v1");
  vi.stubEnv("RAG_EMBEDDING_MODEL", "test-1024");
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("programmer bug")));
  try {
    const error = await embedTexts(["question"]).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ message: "programmer bug" });
    expect(error).not.toBeInstanceOf(RagProviderUnavailableError);
  } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
});
