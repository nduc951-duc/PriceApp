export const EMBEDDING_DIMENSIONS = 1024;

type OpenAIEmbeddingResponse = { data?: Array<{ index?: number; embedding?: unknown }> };
type OllamaEmbeddingResponse = { embeddings?: unknown };
type ChatResponse = { choices?: Array<{ message?: { content?: unknown } }> };
type OllamaChatResponse = { message?: { content?: unknown } };
function provider() { return process.env.RAG_AI_PROVIDER?.trim().toLowerCase() || "ollama"; }
function baseUrl() {
  const value = process.env.RAG_AI_BASE_URL?.trim();
  if (!value) throw new Error("RAG_AI_BASE_URL chưa được cấu hình.");
  return value.replace(/\/+$/, "");
}
function ollamaRoot() { return baseUrl().replace(/\/v1$/i, ""); }
function headers() {
  const result: Record<string, string> = { "Content-Type": "application/json" };
  const key = process.env.RAG_AI_API_KEY?.trim();
  if (key) result.Authorization = `Bearer ${key}`;
  return result;
}
function model(env: string) {
  const value = process.env[env]?.trim();
  if (!value) throw new Error(`${env} chưa được cấu hình.`);
  return value;
}
function ollamaKeepAlive() { return process.env.RAG_OLLAMA_KEEP_ALIVE?.trim() || "15m"; }
async function readError(response: Response) {
  return `AI provider trả lỗi HTTP ${response.status}`;
}
export class RagProviderUnavailableError extends Error {
  constructor() {
    super("RAG provider unavailable");
    this.name = "RagProviderUnavailableError";
  }
}
async function providerFetch(input: string, init: Parameters<typeof fetch>[1]): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (error instanceof TypeError || name === "AbortError" || name === "TimeoutError") {
      throw new RagProviderUnavailableError();
    }
    throw error;
  }
  if (response.status === 429 || response.status >= 500) throw new RagProviderUnavailableError();
  return response;
}
function validateVectors(value: unknown, expected: number): number[][] {
  if (!Array.isArray(value) || value.length !== expected) throw new Error("Embedding provider trả về sai số vector.");
  return value.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== EMBEDDING_DIMENSIONS || entry.some((n) => typeof n !== "number" || !Number.isFinite(n))) {
      throw new Error(`Embedding phải có đúng ${EMBEDDING_DIMENSIONS} số hữu hạn. Chọn model embedding 1.024 chiều.`);
    }
    return entry as number[];
  });
}
export function embeddingModel() { return model("RAG_EMBEDDING_MODEL"); }
export function chatModel() { return model("RAG_CHAT_MODEL"); }
export function providerName() { return provider(); }
export async function embeddingFingerprint() {
  let artifact = process.env.RAG_EMBEDDING_ARTIFACT?.trim();
  if (provider() === "ollama") {
    const response = await providerFetch(`${ollamaRoot()}/api/tags`, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error("Không đọc được thông tin model Ollama.");
    const body = await response.json() as { models?: Array<{ name: string; digest: string }> };
    artifact = body.models?.find((item) => item.name === embeddingModel() || item.name === `${embeddingModel()}:latest`)?.digest;
  }
  if (!artifact) throw new Error("Chưa xác định được artifact của embedding model.");
  return [provider(), embeddingModel(), artifact, EMBEDDING_DIMENSIONS].join(":");
}

export function normalizeIndexedEmbeddings(data: OpenAIEmbeddingResponse["data"], expected: number): number[][] {
  if (!Array.isArray(data) || data.length !== expected) throw new Error("Embedding provider trả về sai số vector.");
  const ordered: unknown[] = Array(expected);
  for (const item of data) {
    if (!Number.isInteger(item.index) || item.index! < 0 || item.index! >= expected || ordered[item.index!] !== undefined) {
      throw new Error("Embedding provider trả về index không hợp lệ.");
    }
    ordered[item.index!] = item.embedding;
  }
  return validateVectors(ordered, expected);
}

export async function embedTexts(input: string[]): Promise<number[][]> {
  if (!input.length) return [];
  if (provider() === "ollama") {
    const response = await providerFetch(`${ollamaRoot()}/api/embed`, {
      method: "POST", headers: headers(), body: JSON.stringify({ model: embeddingModel(), input, keep_alive: ollamaKeepAlive() }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) throw new Error(await readError(response));
    const body = await response.json() as OllamaEmbeddingResponse;
    return validateVectors(body.embeddings, input.length);
  }
  const response = await providerFetch(`${baseUrl()}/embeddings`, {
    method: "POST", headers: headers(),
    body: JSON.stringify({ model: embeddingModel(), input, dimensions: EMBEDDING_DIMENSIONS }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(await readError(response));
  const body = await response.json() as OpenAIEmbeddingResponse;
  return normalizeIndexedEmbeddings(body.data, input.length);
}

export async function generateGroundedAnswer(input: {
  question: string;
  evidence: Array<{ content: string; page: number | null; similarity?: number; prices?: unknown[] }>;
}): Promise<string> {
  const selectedChatModel = chatModel();
  const evidence = input.evidence.map((item, index) => ({
    id: index + 1, page: item.page, content: item.content, current_prices_from_sql: item.prices ?? [],
  }));
  const useOllama = provider() === "ollama";
  const endpoint = useOllama ? `${ollamaRoot()}/api/chat` : `${baseUrl()}/chat/completions`;
  const response = await providerFetch(endpoint, {
    method: "POST", headers: headers(),
    body: JSON.stringify({
      model: selectedChatModel,
      ...(useOllama
        ? { keep_alive: ollamaKeepAlive(), stream: false, options: { temperature: 0.1 } }
        : { temperature: 0.1 }),
      messages: [
        { role: "system", content: "Bạn là trợ lý tra cứu giá vật tư bằng tiếng Việt. Chỉ dùng bằng chứng được cung cấp. Giá trong current_prices_from_sql là dữ liệu chuẩn; không tự tính, sửa, nội suy hoặc bịa giá. Nếu không có giá phù hợp, nói rõ chưa có dữ liệu. Phân biệt giá đã xác minh và giá cần đối chiếu. Không tự tạo số trang; chỉ trích dẫn [Trang N] khi N có trong page. Trả lời ngắn gọn, nêu quy cách, loại giá, đơn vị/số lượng tối thiểu nếu có." },
        { role: "user", content: JSON.stringify({ question: input.question, evidence }) },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(await readError(response));
  const body = await response.json() as ChatResponse & OllamaChatResponse;
  const content = useOllama ? body.message?.content : body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("LLM không trả về nội dung câu trả lời.");
  return content.trim();
}
