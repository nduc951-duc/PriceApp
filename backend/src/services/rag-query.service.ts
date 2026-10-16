import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";
import { ragChunksRepository } from "../repositories/rag-chunks.repository.js";
import { ragPagesRepository } from "../repositories/rag-pages.repository.js";
import { ragCatalogRepository } from "../repositories/rag-catalog.repository.js";
import { embedTexts, embeddingModel, generateGroundedAnswer, RagProviderUnavailableError } from "../rag/provider.js";
import { rankVariantIds } from "../rag/rank.js";
import { priceAnswer } from "../rag/price-answer.js";
import { resolveFollowUpQuestion, understandQuery, toHardFilters } from "../rag/query-understanding.js";
import { matchesExplicitPackage, matchesExplicitQuery } from "../rag/candidate-filters.js";
import { buildCitations } from "../rag/citations.js";


type Match = { id: number; chunk_key: string; source_page_id: number; source_revision: number | null; source_start: number | null; source_end: number | null; product_variant_id: number | null; content: string; metadata: Record<string, unknown>; similarity: number };
type PriceRow = { id: number; version: number; amount: number | string; price_type: string; minimum_quantity: number | string; active: boolean; valid_from: string; valid_to: string | null; price_lists: { name: string; effective_date: string; suppliers: { name: string } | null } | null };
type CatalogRow = {
  id: number; display_name: string; raw_specification: string | null; verification_status: string;
  products: { name: string; categories: { name: string } | null; product_aliases: { alias: string }[] | null } | null;
  packaging_options: { id: number; name: string; quantity: number | string; base_unit: string; note: string | null; prices: PriceRow[] }[];
};
type EligibleSource = { product_variant_id: number; source_page_id: number; page_number: number | null };

export async function queryRag(body: unknown, client: SupabaseClient, context: { previousQuestion?: string } = {}) {
  const chunksRepo = ragChunksRepository(client);
  const pagesRepo = ragPagesRepository(client);
  const catalogRepo = ragCatalogRepository(client);
  const input = (typeof body === "object" && body !== null ? body : {}) as { question?: unknown };
  const originalQuestion = typeof input.question === "string" ? input.question.trim() : "";
  if (!originalQuestion || originalQuestion.length > 1000) throw new ApiError(400, "INVALID_INPUT", "Nhập câu hỏi từ 1 đến 1.000 ký tự.");
  const question = resolveFollowUpQuestion(context.previousQuestion, originalQuestion);
  const understood = understandQuery(question);
  const hardFilters = toHardFilters(understood);
  const lexicalQuery = [...understood.aliases, ...understood.nameTerms].join(" ") || question;
  if (understood.tierConflict) {
    return {
      status: "clarify" as const,
      clarification: "Chọn một loại giá",
      answer: "Bạn muốn xem giá sỉ, giá đại lý hay giá lẻ? Vui lòng chọn một loại giá để mình tra đúng mức.",
      items: [], sources: [], retrieval: { vectorChunks: 0, lexicalProducts: 0, embeddingModel: "not_used" },
    };
  }

  const model = embeddingModel();
  let queryVector: number[] | undefined;
  let lexicalResult: Awaited<ReturnType<typeof catalogRepo.search>>;
  try {
    const [vectors, lexical] = await Promise.all([embedTexts([question]), catalogRepo.search(lexicalQuery)]);
    [queryVector] = vectors;
    lexicalResult = lexical;
  }
  catch (error) { if (error instanceof RagProviderUnavailableError) throw new ApiError(503, "RAG_UNAVAILABLE", "Dịch vụ RAG tạm thời chưa sẵn sàng."); throw error; }
  if (!queryVector) throw new Error("Không tạo được embedding cho câu hỏi.");
  const vector = `[${queryVector.join(",")}]`;
  const { data: vectorData, error: vectorError } = await chunksRepo.match(vector, model);
  const { data: lexicalData, error: lexicalError } = lexicalResult;
  if (vectorError) throw new Error("RAG repository unavailable");
  if (lexicalError) throw new Error("RAG repository unavailable");
  let chunks = ((vectorData ?? []) as unknown as Match[]).filter((item) => item.similarity >= 0.20);
  let lexicalIds = ((lexicalData ?? []) as unknown as Array<{ id: number; result_type?: string; relevance?: number }>).filter((row) => row.result_type === "variant").map((row) => Number(row.id)).filter(Number.isFinite);
  const ids = rankVariantIds(chunks.map((chunk) => chunk.product_variant_id).filter((id): id is number => id !== null), lexicalIds);

  let catalog: CatalogRow[] = [];
  const eligiblePages = new Map<number, number[]>();
  const sourceIds = [...new Set(chunks.map((chunk) => chunk.source_page_id))];
  type SourcePageLookup = Pick<Awaited<ReturnType<typeof pagesRepo.numbers>>, "data" | "error">;
  const sourcePagesPromise: Promise<SourcePageLookup> = sourceIds.length ? Promise.resolve(pagesRepo.numbers(sourceIds)) : Promise.resolve({ data: [], error: null });
  let sourcePages: SourcePageLookup;
  if (ids.length) {
    const [{ data, error }, { data: sourceData, error: sourceError }, pageResult] = await Promise.all([
      catalogRepo.prices(ids),
      catalogRepo.currentSources(ids),
      sourcePagesPromise,
    ]);
    sourcePages = pageResult;
    if (error) throw new Error("RAG repository unavailable");
    if (sourceError) throw new Error("RAG repository unavailable");
    for (const source of (sourceData ?? []) as EligibleSource[]) {
      if (source.page_number === null) continue;
      eligiblePages.set(source.product_variant_id, [...(eligiblePages.get(source.product_variant_id) ?? []), source.page_number]);
    }
    catalog = ((data ?? []) as unknown as CatalogRow[]).filter((row) => eligiblePages.has(row.id));
    const order = new Map(ids.map((id, index) => [id, index]));
    catalog.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  } else sourcePages = await sourcePagesPromise;

  const now = Date.now();
  if (Object.keys(hardFilters).length > 0) {
    catalog = catalog.filter((row) => matchesExplicitQuery({
      productName: row.products?.name ?? row.display_name,
      variant: `${row.display_name} ${row.raw_specification ?? ""}`,
      packages: row.packaging_options.map((pack) => ({
        name: pack.name,
        unit: pack.base_unit,
        activeTiers: [...new Set(pack.prices.filter((price) => price.active && Date.parse(price.valid_from) <= now && (!price.valid_to || Date.parse(price.valid_to) >= now)).map((price) => price.price_type))] as Array<"retail" | "wholesale" | "dealer">,
      })),
    }, question));
    const allowed = new Set(catalog.map((row) => row.id));
    chunks = chunks.filter((chunk) => chunk.product_variant_id !== null && allowed.has(chunk.product_variant_id));
    lexicalIds = lexicalIds.filter((id) => allowed.has(id));
  }
  if (sourcePages.error) throw new Error(`Không tải được thông tin trang nguồn: ${sourcePages.error.message}`);
  const pageNumbers = new Map((sourcePages.data ?? []).map((page) => [page.id, page.page_number]));
  const items = catalog.map((row) => {
    const pages = [...new Set(eligiblePages.get(row.id) ?? [])];
    const prices = row.packaging_options.filter((pack) => matchesExplicitPackage({
      name: pack.name,
      unit: pack.base_unit,
      activeTiers: [...new Set(pack.prices.filter((price) => price.active && Date.parse(price.valid_from) <= now && (!price.valid_to || Date.parse(price.valid_to) >= now)).map((price) => price.price_type))] as Array<"retail" | "wholesale" | "dealer">,
    }, question)).flatMap((pack) => pack.prices
      .filter((price) => price.active && Date.parse(price.valid_from) <= now && (!price.valid_to || Date.parse(price.valid_to) >= now))
      .filter((price) => !understood.tier || price.price_type === understood.tier)
      .map((price) => ({
        id: price.id, packagingId: pack.id, version: Number(price.version), amount: Number(price.amount), priceType: price.price_type,
        minimumQuantity: Number(price.minimum_quantity), packagingName: pack.name,
        packageQuantity: Number(pack.quantity), unit: pack.base_unit, packageNote: pack.note ?? "",
        priceList: price.price_lists?.name ?? null, supplier: price.price_lists?.suppliers?.name ?? null,
        verificationStatus: row.verification_status,
      })));
    return { id: row.id, productName: row.products?.name ?? row.display_name, category: row.products?.categories?.name ?? "Vật tư", variant: row.raw_specification ?? row.display_name, verificationStatus: row.verification_status, sourcePages: pages, prices };
  });

  const evidence = [
    ...catalog.slice(0, 8).map((row) => {
      const item = items.find((candidate) => candidate.id === row.id)!;
      const aliases = row.products?.product_aliases?.map((alias) => alias.alias).join(", ") ?? "";
      return { page: item.sourcePages[0] ?? null, content: `Sản phẩm: ${item.productName}; danh mục: ${item.category}; quy cách: ${item.variant}; tên gọi khác: ${aliases}; trạng thái: ${item.verificationStatus}.`, prices: item.prices };
    }),
    ...chunks.slice(0, 6).map((chunk) => ({ page: pageNumbers.get(chunk.source_page_id) ?? (typeof chunk.metadata.page_number === "number" ? chunk.metadata.page_number : null), content: chunk.content, similarity: chunk.similarity, prices: chunk.product_variant_id ? items.find((item) => item.id === chunk.product_variant_id)?.prices ?? [] : [] })),
  ];
  const uniqueEvidence = [...new Map(evidence.map((item) => [`${item.page ?? "?"}:${item.content}`, item])).values()];
  if (!uniqueEvidence.length) {
    return {
      status: "insufficient_evidence" as const,
      answer: "Mình chưa tìm thấy tài liệu hoặc mặt hàng đủ liên quan để trả lời. Hãy kiểm tra câu hỏi, trạng thái duyệt của tài liệu và việc lập chỉ mục embedding.",
      items: [], sources: [], retrieval: { vectorChunks: 0, lexicalProducts: 0, embeddingModel: model },
    };
  }
  const asksForPrice = /giá|bao nhiêu|báo giá|giá sỉ|giá lẻ|đồng|vnđ/i.test(question) && !/trang nào|nguồn nào|trích dẫn/i.test(question);
  const answer = asksForPrice
    ? priceAnswer(items)
    : await generateGroundedAnswer({ question, evidence: uniqueEvidence }).catch((error: unknown) => {
      if (error instanceof RagProviderUnavailableError) throw new ApiError(503, "RAG_UNAVAILABLE", "Dịch vụ RAG tạm thời chưa sẵn sàng.");
      throw error;
    });
  const sources = buildCitations(chunks.map((chunk) => ({
    pageNumber: pageNumbers.get(chunk.source_page_id) ?? (typeof chunk.metadata.page_number === "number" ? chunk.metadata.page_number : null),
    chunkId: chunk.id,
    chunkKey: chunk.chunk_key,
    sourceRevision: chunk.source_revision,
    sourceSpan: chunk.source_start !== null && chunk.source_end !== null ? { start: chunk.source_start, end: chunk.source_end } : null,
    excerpt: chunk.content,
    evidenceKind: chunk.metadata.kind === "approved_page_ocr" || chunk.metadata.kind === "verified_catalog" ? chunk.metadata.kind : null,
    verifiedVariantId: chunk.product_variant_id,
  })));
  const status = asksForPrice && !items.some((item) => item.prices.length > 0) ? "insufficient_evidence" : "answered";
  const trace = { question: originalQuestion, chunkIds: chunks.map((chunk) => chunk.id), variantIds: items.map((item) => item.id), priceIds: items.flatMap((item) => item.prices.map((price) => price.id)), answer };
  return { status, answer, items, sources, retrieval: { vectorChunks: chunks.length, lexicalProducts: lexicalIds.length, embeddingModel: model, trace } };
}
