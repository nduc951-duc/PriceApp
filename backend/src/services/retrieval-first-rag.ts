import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, type DependencyDiagnostics } from "../middleware/errors.js";
import { ragChunksRepository } from "../repositories/rag-chunks.repository.js";
import { ragCatalogRepository, type RagCatalogVariant, type CatalogPrice } from "../repositories/rag-catalog.repository.js";
import { embedTexts, embeddingModel, generateRetrievedCatalogAnswer } from "../rag/provider.js";
import { retrievedCatalogAnswerSchema, type RagHistoryMessage } from "../rag/retrieved-context.js";
import { buildCitations } from "../rag/citations.js";
import { priceAnswer } from "../rag/price-answer.js";

export type RagConversationContext = { previousQuestion?: string; previousVariantIds?: number[]; history?: RagHistoryMessage[] };
type Chunk = { id: number; product_variant_id: number; chunk_key: string; content: string; similarity: number;
  source_revision?: number | null; metadata: { kind?: string; page_number?: number | null } };
export function retrievalFirstEnabled() { return process.env.RAG_QUERY_MODE === "retrieval_first"; }
function unavailable(stage: DependencyDiagnostics["stage"], error?: unknown) {
  // Never retain raw provider/SQL messages, prompts, credentials or response bodies.
  const status = error instanceof Error ? Number(/HTTP (\d{3})\b/.exec(error.message)?.[1]) : NaN;
  const suppliedStatus = error && typeof error === "object" && "upstreamStatus" in error ? error.upstreamStatus : status;
  const upstreamStatus = typeof suppliedStatus === "number" && Number.isInteger(suppliedStatus) && suppliedStatus >= 400 && suppliedStatus <= 599 ? suppliedStatus : undefined;
  const reason = error && typeof error === "object" && "failure" in error ? error.failure : undefined;
  const failure: DependencyDiagnostics["failure"] = reason === "timeout" || reason === "network" ? reason : upstreamStatus ? "http" : "dependency";
  return new ApiError(503, "RAG_UNAVAILABLE", "Chưa truy xuất hoặc phân tích được dữ liệu RAG. Vui lòng thử lại.", { stage, failure, ...(upstreamStatus ? { upstreamStatus } : {}) });
}
async function dependency<T>(stage: DependencyDiagnostics["stage"], run: () => PromiseLike<T>): Promise<T> {
  try { return await run(); } catch (error) { throw unavailable(stage, error); }
}
const uniqueIds = (values: number[]) => [...new Set(values.filter(id => Number.isSafeInteger(id) && id > 0))];
const idBatches = (ids: number[]) => Array.from({ length: Math.ceil(ids.length / 8) }, (_, index) => ids.slice(index * 8, index * 8 + 8));
const validTier = (value: string): value is "retail" | "wholesale" | "dealer" => ["retail", "wholesale", "dealer"].includes(value);

function visiblePrices(row: RagCatalogVariant, publicOnly: boolean) {
  const now = Date.now();
  const active = (price: CatalogPrice) => price.active && price.price_lists?.suppliers?.active !== false
    && Date.parse(price.valid_from) <= now && (!price.valid_to || Date.parse(price.valid_to) > now);
  const hasReal = row.packaging_options.some(pack => pack.prices.some(p => active(p) && p.price_lists?.is_sample !== true));
  return row.packaging_options.map(pack => ({ ...pack, prices: pack.prices.filter(p => active(p) && validTier(p.price_type)
    && (!publicOnly || p.price_type !== "dealer") && (p.price_lists?.is_sample !== true || (p.price_lists.is_demo === true && !hasReal))) }));
}

/** Raw question -> semantic retrieval -> current SQL evidence -> one grounded model call.
 * No language-specific query planner, name matcher, stop-word list or intent branch. */
export async function queryRetrievalFirstRag(question: string, client: SupabaseClient, context: RagConversationContext = {}, publicOnly = false) {
  if (!question.trim() || question.length > 1000) throw new ApiError(400, "INVALID_INPUT", "Câu hỏi phải có từ 1 đến 1000 ký tự.");
  const history: RagHistoryMessage[] = (context.history ?? (context.previousQuestion ? [{ role: "user" as const, content: context.previousQuestion }] : []))
    .filter(message => ["user", "assistant"].includes(message.role) && typeof message.content === "string").slice(-6)
    .map(message => ({ role: message.role, content: message.content.slice(0, 1000) }));
  const previousVariantIds = uniqueIds(context.previousVariantIds ?? []).slice(0, 40);
  const lastQuestion = [...history].reverse().find(message => message.role === "user")?.content;
  const queries = lastQuestion ? [question, `${lastQuestion}\n${question}`] : [question];
  const repo = ragCatalogRepository(client, publicOnly);
  const model = embeddingModel();
  let chunks: Chunk[];
  const vectors = await dependency("embedding", () => embedTexts(queries));
  {
    const results = await dependency("vector_search", () => Promise.all(vectors.map(vector => ragChunksRepository(client, publicOnly).match(`[${vector.join(",")}]`, model))));
    const failed = results.find(result => result.error);
    if (failed) throw unavailable("vector_search", failed.error);
    chunks = [...new Map(results.flatMap(result => (result.data ?? []) as Chunk[])
      .filter(chunk => chunk.metadata?.kind === "verified_catalog" && Number.isSafeInteger(chunk.product_variant_id) && chunk.similarity >= 0.2)
      .map(chunk => [chunk.id, chunk])).values()].slice(0, 16);
  }
  const empty = (status: "clarify" | "insufficient_evidence", answer: string) => ({ status, answer, items: [], sources: [],
    retrieval: { vectorChunks: chunks.length, lexicalProducts: 0, embeddingModel: model,
      trace: { question, chunkIds: chunks.map(chunk => chunk.id), variantIds: [] as number[], priceIds: [] as number[], answer } } });
  const seedIds = uniqueIds([...chunks.map(chunk => chunk.product_variant_id), ...previousVariantIds]);
  if (!seedIds.length) return empty("insufficient_evidence", "Chưa tìm được dữ liệu đã xác minh phù hợp trong catalog. Bạn cho mình thêm thông tin mặt hàng nhé.");
  const expanded = await dependency("catalog", () => Promise.all(idBatches(seedIds).map(batch => repo.expandVerifiedGroups(batch))));
  const failedExpansion = expanded.find(result => result.error);
  if (failedExpansion) throw unavailable("catalog", failedExpansion.error);
  const allRows = [...new Map(expanded.flatMap(result => result.data ?? []).filter(row => row.verification_status === "verified").map(row => [row.id, row])).values()];
  // Protect context/token limits; report incompleteness instead of silently claiming a full list.
  const configuredLimit = Number(process.env.RAG_CONTEXT_MAX_VARIANTS ?? 200);
  const contextLimit = Number.isInteger(configuredLimit) && configuredLimit > 0 && configuredLimit <= 200 ? configuredLimit : 200;
  const truncated = allRows.length > contextLimit;
  // Preserve directly retrieved/referenced variants before filling the remaining
  // context with siblings. Mark any partial catalog explicitly for the model/UI.
  const seedRows = seedIds.flatMap(id => allRows.filter(row => row.id === id));
  const candidates = truncated ? [...new Map([...seedRows, ...allRows].map(row => [row.id, row])).values()] : allRows;
  const rows = candidates.slice(0, contextLimit);
  const rowMap = new Map(rows.map(row => [row.id, row]));
  chunks = chunks.filter(chunk => rowMap.has(chunk.product_variant_id));
  if (!rows.length) return empty("insufficient_evidence", "Các dữ liệu tìm được chưa có mặt hàng đã xác minh còn khả dụng trong catalog.");
  const catalog = rows.map(row => ({ id: row.id, productId: row.product_id, productName: row.products?.name ?? row.display_name,
    category: row.products?.categories?.name ?? "", specification: row.raw_specification ?? row.display_name,
    description: row.products?.description ?? "", attributes: row.attributes ?? {},
    packages: visiblePrices(row, publicOnly).map(pack => ({ id: pack.id, name: pack.name, quantity: Number(pack.quantity), unit: pack.base_unit,
      prices: pack.prices.map(p => ({ id: p.id, amount: Number(p.amount), type: p.price_type, minimumQuantity: Number(p.minimum_quantity) })) })) }));
  // Vector text may lag behind catalog edits. Its IDs and similarity locate
  // rows; only current, permission-filtered SQL supplies factual content.
  const catalogById = new Map(catalog.map(row => [row.id, row]));
  const currentChunks = chunks.map(chunk => ({ id: chunk.id, variantId: chunk.product_variant_id,
    content: JSON.stringify({ provenance: "current_sql", ...catalogById.get(chunk.product_variant_id)! }), similarity: chunk.similarity }));
  const raw = await dependency("generation", () => generateRetrievedCatalogAnswer({ question, history, previousVariantIds,
    chunks: currentChunks, catalog, truncated }));
  const reject = () => empty("clarify", "Câu trả lời AI chưa đối chiếu được đầy đủ với dữ liệu. Bạn thử hỏi lại hoặc chọn một mặt hàng cụ thể nhé.");
  let decoded: unknown;
  try { decoded = JSON.parse(raw); } catch { return reject(); }
  const parsed = retrievedCatalogAnswerSchema.safeParse(decoded);
  if (!parsed.success) return reject();
  const reply = parsed.data;
  const monetaryProse = /₫|\d[\d.,\s]*(?:đồng|vn[dđ]|usd|đ)(?!\p{L})/iu.test(reply.answer);
  const priceOwners = new Map(catalog.flatMap(row => row.packages.flatMap(pack => pack.prices.map(p => [p.id, row.id] as const))));
  const allowedEvidence = new Set([...chunks.map(chunk => `chunk:${chunk.id}`), ...rows.map(row => `variant:${row.id}`), ...[...priceOwners.keys()].map(id => `price:${id}`)]);
  if (reply.selectedVariantIds.some(id => !rowMap.has(id)) || reply.selectedPriceIds.some(id => !priceOwners.has(id) || !reply.selectedVariantIds.includes(priceOwners.get(id)!))
    || reply.listedProductIds.some(id => !rows.some(row => row.product_id === id)) || reply.evidenceIds.some(id => !allowedEvidence.has(id))
    || (reply.status === "answered" && !reply.evidenceIds.length)
    || (monetaryProse && (reply.status !== "answered" || reply.listingMode === "products" || !reply.selectedPriceIds.length))) return reject();
  if (reply.status !== "answered") return empty(reply.status, reply.answer);
  const listedRows = reply.listingMode === "products" ? rows.filter(row => reply.listedProductIds.includes(row.product_id)) : [];
  const selectedIds = uniqueIds(reply.selectedVariantIds);
  let fresh: RagCatalogVariant[] = [];
  if (selectedIds.length) {
    const current = await dependency("prices", () => Promise.all(idBatches(selectedIds).map(batch => repo.prices(batch))));
    const failedPrices = current.find(result => result.error);
    if (failedPrices) throw unavailable("prices", failedPrices.error);
    fresh = [...new Map(current.flatMap(result => (result.data ?? []) as unknown as RagCatalogVariant[])
      .filter(row => row.verification_status === "verified" && selectedIds.includes(row.id)).map(row => [row.id, row])).values()];
    if (fresh.length !== selectedIds.length) return reject();
  }
  const items = selectedIds.map(id => fresh.find(row => row.id === id)!).map(row => ({ id: row.id, productName: row.products?.name ?? row.display_name,
    category: row.products?.categories?.name ?? "Vật tư", variant: row.raw_specification ?? row.display_name, verificationStatus: row.verification_status,
    sourcePages: row.source_pages ?? rowMap.get(row.id)?.source_pages ?? [],
    prices: visiblePrices(row, publicOnly).flatMap(pack => pack.prices.filter(p => reply.selectedPriceIds.includes(p.id)).map(p => ({
      id: p.id, packagingId: pack.id, version: Number(p.version), amount: Number(p.amount), priceType: p.price_type as "retail" | "wholesale" | "dealer",
      minimumQuantity: Number(p.minimum_quantity), packagingName: pack.name, packageQuantity: Number(pack.quantity), unit: pack.base_unit,
      packageNote: pack.note ?? "", priceList: p.price_lists?.name ?? null, supplier: p.price_lists?.suppliers?.name ?? null,
      isDemo: p.price_lists?.is_demo === true, purchasable: true, verificationStatus: row.verification_status,
    }))) }));
  if (reply.selectedPriceIds.some(id => !items.some(item => item.prices.some(price => price.id === id)))) return reject();
  const groups = [...new Set(listedRows.map(row => row.product_id))].map(id => {
    const members = listedRows.filter(row => row.product_id === id);
    return `• ${members[0]!.products?.name ?? members[0]!.display_name}: ${members.length} quy cách${truncated ? " trong phần đã tải" : ""}`;
  }).join("\n");
  // Price prose is untrusted even when its amounts happen to match SQL. Keep
  // only the canonical fresh-SQL rendering after all price/owner checks pass.
  const answer = [monetaryProse ? "" : reply.answer, groups, reply.selectedPriceIds.length ? priceAnswer(items) : ""].filter(Boolean).join("\n");
  const sources = buildCitations(currentChunks.filter(chunk => reply.evidenceIds.includes(`chunk:${chunk.id}`)).map(chunk => ({
    chunkId: chunk.id, chunkKey: `current_sql:variant:${chunk.variantId}`, pageNumber: null, excerpt: chunk.content,
    evidenceKind: "verified_catalog" as const, verifiedVariantId: chunk.variantId, sourceRevision: null,
  })));
  const variantIds = listedRows.length ? listedRows.map(row => row.id) : selectedIds;
  return { status: "answered" as const, answer, items: reply.listingMode === "products" ? [] : items, sources,
    // Expanding retrieved parents cannot establish exhaustive semantic coverage.
    ...(reply.listingMode !== "none" ? { catalogPage: { total: variantIds.length, complete: false, nextCursor: null } } : {}),
    retrieval: { vectorChunks: chunks.length, lexicalProducts: rows.length, embeddingModel: model,
      trace: { question, chunkIds: chunks.map(chunk => chunk.id), variantIds, priceIds: items.flatMap(item => item.prices.map(price => price.id)), answer } } };
}
