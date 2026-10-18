export const EMBEDDING_DIMENSIONS = 1024;

const QUERY_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "requests", "unresolvedFields"],
  properties: {
    intent: { type: "string", enum: ["price_lookup", "catalog_list", "product_info", "advice", "comparison", "multi_intent", "clarification", "out_of_domain"] },
    requests: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["intent", "specifications", "requestedFields", "constraints"],
        properties: {
          intent: { type: "string", enum: ["price_lookup", "catalog_list", "product_info", "advice", "comparison"] },
          productText: { type: "string" },
          categoryText: { type: "string" },
          material: { type: "string" },
          specifications: { type: "array", maxItems: 12, items: { type: "string" } },
          requestedFields: { type: "array", maxItems: 8, items: { type: "string", enum: ["price", "unit", "variants", "products", "facts", "source", "suitability"] } },
          priceTier: { type: "string", enum: ["retail", "wholesale", "dealer"] },
          requestedQuantity: {
            type: "object",
            additionalProperties: false,
            required: ["amount"],
            properties: { amount: { type: "number", exclusiveMinimum: 0, maximum: 1_000_000 }, unit: { type: "string" } },
          },
          constraints: { type: "array", maxItems: 12, items: { type: "string" } },
          previousReference: { type: "string" },
        },
      },
    },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    unresolvedFields: { type: "array", maxItems: 12, items: { type: "string" } },
    clarificationQuestion: { type: "string" },
  },
} as const;

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

export async function generateQueryPlanText(input: { question: string; context?: string[] }): Promise<string> {
  const selectedChatModel = chatModel();
  const useOllama = provider() === "ollama";
  const endpoint = useOllama ? `${ollamaRoot()}/api/chat` : `${baseUrl()}/chat/completions`;
  const response = await providerFetch(endpoint, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: selectedChatModel,
      ...(useOllama
        ? { keep_alive: ollamaKeepAlive(), stream: false, format: QUERY_PLAN_JSON_SCHEMA, options: { temperature: 0 } }
        : { temperature: 0, response_format: { type: "json_object" } }),
      messages: [
        {
          role: "system",
          content: "Phân tích câu hỏi vật tư bằng tiếng Việt. Chỉ phân loại ý định và trích xuất tên/quy cách/điều kiện mà người dùng đã nói. Không trả lời câu hỏi, không tạo giá, số tiền, đơn vị, ID, nguồn hay thao tác truy cập dữ liệu. Trong danh mục, mỗi dòng product_variants là một quy cách của mặt hàng cha trong products; hỏi 'có quy cách gì/nào' nghĩa là liệt kê các biến thể product_variants phù hợp, dùng intent catalog_list và requestedFields gồm variants. Khi người dùng hỏi cửa hàng có những sản phẩm/mặt hàng nào về một chủng loại, liệt kê các nhóm products phù hợp với requestedFields gồm products; không nhầm câu hỏi về nhóm sản phẩm với câu hỏi liệt kê mọi quy cách. Giữ nguyên mọi kích thước người dùng nêu trong specifications. Kích thước một chiều như '8 ly' hoặc '8 mm' phải lọc theo một phần kích thước của quy cách ghép, ví dụ 8x60 và 8x100; không được bỏ bộ lọc đó. Không hỏi làm rõ chỉ vì các kích thước khác xuất hiện trong kết quả rộng. Chỉ yêu cầu làm rõ nếu thiếu tên mặt hàng hoặc sau khi áp dụng các bộ lọc tường minh vẫn còn nhiều nhóm mặt hàng khác nhau. Chỉ xuất một JSON object theo schema được yêu cầu; không gọi công cụ. The root object must include intent and requests; include unresolvedFields as an empty array when none apply. The model may omit confidence; its absence must not be replaced with a guess. Every request must include intent, specifications, requestedFields, and constraints, using empty arrays when none apply. The top-level intent and each request intent must be valid enum values.",
        },
        {
          role: "user",
          content: JSON.stringify({
            question: input.question,
            prior_context: input.context ?? [],
            schema: {
              intent: "price_lookup|catalog_list|product_info|advice|comparison|multi_intent|clarification|out_of_domain",
              requests: [{
                intent: "price_lookup|catalog_list|product_info|advice|comparison",
                productText: "optional string",
                categoryText: "optional category phrase exactly as stated by the user",
                material: "optional explicitly stated material",
                specifications: ["explicit specification strings"],
                requestedFields: ["price|unit|variants|products|facts|source|suitability"],
                priceTier: "optional retail|wholesale|dealer",
                requestedQuantity: { amount: "optional positive number", unit: "optional user-stated unit" },
                constraints: ["user-stated advice/comparison constraints"],
                previousReference: "optional phrase referring to an earlier result; never an ID",
              }],
              confidence: "number from 0 to 1",
              unresolvedFields: ["optional product/specification/constraint still missing"],
              clarificationQuestion: "optional concise question in Vietnamese",
            },
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(await readError(response));
  const body = await response.json() as ChatResponse & OllamaChatResponse;
  const content = useOllama ? body.message?.content : body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("LLM did not return a query plan.");
  return content.trim();
}

export async function generateGroundedResponseText(input: {
  question: string;
  plan: unknown;
  evidence: Array<{ id: string; kind: "catalog" | "price" | "document"; summary: string }>;
}): Promise<string> {
  const selectedChatModel = chatModel();
  const useOllama = provider() === "ollama";
  const endpoint = useOllama ? `${ollamaRoot()}/api/chat` : `${baseUrl()}/chat/completions`;
  const response = await providerFetch(endpoint, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      model: selectedChatModel,
      ...(useOllama
        ? { keep_alive: ollamaKeepAlive(), stream: false, format: "json", options: { temperature: 0 } }
        : { temperature: 0, response_format: { type: "json_object" } }),
      messages: [
        {
          role: "system",
          content: [
            "Bạn là nhân viên tư vấn vật tư tận tình, hỗ trợ nhân viên cửa hàng và khách hàng bằng tiếng Việt.",
            "Trả lời chủ động, rõ ràng và dễ làm theo; giải thích điều đã có căn cứ, không chỉ nhận xét chung chung.",
            "Khi câu hỏi còn mơ hồ hoặc thiếu chi tiết, hãy nêu rõ thông tin còn thiếu, hỏi một câu ngắn và gợi ý tối đa 3 cách viết lại câu hỏi để người dùng tra cứu chính xác hơn.",
            "Mỗi gợi ý phải dựa hoàn toàn trên question, plan và evidence đã cung cấp; chỉ dùng tên mặt hàng và quy cách có trong bằng chứng.",
            "Nếu gợi ý có số đo, chép nguyên vẹn chuỗi quy cách từ catalog evidence, không đổi đơn vị, thêm số hay rút ngắn; đặt chuỗi quy cách nguyên văn riêng trên một dòng để vượt kiểm tra số liệu.",
            "Không nêu giá, nguồn, số trang, URL hoặc thao tác đơn hàng. Giá chuẩn do ứng dụng đọc riêng từ SQL.",
            "Chỉ trả một JSON object theo schema. Mỗi khẳng định phải gắn evidenceIds có trong gói bằng chứng.",
            "Quy cách, số đo và đơn vị chỉ được trích nguyên mệnh đề có trong bằng chứng catalog đã dẫn; không suy diễn số liệu.",
            "Nếu chưa đủ căn cứ, tạo block clarification với câu hỏi và gợi ý cụ thể; nếu đủ căn cứ, trả lời trực tiếp phần đã xác minh.",
            "Các loại block hợp lệ: narrative, clarification, comparison, recommendation. Không thêm trường ngoài schema.",
          ].join(" "),
        },
        {
          role: "system",
          content: "For comparison and recommendation blocks, cite a verified document entry for every variant ID. Compare or recommend only when each cited document explicitly supports every requested comparison dimension or use constraint. If the evidence is missing, return a clarification block. Never infer that an undocumented property is equal, safe, compatible, stronger, or better.",
        },
        {
          role: "user",
          content: JSON.stringify({
            question: input.question,
            plan: input.plan,
            evidence: input.evidence.map(({ id, kind, summary }) => ({ id, kind, summary: summary.slice(0, 500) })),
            schema: {
              blocks: [{
                kind: "narrative|clarification|comparison|recommendation",
                text: "short Vietnamese text; no prices, page numbers or generated identifiers; numeric facts must copy a complete cited catalog clause",
                evidenceIds: ["IDs copied exactly from evidence"],
                unresolvedFields: ["only for clarification"],
                variantIds: ["only IDs explicitly present in catalog evidence"],
              }],
            },
          }),
        },
      ],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(await readError(response));
  const body = await response.json() as ChatResponse & OllamaChatResponse;
  const content = useOllama ? body.message?.content : body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("LLM did not return grounded response blocks.");
  return content.trim();
}
