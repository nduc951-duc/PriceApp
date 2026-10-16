import { describe, expect, it, vi } from "vitest";
import { embedTexts, generateGroundedAnswer, normalizeIndexedEmbeddings, RagProviderUnavailableError } from "./provider.js";

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

describe("Ollama model residency", () => {
  it("sets a configurable keep-alive for embeddings", async () => {
    vi.stubEnv("RAG_AI_PROVIDER", "ollama");
    vi.stubEnv("RAG_AI_BASE_URL", "http://localhost:11434");
    vi.stubEnv("RAG_EMBEDDING_MODEL", "bge-m3");
    vi.stubEnv("RAG_OLLAMA_KEEP_ALIVE", "15m");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ embeddings: [vector()] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await embedTexts(["question"]);
      const [url, init] = fetchMock.mock.calls[0] as [string, { body?: string }];
      expect(url).toBe("http://localhost:11434/api/embed");
      expect(JSON.parse(String(init.body))).toMatchObject({ keep_alive: "15m" });
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it("uses Ollama chat API so the configured keep-alive applies to answers", async () => {
    vi.stubEnv("RAG_AI_PROVIDER", "ollama");
    vi.stubEnv("RAG_AI_BASE_URL", "http://localhost:11434");
    vi.stubEnv("RAG_CHAT_MODEL", "qwen2.5:3b");
    vi.stubEnv("RAG_OLLAMA_KEEP_ALIVE", "15m");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content: "Grounded answer" } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(generateGroundedAnswer({ question: "question", evidence: [] })).resolves.toBe("Grounded answer");
      const [url, init] = fetchMock.mock.calls[0] as [string, { body?: string }];
      expect(url).toBe("http://localhost:11434/api/chat");
      expect(JSON.parse(String(init.body))).toMatchObject({ keep_alive: "15m", stream: false });
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
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
