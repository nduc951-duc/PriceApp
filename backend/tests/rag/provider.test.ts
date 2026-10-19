import { describe, expect, it, vi } from "vitest";
import { embedTexts, generateGroundedAnswer, normalizeIndexedEmbeddings, RagProviderUnavailableError } from "../../src/rag/provider.js";
import * as ragProvider from "../../src/rag/provider.js";

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
  it("requests a constrained JSON query plan without generating answer facts", async () => {
    expect(ragProvider).toHaveProperty("generateQueryPlanText");
    const generate = (ragProvider as Record<string, unknown>).generateQueryPlanText;
    if (typeof generate !== "function") return;
    vi.stubEnv("RAG_AI_PROVIDER", "ollama");
    vi.stubEnv("RAG_AI_BASE_URL", "http://localhost:11434");
    vi.stubEnv("RAG_CHAT_MODEL", "qwen2.5:3b");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { content: JSON.stringify({ intent: "catalog_list", requests: [], confidence: 0.9 }) },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(generate({ question: "Có những loại tắc kê nào?" })).resolves.toContain("catalog_list");
      const [, init] = fetchMock.mock.calls[0] as [string, { body?: string }];
      const request = JSON.parse(String(init.body));
      expect(request).toMatchObject({
        format: {
          type: "object",
          required: ["intent", "requests", "unresolvedFields", "conversationPhrases"],
          additionalProperties: false,
          properties: { confidence: { type: "number" } },
        },
        options: { temperature: 0 },
      });
      expect(request.format.required).not.toContain("confidence");
      expect(request.format.properties.requests.items.required).toEqual(["intent", "productText", "specifications", "requestedFields", "constraints"]);
      expect(request.format.properties.requests.items.properties.requestedFields.items.enum).toContain("products");
      expect(request.tools).toBeUndefined();
      expect(request.messages[0].content).toMatch(/intent|ý định/i);
      expect(request.messages[0].content).toMatch(/không.*giá|không.*số tiền/i);
      expect(request.messages[0].content).toContain("may omit confidence");
      expect(request.messages[0].content).toContain("The root object must include intent and requests");
      expect(request.messages[0].content).toContain("Every request must include intent, specifications, requestedFields, and constraints");
      expect(request.messages[0].content).toContain("mỗi dòng product_variants là một quy cách");
      expect(request.messages[0].content).toContain("requestedFields gồm products");
      expect(request.messages[0].content).toContain("8x60 và 8x100");
      expect(request.messages[1].content).toContain("Có những loại tắc kê nào?");
      const userPayload = JSON.parse(request.messages[1].content);
      expect(userPayload.schema.requests[0]).toHaveProperty("categoryText");
      expect(userPayload.schema.requests[0]).toHaveProperty("requestedQuantity");
      expect(userPayload.schema.requests[0]).toHaveProperty("previousReference");
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it("requests JSON-object mode from OpenAI-compatible chat endpoints", async () => {
    expect(ragProvider).toHaveProperty("generateQueryPlanText");
    const generate = (ragProvider as Record<string, unknown>).generateQueryPlanText;
    if (typeof generate !== "function") return;
    vi.stubEnv("RAG_AI_PROVIDER", "openai");
    vi.stubEnv("RAG_AI_BASE_URL", "https://provider.example/v1");
    vi.stubEnv("RAG_CHAT_MODEL", "test-chat");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "{}" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      await generate({ question: "Tôi cần xem thông tin sản phẩm" });
      const [, init] = fetchMock.mock.calls[0] as [string, { body?: string }];
      expect(JSON.parse(String(init.body))).toMatchObject({ response_format: { type: "json_object" }, temperature: 0 });
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

  it("requests evidence-bound response blocks without sending authoritative price fields", async () => {
    expect(ragProvider).toHaveProperty("generateGroundedResponseText");
    const generate = (ragProvider as Record<string, unknown>).generateGroundedResponseText;
    if (typeof generate !== "function") return;
    vi.stubEnv("RAG_AI_PROVIDER", "ollama");
    vi.stubEnv("RAG_AI_BASE_URL", "http://localhost:11434");
    vi.stubEnv("RAG_CHAT_MODEL", "qwen2.5:3b");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: { content: JSON.stringify({ blocks: [{ kind: "narrative", text: "MÃ¬nh Ä‘Ã£ tÃ¬m tháº¥y báº±ng chá»©ng phÃ¹ há»£p.", evidenceIds: ["variant:1"] }] }) },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const raw = await generate({
        question: "TÃ¬m tÃ c kÃª 6x50",
        plan: { intent: "price_lookup" },
        evidence: [{ id: "variant:1", kind: "catalog", summary: "Táº¯c kÃª; quy cÃ¡ch 6x50" }],
      });
      expect(raw).toContain("variant:1");
      const [, init] = fetchMock.mock.calls[0] as [string, { body?: string }];
      const request = JSON.parse(String(init.body));
      expect(request).toMatchObject({ format: "json", options: { temperature: 0 } });
      expect(request.tools).toBeUndefined();
      expect(request.messages[0].content).toMatch(/evidenceIds|báº±ng chá»©ng/i);
      expect(request.messages[0].content).toContain("Bạn là nhân viên tư vấn vật tư tận tình, hỗ trợ nhân viên cửa hàng và khách hàng");
      expect(request.messages[0].content).toContain("gợi ý tối đa 3 cách viết lại câu hỏi");
      expect(request.messages[0].content).toContain("chỉ dùng tên mặt hàng và quy cách có trong bằng chứng");
      expect(request.messages[0].content).toContain("Không nêu giá, nguồn, số trang");
      expect(request.messages[1].content).not.toMatch(/34000|VND|Ä‘Æ¡n vá»‹ tÃ­nh/i);
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });

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
