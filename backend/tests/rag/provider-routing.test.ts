import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { embedTexts, embeddingFingerprint, generateGroundedAnswer, generateGroundedResponseText, generateQueryPlanText, generateRetrievedCatalogAnswer } from "../../src/rag/provider.js";
type FetchInit = NonNullable<Parameters<typeof fetch>[1]>;

beforeEach(() => {
  vi.stubEnv("RAG_AI_PROVIDER", "ollama");
  vi.stubEnv("RAG_AI_BASE_URL", "http://localhost:11434");
  vi.stubEnv("RAG_CHAT_PROVIDER", "gemini");
  vi.stubEnv("RAG_CHAT_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/");
  vi.stubEnv("RAG_CHAT_API_KEY", "test-cloud-key");
  vi.stubEnv("RAG_CHAT_MODEL", "gemini-3.8-flash");
  vi.stubEnv("RAG_EMBEDDING_PROVIDER", "ollama");
  vi.stubEnv("RAG_EMBEDDING_BASE_URL", "http://localhost:11434");
  vi.stubEnv("RAG_EMBEDDING_API_KEY", "");
  vi.stubEnv("RAG_EMBEDDING_MODEL", "bge-m3");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("routes Gemini embeddings separately from local chat and normalizes reduced-dimensional vectors", async () => {
  vi.stubEnv("RAG_CHAT_PROVIDER", "openai");
  vi.stubEnv("RAG_EMBEDDING_PROVIDER", "gemini");
  vi.stubEnv("RAG_EMBEDDING_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai");
  vi.stubEnv("RAG_EMBEDDING_API_KEY", "embedding-key");
  vi.stubEnv("RAG_EMBEDDING_MODEL", "gemini-embedding-001");
  const vector = Array(1024).fill(0); vector[0] = 3; vector[1] = 4;
  // Google's protobuf JSON omits the default index=0 field.
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ embedding: vector }] })));
  vi.stubGlobal("fetch", fetchMock);
  const [result] = await embedTexts(["Bulong 8 ly x 3F"]);
  expect(result![0]).toBeCloseTo(0.6);
  expect(result![1]).toBeCloseTo(0.8);
  expect(Math.hypot(...result!)).toBeCloseTo(1);
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
  expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/embeddings");
  expect(init.headers).toMatchObject({ Authorization: "Bearer embedding-key" });
  expect(JSON.parse(String(init.body))).toMatchObject({ model: "gemini-embedding-001", dimensions: 1024 });
});

it("rejects a zero-norm Gemini embedding instead of indexing an unusable vector", async () => {
  vi.stubEnv("RAG_EMBEDDING_PROVIDER", "gemini");
  vi.stubEnv("RAG_EMBEDDING_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai");
  vi.stubEnv("RAG_EMBEDDING_API_KEY", "embedding-key");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ embedding: Array(1024).fill(0) }] }))));
  await expect(embedTexts(["bulong"])).rejects.toThrow(/zero.norm/);
});

it("uses the local OpenAI-compatible server with compact SQL facts and the existing embedding model", async () => {
  vi.stubEnv("RAG_CHAT_PROVIDER", "openai");
  vi.stubEnv("RAG_CHAT_BASE_URL", "http://127.0.0.1:1234/v1");
  vi.stubEnv("RAG_CHAT_API_KEY", "");
  vi.stubEnv("RAG_CHAT_MODEL", "qwen/qwen3-vl-8b");
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] })));
  vi.stubGlobal("fetch", fetchMock);
  const row = { id: 47, productId: 2, productName: "Bulong", category: "Vật tư", specification: "8 ly x 3F", description: "Có tán", attributes: {}, packages: [] };
  await generateRetrievedCatalogAnswer({ question: "giới thiệu bulong", history: [], previousVariantIds: [], truncated: false,
    catalog: [row], chunks: [{ id: 11, variantId: 47, similarity: 0.8, content: JSON.stringify({ provenance: "current_sql", ...row }) }] });
  const [url, init] = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
  expect(url).toBe("http://127.0.0.1:1234/v1/chat/completions");
  expect(init.headers).not.toHaveProperty("Authorization");
  const body = JSON.parse(String(init.body));
  expect(body.model).toBe("qwen/qwen3-vl-8b");
  expect(body).not.toHaveProperty("reasoning_effort");
  expect(body.response_format.json_schema.strict).toBe(true);
  expect(body.response_format.json_schema.schema.properties.listedProductIds.items.enum).toEqual([2]);
  expect(JSON.parse(body.messages.at(-1).content).verifiedCatalog).toMatchObject({ products: [{ productId: 2, productName: "Bulong", variants: [{ variantId: 47, specification: "8 ly x 3F" }] }] });
  expect(process.env.RAG_EMBEDDING_MODEL).toBe("bge-m3");
});

it("sends the original user prompt, conversation and full retrieved content in one grounded call", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const question = "tôi muốn bulong, thì bên bạn có những loại nào";
  const content = "Quy cách và đóng gói đã xác minh. ".repeat(30);
  await generateRetrievedCatalogAnswer({ question, history: [{ role: "user", content: "Tôi cần vật tư" }], previousVariantIds: [],
    chunks: [{ id: 11, variantId: 47, content, similarity: 0.7 }], catalog: [], truncated: false });
  expect(fetchMock).toHaveBeenCalledOnce();
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
  const body = JSON.parse(String(init.body));
  expect(body.messages[1]).toEqual({ role: "user", content: "Tôi cần vật tư" });
  expect(JSON.parse(body.messages[2].content)).toMatchObject({ question, retrievedChunks: [{ id: 11, content }] });
  expect(body.response_format.json_schema.name).toBe("retrieved_catalog_answer");
  expect(body.response_format.json_schema.schema).not.toHaveProperty("$schema");
});

it("routes every chat operation to Gemini while keeping embeddings and their fingerprint on Ollama", async () => {
  const fetchMock = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/api/embed")
    ? { embeddings: [Array(1024).fill(0.1)] }
    : url.endsWith("/api/tags") ? { models: [{ name: "bge-m3:latest", digest: "unchanged-artifact" }] }
    : { choices: [{ message: { content: "{}" } }] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await generateQueryPlanText({ question: "giới thiệu bulong" });
  await generateGroundedAnswer({ question: "Bulong?", evidence: [] });
  await generateGroundedResponseText({ question: "Bulong?", plan: {}, evidence: [] });
  await embedTexts(["bulong"]);
  expect(await embeddingFingerprint()).toBe("ollama:bge-m3:unchanged-artifact:1024");
  for (const [url, init] of fetchMock.mock.calls as unknown as Array<[string, FetchInit]>) {
    const headers = init.headers as Record<string, string> | undefined;
    if (url.includes("googleapis.com")) {
      expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
      expect(headers?.Authorization).toBe("Bearer test-cloud-key");
      expect(JSON.parse(String(init.body)).model).toBe("gemini-3.8-flash");
      expect(JSON.parse(String(init.body)).reasoning_effort).toBe("low");
    } else {
      expect(headers?.Authorization).toBeUndefined();
      expect(url.startsWith("http://localhost:11434/api/")).toBe(true);
    }
  }
  const request = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, FetchInit])[1].body));
  expect(request.response_format).toMatchObject({ type: "json_schema", json_schema: { name: "rag_query_plan", schema: { type: "object" } } });
});

it("fails before a network call when the Gemini key is missing", async () => {
  vi.stubEnv("RAG_CHAT_API_KEY", "");
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  await expect(generateQueryPlanText({ question: "bulong" })).rejects.toThrow("RAG_CHAT_API_KEY");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not forward a legacy cloud key to an explicitly configured embedding server", async () => {
  vi.stubEnv("RAG_AI_API_KEY", "legacy-cloud-key");
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ embeddings: [Array(1024).fill(0.1)] }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  await embedTexts(["bulong"]);
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, FetchInit];
  expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
});
