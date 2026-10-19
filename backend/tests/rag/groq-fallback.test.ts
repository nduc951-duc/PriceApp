import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { embedTexts, generateRetrievedCatalogAnswer } from "../../src/rag/provider.js";

const input = { question: "loại đó giá sỉ?", history: [{ role: "user" as const, content: "Bulong 8 ly x 3F" }], previousVariantIds: [47],
  chunks: [{ id: 11, variantId: 47, content: "Current catalog evidence", similarity: 0.8 }], catalog: [], truncated: false };
const answer = () => new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }));
beforeEach(() => {
  vi.stubEnv("RAG_CHAT_PROVIDER", "gemini");
  vi.stubEnv("RAG_CHAT_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai");
  vi.stubEnv("RAG_CHAT_MODEL", "gemini-test");
  vi.stubEnv("RAG_CHAT_API_KEY", "gemini-key");
  vi.stubEnv("RAG_CHAT_FALLBACK_PROVIDER", "groq");
  vi.stubEnv("RAG_CHAT_FALLBACK_API_KEY", "groq-key");
  vi.stubEnv("RAG_CHAT_FALLBACK_MODEL", "openai/gpt-oss-120b");
  vi.stubEnv("RAG_CHAT_FALLBACK_BASE_URL", "https://api.groq.com/openai/v1");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each([429, 503, "network", "timeout"])("uses Groq once after primary unavailability %s with identical evidence and separate credentials", async failure => {
  const fetchMock = vi.fn().mockImplementationOnce(async () => {
    if (failure === "network") throw new TypeError("fetch failed");
    if (failure === "timeout") { const error = new Error("timed out"); error.name = "TimeoutError"; throw error; }
    return new Response("{}", { status: failure });
  }).mockResolvedValueOnce(answer());
  vi.stubGlobal("fetch", fetchMock);
  expect(await generateRetrievedCatalogAnswer(input)).toBe("{}");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const [primary, fallback] = fetchMock.mock.calls;
  expect(fallback![0]).toBe("https://api.groq.com/openai/v1/chat/completions");
  expect(primary![1].headers.Authorization).toBe("Bearer gemini-key");
  expect(fallback![1].headers.Authorization).toBe("Bearer groq-key");
  const body = JSON.parse(fallback![1].body);
  expect(body.messages).toEqual(JSON.parse(primary![1].body).messages);
  expect(body.model).toBe("openai/gpt-oss-120b");
  expect(body.response_format.json_schema.strict).toBe(true);
  expect(body.response_format.json_schema.schema.properties.evidenceIds.items.enum).toEqual(["chunk:11"]);
  expect(body).not.toHaveProperty("reasoning_effort");
});
it("does not call fallback when primary succeeds", async () => {
  const fetchMock = vi.fn().mockResolvedValue(answer()); vi.stubGlobal("fetch", fetchMock);
  await generateRetrievedCatalogAnswer(input);
  expect(fetchMock).toHaveBeenCalledOnce();
});
it.each([429, 503, "network", "timeout"])("falls back from Groq to Gemini once after %s", async failure => {
  vi.stubEnv("RAG_CHAT_PROVIDER", "groq");
  vi.stubEnv("RAG_CHAT_BASE_URL", "https://api.groq.com/openai/v1");
  vi.stubEnv("RAG_CHAT_API_KEY", "groq-key");
  vi.stubEnv("RAG_CHAT_MODEL", "openai/gpt-oss-120b");
  vi.stubEnv("RAG_CHAT_FALLBACK_PROVIDER", "gemini");
  vi.stubEnv("RAG_CHAT_FALLBACK_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai");
  vi.stubEnv("RAG_CHAT_FALLBACK_API_KEY", "gemini-key");
  vi.stubEnv("RAG_CHAT_FALLBACK_MODEL", "gemini-test");
  const fetchMock = vi.fn().mockImplementationOnce(async () => {
    if (failure === "network") throw new TypeError("fetch failed");
    if (failure === "timeout") throw new globalThis.DOMException("timed out", "TimeoutError");
    return new Response("{}", { status: failure });
  }).mockResolvedValueOnce(answer());
  vi.stubGlobal("fetch", fetchMock);
  expect(await generateRetrievedCatalogAnswer(input)).toBe("{}");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const [primary, fallback] = fetchMock.mock.calls;
  expect(primary![0]).toContain("api.groq.com");
  expect(primary![1].headers.Authorization).toBe("Bearer groq-key");
  expect(fallback![0]).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  expect(fallback![1].headers.Authorization).toBe("Bearer gemini-key");
  const body = JSON.parse(fallback![1].body);
  expect(body.model).toBe("gemini-test");
  expect(body.reasoning_effort).toBe("low");
  expect(body.response_format.json_schema).not.toHaveProperty("strict");
  expect(body.messages.slice(0, -1)).toEqual(JSON.parse(primary![1].body).messages.slice(0, -1));
  expect(JSON.parse(body.messages.at(-1).content).question).toBe(input.question);
});
it("does not hide invalid primary credentials behind fallback", async () => {
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 401 })); vi.stubGlobal("fetch", fetchMock);
  await expect(generateRetrievedCatalogAnswer(input)).rejects.toThrow("401");
  expect(fetchMock).toHaveBeenCalledOnce();
});
it("does not retry the same Groq provider as its own fallback", async () => {
  vi.stubEnv("RAG_CHAT_PROVIDER", "groq");
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 429 }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(generateRetrievedCatalogAnswer(input)).rejects.toMatchObject({ upstreamStatus: 429 });
  expect(fetchMock).toHaveBeenCalledOnce();
});
it("does not send fallback traffic without its own key", async () => {
  vi.stubEnv("RAG_CHAT_FALLBACK_API_KEY", "");
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 429 })); vi.stubGlobal("fetch", fetchMock);
  await expect(generateRetrievedCatalogAnswer(input)).rejects.toThrow("RAG provider unavailable");
  expect(fetchMock).toHaveBeenCalledOnce();
});
it("stops after both providers fail", async () => {
  const fetchMock = vi.fn().mockImplementation(async () => new Response("{}", { status: 429 })); vi.stubGlobal("fetch", fetchMock);
  await expect(generateRetrievedCatalogAnswer(input)).rejects.toThrow("RAG provider unavailable");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it.each([429, 503])("retains HTTP %s for diagnostics when Groq is the primary", async status => {
  vi.stubEnv("RAG_CHAT_PROVIDER", "groq");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private response", { status })));
  await expect(generateRetrievedCatalogAnswer(input)).rejects.toMatchObject({ upstreamStatus: status, failure: "http" });
});
it("never redirects local embeddings to Groq", async () => {
  vi.stubEnv("RAG_EMBEDDING_PROVIDER", "ollama"); vi.stubEnv("RAG_EMBEDDING_BASE_URL", "http://localhost:11434"); vi.stubEnv("RAG_EMBEDDING_MODEL", "bge-m3");
  const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 503 })); vi.stubGlobal("fetch", fetchMock);
  await expect(embedTexts(["bulong"])).rejects.toThrow("RAG provider unavailable");
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:11434/api/embed");
});
