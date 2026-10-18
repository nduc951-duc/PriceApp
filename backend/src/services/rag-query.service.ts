import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";
import { ragChunksRepository } from "../repositories/rag-chunks.repository.js";
import { ragPagesRepository } from "../repositories/rag-pages.repository.js";
import { ragCatalogRepository, type RagCatalogVariant } from "../repositories/rag-catalog.repository.js";
import { embedTexts, embeddingModel, generateGroundedResponseText, RagProviderUnavailableError } from "../rag/provider.js";
import { buildEvidencePacket } from "../rag/evidence.js";
import { hasRequiredResponseKinds, validateGroundedResponse, type GroundedResponse } from "../rag/grounded-response.js";
import { rankVariantIds } from "../rag/rank.js";
import { priceAnswer, variantListAnswer } from "../rag/price-answer.js";
import { isVariantListIntent } from "../rag/variant-list-intent.js";
import { catalogIdentityQuestion, resolveFollowUpQuestion, specificPriceLookupHint, understandQuery, toHardFilters } from "../rag/query-understanding.js";
import { comparisonTargets, matchesExplicitPackage, matchesExplicitQuery, matchesNamedCandidate } from "../rag/candidate-filters.js";
import { buildCitations } from "../rag/citations.js";
import { planRagQuery, type RagQueryPlan, type RagQueryRequest } from "../rag/query-plan.js";
import { resolveVariantReference } from "../rag/variant-reference.js";
import { catalogSpecificationMeaning } from "../rag/catalog-specification.js";


type Match = { id: number; chunk_key: string; source_page_id: number | null; source_revision: number | null; source_start: number | null; source_end: number | null; product_variant_id: number | null; content: string; metadata: Record<string, unknown>; similarity: number };
type PriceRow = { id: number; version: number; amount: number | string; price_type: string; minimum_quantity: number | string; active: boolean; valid_from: string; valid_to: string | null; price_lists: { name: string; effective_date: string; is_sample?: boolean; is_demo?: boolean; suppliers: { name: string; active?: boolean } | null } | null };
type CatalogRow = {
  id: number; product_id?: number; display_name: string; raw_specification: string | null; verification_status: string; attributes?: Record<string, unknown>;
  products: { name: string; description?: string | null; categories: { name: string } | null; product_aliases: { alias: string }[] | null } | null;
  source_pages?: number[];
  packaging_options: { id: number; name: string; quantity: number | string; base_unit: string; note: string | null; prices: PriceRow[] }[];
};
type EligibleSource = { product_variant_id: number; source_page_id: number; page_number: number | null };

function isCurrentPriceRow(price: PriceRow, now = Date.now()) {
  return price.active && Date.parse(price.valid_from) <= now && (!price.valid_to || Date.parse(price.valid_to) > now)
    && price.price_lists?.is_sample !== true && price.price_lists?.suppliers?.active !== false;
}

function isCurrentPriceForMatching(price: PriceRow, now = Date.now()) {
  return price.active && Date.parse(price.valid_from) <= now && (!price.valid_to || Date.parse(price.valid_to) > now)
    && price.price_lists?.suppliers?.active !== false
    && (price.price_lists?.is_sample !== true || price.price_lists.is_demo === true);
}

function isCatalogPriceVisible(row: CatalogRow, price: PriceRow, now = Date.now()) {
  const current = price.active && Date.parse(price.valid_from) <= now && (!price.valid_to || Date.parse(price.valid_to) > now)
    && price.price_lists?.suppliers?.active !== false;
  if (!current) return false;
  if (price.price_lists?.is_sample !== true) return true;
  if (price.price_lists.is_demo !== true) return false;
  const hasRealPrice = row.packaging_options.some(pack => pack.prices.some(candidate => isCurrentPriceRow(candidate, now)));
  return !hasRealPrice;
}

function safeClarification(answer: string) {
  return {
    status: "clarify" as const,
    clarification: answer,
    answer,
    items: [],
    sources: [],
    retrieval: { vectorChunks: 0, lexicalProducts: 0, embeddingModel: "not_used" },
  };
}

type VerifiedCatalogProductGroup = {
  productId: number;
  name: string;
  variants: RagCatalogVariant[];
  specifications: string[];
  diameters: number[];
};

function verifiedCatalogProductGroups(rows: RagCatalogVariant[]): VerifiedCatalogProductGroup[] {
  const groups = new Map<number, VerifiedCatalogProductGroup>();
  for (const row of rows) {
    if (typeof row.product_id !== "number") continue;
    const group = groups.get(row.product_id) ?? {
      productId: row.product_id,
      name: row.products?.name ?? row.display_name,
      variants: [],
      specifications: [],
      diameters: [],
    };
    group.variants.push(row);
    const specification = (row.raw_specification ?? row.display_name).trim();
    if (specification && !group.specifications.includes(specification)) group.specifications.push(specification);
    const dimension = /^\s*(\d+(?:[.,]\d+)?)\s*(?:ly\b|li\b|mm\b|[x×])/iu.exec(specification);
    if (dimension?.[1]) {
      const diameter = Number(dimension[1].replace(",", "."));
      if (Number.isFinite(diameter) && !group.diameters.includes(diameter)) group.diameters.push(diameter);
    }
    groups.set(row.product_id, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    diameters: group.diameters.sort((left, right) => left - right),
    specifications: group.specifications.sort((left, right) => left.localeCompare(right, "vi")),
  })).sort((left, right) => left.name.localeCompare(right.name, "vi"));
}

function suggestedCatalogQuestions(groups: VerifiedCatalogProductGroup[], asksForPrice: boolean): string[] {
  const suggestions: string[] = [];
  for (const group of groups) {
    const diameters = group.diameters.length ? group.diameters : [null];
    for (const diameter of diameters) {
      const productText = `${group.name}${diameter === null ? "" : ` ${new Intl.NumberFormat("vi-VN").format(diameter)} ly`}`;
      suggestions.push(asksForPrice
        ? `Giá ${productText} là bao nhiêu?`
        : `${productText} có những quy cách nào?`);
      if (suggestions.length === 3) return suggestions;
    }
  }
  return suggestions;
}

function guidedCatalogClarification(rows: RagCatalogVariant[], question: string, asksForPrice: boolean) {
  const groups = verifiedCatalogProductGroups(rows);
  const visibleGroups = groups.slice(0, 6);
  const groupLines = visibleGroups.map((group) => {
    const options = group.diameters.length
      ? `cỡ tìm thấy: ${group.diameters.slice(0, 8).map((value) => `${new Intl.NumberFormat("vi-VN").format(value)} ly`).join(", ")}${group.diameters.length > 8 ? ", …" : ""}`
      : `ví dụ quy cách: ${group.specifications.slice(0, 4).join(", ")}`;
    return `• ${group.name}: ${group.variants.length} quy cách; ${options}`;
  });
  const suggestions = suggestedCatalogQuestions(groups, asksForPrice);
  const answer = [
    `Mình tìm thấy ${groups.length} nhóm mặt hàng phù hợp trong danh mục đã xác minh:`,
    ...groupLines,
    ...(groups.length > visibleGroups.length ? [`Còn ${groups.length - visibleGroups.length} nhóm khác.`] : []),
    "Để tra chính xác hơn, hãy thêm tên nhóm và cỡ vào câu hỏi. Bạn có thể hỏi như:",
    ...suggestions.map((suggestion) => `• “${suggestion}”`),
  ].join("\n");
  const result = safeClarification(answer);
  return {
    ...result,
    retrieval: {
      ...result.retrieval,
      lexicalProducts: groups.length,
      trace: { question, chunkIds: [], variantIds: rows.map((row) => row.id), priceIds: [], answer },
    },
  };
}

async function queryCompleteCatalogList(
  catalogRepo: ReturnType<typeof ragCatalogRepository>,
  listRequest: RagQueryRequest,
  requests: RagQueryRequest[],
  question: string,
  requireUniqueProduct = false,
) {
  const query = [listRequest.productText, listRequest.material].filter(Boolean).join(" ") || listRequest.specifications.join(" ");
  const explicitFilter = [listRequest.material, ...listRequest.specifications].filter(Boolean).join(" ");
  const categoryText = listRequest.categoryText ?? null;
  const requestedTier = requests.find((request) => request.intent === "price_lookup")?.priceTier ?? listRequest.priceTier;
  const itemsById = new Map<number, RagCatalogVariant>();
  let cursor: number | null = null;
  let total = 0;
  let pageCount = 0;
  let dataComplete = false;
  do {
    const page = await catalogRepo.searchCatalogPage(query, cursor, 50, categoryText);
    if (page.error) throw new Error("RAG catalog page repository unavailable");
    if (!page.data) throw new Error("RAG catalog page repository returned no payload");
    total = page.data.total;
    for (const item of page.data.items) itemsById.set(item.id, item);
    cursor = page.data.nextCursor;
    pageCount += 1;
    dataComplete = cursor === null;
  } while (cursor !== null && pageCount < 100);

  const now = Date.now();
  const matchedRows = [...itemsById.values()].filter((row) => {
    const candidate = {
      productName: row.products?.name ?? row.display_name,
      variant: `${row.display_name} ${row.raw_specification ?? ""}`,
      aliases: row.products?.product_aliases?.map((alias) => alias.alias) ?? [],
      packages: row.packaging_options.map((pack) => ({
        name: pack.name,
        quantity: Number(pack.quantity),
        unit: pack.base_unit,
        activeTiers: [...new Set(pack.prices.filter((price) => isCatalogPriceVisible(row, price)).map((price) => price.price_type))] as Array<"retail" | "wholesale" | "dealer">,
      })),
    };
    return matchesNamedCandidate(candidate, query)
      && (!explicitFilter || matchesExplicitQuery(candidate, explicitFilter));
  });
  const items = matchedRows.map((row) => {
    const prices = row.packaging_options.flatMap((pack) => pack.prices
      .filter((price) => isCatalogPriceVisible(row, price, now))
      .filter((price) => !requestedTier || price.price_type === requestedTier)
      .map((price) => ({
        id: price.id,
        packagingId: pack.id,
        version: Number(price.version),
        amount: Number(price.amount),
        priceType: price.price_type,
        minimumQuantity: Number(price.minimum_quantity),
        packagingName: pack.name,
        packageQuantity: Number(pack.quantity),
        unit: pack.base_unit,
        packageNote: pack.note ?? "",
        priceList: price.price_lists?.name ?? null,
        supplier: price.price_lists?.suppliers?.name ?? null,
        isDemo: price.price_lists?.is_demo === true,
        purchasable: price.price_lists?.is_demo !== true,
        verificationStatus: row.verification_status,
      })));
    return {
      id: row.id,
      productName: row.products?.name ?? row.display_name,
      category: row.products?.categories?.name ?? "Vật tư",
      variant: row.raw_specification ?? row.display_name,
      verificationStatus: row.verification_status,
      sourcePages: [...new Set(row.source_pages)].sort((a, b) => a - b),
      prices,
    };
  });
  if (listRequest.requestedFields.includes("products")) {
    const groups = verifiedCatalogProductGroups(matchedRows);
    const visibleGroups = groups.slice(0, 12);
    const asksForPrice = listRequest.requestedFields.includes("price") || requests.some((request) => request.intent === "price_lookup");
    const suggestions = suggestedCatalogQuestions(visibleGroups, asksForPrice);
    const answer = groups.length === 0
      ? "Mình chưa tìm thấy nhóm sản phẩm đã xác minh phù hợp trong danh mục Supabase."
      : [
          `Mình tìm thấy ${groups.length} nhóm sản phẩm đã xác minh${dataComplete ? "" : " trong phần kết quả đã tải"}:`,
          ...visibleGroups.map((group) => `• ${group.name}: ${group.variants.length} quy cách${group.diameters.length ? `; cỡ tìm thấy ${group.diameters.slice(0, 8).map((value) => `${new Intl.NumberFormat("vi-VN").format(value)} ly`).join(", ")}${group.diameters.length > 8 ? ", …" : ""}` : ""}`),
          ...(groups.length > visibleGroups.length ? [`Còn ${groups.length - visibleGroups.length} nhóm khác trong danh mục.`] : []),
          "Để tra chính xác hơn, hãy thêm tên nhóm và cỡ vào câu hỏi. Bạn có thể chọn câu hỏi phù hợp, ví dụ:",
          ...suggestions.map((suggestion) => `• “${suggestion}”`),
        ].join("\n");
    return {
      status: groups.length ? "answered" as const : "insufficient_evidence" as const,
      answer,
      items: [],
      sources: [],
      retrieval: {
        vectorChunks: 0,
        lexicalProducts: groups.length,
        embeddingModel: "not_used",
        trace: { question, chunkIds: [], variantIds: matchedRows.map((row) => row.id), priceIds: [], answer },
      },
    };
  }
  if (requireUniqueProduct) {
    const productIds = new Set(matchedRows.map((item) => item.product_id).filter((id): id is number => typeof id === "number"));
    if (productIds.size > 1) {
      const asksForPrice = listRequest.requestedFields.includes("price") || requests.some((request) => request.intent === "price_lookup");
      return guidedCatalogClarification(matchedRows, question, asksForPrice);
    }
    if (productIds.size === 0) {
      return {
        status: "insufficient_evidence" as const,
        answer: "Mình chưa tìm thấy nhóm mặt hàng đã xác minh cùng nguồn hiện hành đủ để liệt kê.",
        items: [], sources: [],
        retrieval: { vectorChunks: 0, lexicalProducts: 0, embeddingModel: "not_used" },
      };
    }
  }
  const complete = dataComplete;
  const matchedTotal = dataComplete ? items.length : total;
  const answer = !items.length ? "Mình chưa tìm thấy mặt hàng hoặc quy cách đã xác minh phù hợp trong danh mục Supabase." : complete
    ? variantListAnswer(items, requestedTier)
    : `${items.length} / ${total} quy cách đã xác minh được tải. Danh sách chưa tải hết; hãy tiếp tục từ trang kế tiếp.`;
  return {
    status: items.length ? "answered" as const : "insufficient_evidence" as const,
    answer,
    items,
    sources: [],
    catalogPage: { total: matchedTotal, nextCursor: cursor, complete },
    retrieval: {
      vectorChunks: 0,
      lexicalProducts: items.length,
      embeddingModel: "not_used",
      trace: {
        question,
        chunkIds: [],
        variantIds: items.map((item) => item.id),
        priceIds: items.flatMap((item) => item.prices.map((price) => price.id)),
        answer,
      },
    },
  };
}

async function queryReferencedCurrentPrices(
  catalogRepo: ReturnType<typeof ragCatalogRepository>,
  variantIds: number[],
  question: string,
  understood: ReturnType<typeof understandQuery>,
) {
  const { data, error } = await catalogRepo.expandVerifiedGroups(variantIds);
  if (error) throw new Error("RAG catalog reference lookup unavailable");
  const allowed = new Set(variantIds);
  const now = Date.now();
  const items = (data ?? []).filter((row) => allowed.has(row.id) && row.verification_status === "verified").map((row) => ({
    id: row.id,
    productName: row.products?.name ?? row.display_name,
    category: row.products?.categories?.name ?? "Vật tư",
    variant: row.raw_specification ?? row.display_name,
    verificationStatus: row.verification_status,
    sourcePages: [...new Set(row.source_pages ?? [])].sort((a, b) => a - b),
    prices: row.packaging_options.filter((pack) => matchesExplicitPackage({
      name: pack.name,
      quantity: Number(pack.quantity),
      unit: pack.base_unit,
      activeTiers: [...new Set(pack.prices.map((price) => price.price_type))] as Array<"retail" | "wholesale" | "dealer">,
    }, question)).flatMap((pack) => pack.prices
      .filter((price) => isCatalogPriceVisible(row, price, now))
      .filter((price) => !understood.tier || price.price_type === understood.tier)
      .map((price) => ({
        id: price.id,
        packagingId: pack.id,
        version: Number(price.version),
        amount: Number(price.amount),
        priceType: price.price_type,
        minimumQuantity: Number(price.minimum_quantity),
        packagingName: pack.name,
        packageQuantity: Number(pack.quantity),
        unit: pack.base_unit,
        packageNote: pack.note ?? "",
        priceList: price.price_lists?.name ?? null,
        supplier: price.price_lists?.suppliers?.name ?? null,
        isDemo: price.price_lists?.is_demo === true || price.price_lists?.name.startsWith("DEMO —") === true,
        purchasable: price.price_lists?.is_demo !== true && price.price_lists?.name.startsWith("DEMO —") !== true,
        verificationStatus: row.verification_status,
      }))),
  }));
  const foundIds = new Set(items.map((item) => item.id));
  const complete = variantIds.every((id) => foundIds.has(id));
  const answer = complete
    ? priceAnswer(items)
    : "Mình không còn tìm thấy đủ các mặt hàng đã chọn trong danh mục hiện hành. Hãy chọn lại mặt hàng để kiểm tra giá mới.";
  return {
    status: complete && items.every((item) => item.prices.length > 0) ? "answered" as const : "insufficient_evidence" as const,
    answer,
    items,
    sources: [],
    retrieval: {
      vectorChunks: 0,
      lexicalProducts: 0,
      embeddingModel: "not_used",
      trace: { question, chunkIds: [], variantIds: items.map((item) => item.id), priceIds: items.flatMap((item) => item.prices.map((price) => price.id)), answer },
    },
  };
}

async function queryRagOperation(body: unknown, client: SupabaseClient, context: { previousQuestion?: string; previousVariantIds?: number[] } = {}, options: { publicCatalogOnly?: boolean } = {}, validatedPlan?: RagQueryPlan) {
  const chunksRepo = ragChunksRepository(client, options.publicCatalogOnly);
  const pagesRepo = ragPagesRepository(client);
  const catalogRepo = ragCatalogRepository(client, options.publicCatalogOnly);
  const input = (typeof body === "object" && body !== null ? body : {}) as { question?: unknown };
  const originalQuestion = typeof input.question === "string" ? input.question.trim() : "";
  if (!originalQuestion || originalQuestion.length > 1000) throw new ApiError(400, "INVALID_INPUT", "Nhập câu hỏi từ 1 đến 1.000 ký tự.");
  const question = resolveFollowUpQuestion(context.previousQuestion, originalQuestion);
  const understood = understandQuery(catalogIdentityQuestion(question));
  if (understood.tierConflict) return safeClarification("Vui l\u00f2ng ch\u1ecdn m\u1ed9t lo\u1ea1i gi\u00e1: gi\u00e1 s\u1ec9, gi\u00e1 \u0111\u1ea1i l\u00fd ho\u1eb7c gi\u00e1 l\u1ebb.");
  const reference = resolveVariantReference(originalQuestion, context.previousVariantIds ?? []);
  if (reference.kind === "ambiguous") return safeClarification("Bạn muốn chọn quy cách thứ mấy trong kết quả vừa rồi?");
  if (reference.kind === "missing") return safeClarification(`Kết quả trước không có quy cách thứ ${reference.ordinal}. Hãy chọn lại quy cách trong danh sách.`);
  const referenceVariantIds = reference.kind === "resolved" ? reference.variantIds : null;
  const asksPriceForReference = /\b(?:gia|bao nhieu|bao gia|price)\b/u.test(question.toLocaleLowerCase("vi-VN").replace(/đ/g, "d").normalize("NFD").replace(/\p{M}/gu, ""));
  if (reference.kind === "resolved" && asksPriceForReference) {
    return queryReferencedCurrentPrices(catalogRepo, reference.variantIds, question, understood);
  }
  let plan;
  try {
    plan = validatedPlan ?? await planRagQuery({ question, context: context.previousQuestion ? [context.previousQuestion] : [] });
  } catch (error) {
    if (error instanceof RagProviderUnavailableError) {
      return safeClarification("Dịch vụ phân tích câu hỏi tạm thời chưa sẵn sàng. Bạn có thể nêu tên mặt hàng và quy cách cụ thể không?");
    }
    throw error;
  }
  if (plan.intent === "clarification") return safeClarification(plan.clarificationQuestion ?? "Bạn vui lòng nêu rõ tên mặt hàng hoặc quy cách cần tra.");
  if (plan.intent === "out_of_domain") {
    return {
      status: "insufficient_evidence" as const,
      answer: "Mình chỉ hỗ trợ tra cứu thông tin và giá các mặt hàng trong danh mục cửa hàng.",
      items: [], sources: [], retrieval: { vectorChunks: 0, lexicalProducts: 0, embeddingModel: "not_used" },
    };
  }
  const listRequest = plan.requests.find((request) => request.intent === "catalog_list");
  if (listRequest) return queryCompleteCatalogList(catalogRepo, listRequest, plan.requests, question, plan.confidence === undefined);
  const adviceRequest = plan.requests.find((request) => request.intent === "advice");
  if (adviceRequest && (adviceRequest.constraints.length === 0 || plan.unresolvedFields.length > 0)) {
    return safeClarification("Bạn dùng vật tư cho vị trí hoặc mục đích nào, và có yêu cầu chịu lực hay môi trường cụ thể không?");
  }
  const catalogFactsOnly = plan.requests.length > 0 && plan.requests.every((request) => request.intent === "product_info");
  const hardFilters = toHardFilters(understood);
  const asksForPrice = plan.requests.some((request) => request.intent === "price_lookup" || request.requestedFields.includes("price"));
  const hasComparison = plan.requests.some((request) => request.intent === "comparison");
  const comparisonTerms = [...new Set(plan.requests.filter((request) => request.intent === "comparison").flatMap((request) => request.constraints))].slice(0, 12);
  if (hasComparison && !asksForPrice && comparisonTerms.length === 0) {
    return safeClarification("B\u1ea1n mu\u1ed1n so s\u00e1nh gi\u00e1, k\u00edch th\u01b0\u1edbc, ch\u1ea5t li\u1ec7u hay \u0111\u1eb7c \u0111i\u1ec3m n\u00e0o? M\u00ecnh s\u1ebd ch\u1ec9 \u0111\u1ed1i chi\u1ebfu ph\u1ea7n c\u00f3 t\u00e0i li\u1ec7u x\u00e1c minh.");
  }
  const exactPriceQuery = plan.requests.length === 1 && plan.requests[0]?.intent === "price_lookup" && specificPriceLookupHint(question) !== null;
  const asksForVariantList = isVariantListIntent(question);
  const comparisons = hasComparison ? comparisonTargets(question) : null;
  if (hasComparison && !comparisons) return safeClarification("Bạn muốn so sánh chính xác những quy cách nào?");
  const lexicalQuery = [
    ...understood.aliases,
    ...understood.nameTerms,
    ...(exactPriceQuery || catalogFactsOnly ? [...understood.dimensions, ...understood.specCodes] : []),
  ].join(" ") || question;
  const skipVectors = exactPriceQuery || catalogFactsOnly;
  const model = skipVectors ? "not_used" : embeddingModel();
  let queryVector: number[] | undefined;
  let lexicalResult: Awaited<ReturnType<typeof catalogRepo.search>>;
  let vectorData: unknown[] | null = [];
  let vectorError: unknown = null;
  try {
    const [vectors, lexical] = await Promise.all([
      skipVectors ? Promise.resolve([] as number[][]) : embedTexts([question]),
      catalogRepo.search(lexicalQuery),
    ]);
    [queryVector] = vectors;
    lexicalResult = lexical;
    if (!skipVectors) {
      if (!queryVector) throw new Error("Could not create a query embedding.");
      const vector = `[${queryVector.join(",")}]`;
      const matched = await chunksRepo.match(vector, model);
      vectorData = matched.data;
      vectorError = matched.error;
    }
  } catch (error) {
    if (error instanceof RagProviderUnavailableError) throw new ApiError(503, "RAG_UNAVAILABLE", "RAG retrieval is temporarily unavailable.");
    throw error;
  }
  const { data: lexicalData, error: lexicalError } = lexicalResult;
  if (vectorError) throw new Error("RAG repository unavailable");
  if (lexicalError) throw new Error("RAG repository unavailable");
  let chunks = ((vectorData ?? []) as unknown as Match[]).filter((item): item is Match & { product_variant_id: number } =>
    item.similarity >= 0.20 && item.metadata.kind === "verified_catalog" && item.product_variant_id !== null);
  const lexicalRows = ((lexicalData ?? []) as unknown as Array<{ id: number; result_type?: string; relevance?: number }>).filter((row) => row.result_type === "variant");
  let lexicalIds = lexicalRows.map((row) => Number(row.id)).filter(Number.isFinite);
  const lexicalRelevance = new Map(lexicalRows.map((row) => [Number(row.id), Number(row.relevance ?? 0)]));
  const ids = referenceVariantIds ?? rankVariantIds(
    chunks.map((chunk) => chunk.product_variant_id).filter((id): id is number => id !== null),
    lexicalIds,
    options.publicCatalogOnly ? 8 : 12,
  );

  if (asksForVariantList) {
    const insufficient = (answer = "Mình chưa tìm thấy nhóm mặt hàng đã xác minh đủ liên quan để liệt kê.") => ({
      status: "insufficient_evidence" as const,
      answer,
      items: [],
      sources: [],
      retrieval: { vectorChunks: chunks.length, lexicalProducts: lexicalIds.length, embeddingModel: model },
    });
    if (!ids.length) return insufficient();
    const { data: expandedData, error: expansionError } = await catalogRepo.expandVerifiedGroups(ids);
    if (expansionError) throw new Error("RAG repository unavailable");
    const identityQuestion = question.toLocaleLowerCase("vi-VN").replace(/đ/g, "d").normalize("NFD").replace(/\p{M}/gu, "")
      .replace(/\b(?:gia\s+(?:si|le|dai\s+ly)|wholesale|retail|dealer)\b/gu, " ");
    const requestTerms = identityQuestion.replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b(?:cua hang|cua|hang|co|bao nhieu|loai|nhung|quy cach|liet ke|cac|gia|nao|tung|cho hoi|bao gia)\b/gu, " ")
      .replace(/\s+/g, " ").trim();
    const expanded = (expandedData ?? []) as unknown as Array<CatalogRow & { product_id: number; source_pages: number[] }>;
    const supported = expanded.filter((row) => {
      const candidate = {
        productName: row.products?.name ?? row.display_name,
        variant: `${row.display_name} ${row.raw_specification ?? ""}`,
        aliases: row.products?.product_aliases?.map((alias) => alias.alias) ?? [],
        packages: row.packaging_options.map((pack) => ({
          name: pack.name,
          quantity: Number(pack.quantity),
          unit: pack.base_unit,
          activeTiers: [...new Set(pack.prices.filter((price) => isCatalogPriceVisible(row, price)).map((price) => price.price_type))] as Array<"retail" | "wholesale" | "dealer">,
        })),
      };
      return matchesExplicitQuery(candidate, requestTerms)
        && matchesNamedCandidate(candidate, requestTerms, lexicalRelevance.get(row.id) ?? 0);
    });
    if (!supported.length) return insufficient();
    const groups = new Map<number, typeof supported>();
    for (const row of supported) groups.set(row.product_id, [...(groups.get(row.product_id) ?? []), row]);
    if (!requestTerms && groups.size === 1) {
      return {
        status: "clarify" as const,
        clarification: "Chọn mặt hàng",
        answer: "Bạn muốn liệt kê quy cách của mặt hàng nào? Hãy nêu tên hoặc tên gọi thường dùng.",
        items: [], sources: [],
        retrieval: { vectorChunks: chunks.length, lexicalProducts: lexicalIds.length, embeddingModel: model },
      };
    }
    if (groups.size > 1) {
      const names = [...new Set([...groups.values()].map((rows) => rows[0]?.products?.name ?? rows[0]?.display_name))].slice(0, 4);
      return {
        status: "clarify" as const,
        clarification: "Chọn nhóm mặt hàng",
        answer: `Mình tìm thấy nhiều nhóm phù hợp: ${names.join("; ")}. Bạn muốn xem quy cách của nhóm nào?`,
        items: [], sources: [],
        retrieval: { vectorChunks: chunks.length, lexicalProducts: lexicalIds.length, embeddingModel: model },
      };
    }
    const groupRows = [...groups.values()][0] ?? [];
    const listItems = groupRows.map((row) => ({
      id: row.id,
      productName: row.products?.name ?? row.display_name,
      category: row.products?.categories?.name ?? "Vật tư",
      variant: row.raw_specification ?? row.display_name,
      verificationStatus: row.verification_status,
      sourcePages: [...new Set(row.source_pages ?? [])].sort((a, b) => a - b),
      prices: row.packaging_options.filter((pack) => matchesExplicitPackage({
        name: pack.name,
        quantity: Number(pack.quantity),
        unit: pack.base_unit,
        activeTiers: [...new Set(pack.prices.filter((price) => isCatalogPriceVisible(row, price)).map((price) => price.price_type))] as Array<"retail" | "wholesale" | "dealer">,
      }, question)).flatMap((pack) => pack.prices
        .filter((price) => isCatalogPriceVisible(row, price))
        .filter((price) => !understood.tier || price.price_type === understood.tier)
        .map((price) => ({
          id: price.id, packagingId: pack.id, version: Number(price.version), amount: Number(price.amount), priceType: price.price_type,
          minimumQuantity: Number(price.minimum_quantity), packagingName: pack.name,
          packageQuantity: Number(pack.quantity), unit: pack.base_unit, packageNote: pack.note ?? "",
          priceList: price.price_lists?.name ?? null, supplier: price.price_lists?.suppliers?.name ?? null,
          isDemo: price.price_lists?.is_demo === true || price.price_lists?.name.startsWith("DEMO —") === true,
          purchasable: price.price_lists?.is_demo !== true && price.price_lists?.name.startsWith("DEMO —") !== true,
          verificationStatus: row.verification_status,
        }))),
    }));
    const supportedIds = new Set(listItems.map((item) => item.id));
    const sources = buildCitations(chunks.filter((chunk) => chunk.product_variant_id !== null && supportedIds.has(chunk.product_variant_id)).map((chunk) => ({
      pageNumber: typeof chunk.metadata.page_number === "number" ? chunk.metadata.page_number : null,
      chunkId: chunk.id, chunkKey: chunk.chunk_key, sourceRevision: chunk.source_revision ?? null,
      sourceSpan: chunk.source_start !== null && chunk.source_end !== null ? { start: chunk.source_start, end: chunk.source_end } : null,
      excerpt: chunk.content,
      evidenceKind: chunk.metadata.kind === "verified_catalog" ? chunk.metadata.kind : null,
      verifiedVariantId: chunk.product_variant_id,
    })));
    const answer = variantListAnswer(listItems, understood.tier);
    return {
      status: "answered" as const, answer, items: listItems, sources,
      retrieval: {
        vectorChunks: chunks.filter((chunk) => chunk.product_variant_id !== null && supportedIds.has(chunk.product_variant_id)).length,
        lexicalProducts: lexicalIds.filter((id) => supportedIds.has(id)).length,
        embeddingModel: model,
        trace: { question: originalQuestion, chunkIds: chunks.filter((chunk) => chunk.product_variant_id !== null && supportedIds.has(chunk.product_variant_id)).map((chunk) => chunk.id), variantIds: listItems.map((item) => item.id), priceIds: listItems.flatMap((item) => item.prices.map((price) => price.id)), answer },
      },
    };
  }
  let catalog: CatalogRow[] = [];
  const eligiblePages = new Map<number, number[]>();
  const sourceIds = [...new Set(chunks.map((chunk) => chunk.source_page_id).filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0))];
  type SourcePageLookup = Pick<Awaited<ReturnType<typeof pagesRepo.numbers>>, "data" | "error">;
  const sourcePagesPromise: Promise<SourcePageLookup> = !options.publicCatalogOnly && sourceIds.length ? Promise.resolve(pagesRepo.numbers(sourceIds)) : Promise.resolve({ data: [], error: null });
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
    catalog = ((data ?? []) as unknown as CatalogRow[]).filter((row) => row.verification_status === "verified");
    const order = new Map(ids.map((id, index) => [id, index]));
    catalog.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
  } else sourcePages = await sourcePagesPromise;

  const now = Date.now();
  if (!referenceVariantIds && (Object.keys(hardFilters).length > 0 || asksForPrice || understood.nameTerms.length > 0 || understood.aliases.length > 0)) {
    catalog = catalog.filter((row) => {
      const candidate = {
      productName: row.products?.name ?? row.display_name,
      variant: `${row.display_name} ${row.raw_specification ?? ""}`,
      aliases: row.products?.product_aliases?.map((alias) => alias.alias) ?? [],
      packages: row.packaging_options.map((pack) => ({
        name: pack.name,
        quantity: Number(pack.quantity),
        unit: pack.base_unit,
         activeTiers: [...new Set(pack.prices.filter((price) => isCurrentPriceForMatching(price, now)).map((price) => price.price_type))] as Array<"retail" | "wholesale" | "dealer">,
      })),
      };
      const targetMatch = comparisons
        ? comparisons.some((target) => matchesExplicitQuery(candidate, target) && matchesNamedCandidate(candidate, target, lexicalRelevance.get(row.id) ?? 0))
        : matchesExplicitQuery(candidate, catalogFactsOnly ? catalogIdentityQuestion(question) : question) && matchesNamedCandidate(candidate, catalogFactsOnly ? catalogIdentityQuestion(question) : question, lexicalRelevance.get(row.id) ?? 0);
      return targetMatch;
    });
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
      quantity: Number(pack.quantity),
      unit: pack.base_unit,
      activeTiers: [...new Set(pack.prices.filter((price) => isCatalogPriceVisible(row, price, now)).map((price) => price.price_type))] as Array<"retail" | "wholesale" | "dealer">,
    }, catalogFactsOnly ? catalogIdentityQuestion(question) : question)).flatMap((pack) => pack.prices
      .filter((price) => isCatalogPriceVisible(row, price, now))
      .filter((price) => !understood.tier || price.price_type === understood.tier)
      .map((price) => ({
        id: price.id, packagingId: pack.id, version: Number(price.version), amount: Number(price.amount), priceType: price.price_type,
        minimumQuantity: Number(price.minimum_quantity), packagingName: pack.name,
        packageQuantity: Number(pack.quantity), unit: pack.base_unit, packageNote: pack.note ?? "",
        priceList: price.price_lists?.name ?? null, supplier: price.price_lists?.suppliers?.name ?? null,
        isDemo: price.price_lists?.is_demo === true,
        purchasable: price.price_lists?.is_demo !== true,
        verificationStatus: row.verification_status,
      })));
    return { id: row.id, productName: row.products?.name ?? row.display_name, category: row.products?.categories?.name ?? "Vật tư", variant: row.raw_specification ?? row.display_name, verificationStatus: row.verification_status, sourcePages: pages, prices };
  });

  if (catalogFactsOnly && plan.confidence === undefined && catalog.length > 1) return safeClarification("Có nhiều quy cách phù hợp. Bạn muốn xem mặt hàng hoặc quy cách nào?");
  if (catalogFactsOnly) {
    const answer = catalog.length ? catalog.map((row) => {
      const specification = row.raw_specification ?? row.display_name;
      const specificationMeaning = catalogSpecificationMeaning(specification, [
        row.products?.name,
        row.products?.categories?.name,
        ...(row.products?.product_aliases ?? []).map((alias) => alias.alias),
      ]);
      const attributes = Object.entries(row.attributes ?? {}).filter(([, value]) => value !== null && value !== "")
        .map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`);
      const packages = row.packaging_options.map((pack) => `${pack.name}: ${new Intl.NumberFormat("vi-VN").format(Number(pack.quantity))} ${pack.base_unit}${pack.note ? ` (${pack.note})` : ""}`);
      return [`${row.products?.name ?? row.display_name} — quy cách: ${specification}.`,
        ...(specificationMeaning ? [`Diễn giải quy cách: ${specificationMeaning}.`] : []),
        ...(row.products?.description?.trim() ? [`Mô tả sản phẩm: ${row.products.description.trim()}`] : []),
        ...attributes, packages.length ? `Đóng gói: ${packages.join("; ")}.` : "Chưa có thông tin đóng gói trong danh mục.",
        `Nguồn: Supabase · product_variants #${row.id}.`].join("\n");
    }).join("\n\n") : "Chưa tìm thấy mặt hàng hoặc quy cách đã xác minh phù hợp trong danh mục Supabase. Hãy kiểm tra tên hàng và quy cách.";
    return {
      status: catalog.length ? "answered" as const : "insufficient_evidence" as const,
      answer, items: items.map((item) => ({ ...item, prices: [] })), sources: [],
      retrieval: { vectorChunks: 0, lexicalProducts: lexicalIds.length, embeddingModel: "not_used", trace: {
        question: originalQuestion, chunkIds: [], variantIds: catalog.map((row) => row.id), priceIds: [], answer,
      } },
    };
  }

  // Some local chat models omit confidence even when they return a valid plan.
  // Accept that shape only after SQL catalog matching resolves one exact variant
  // and the normal retrieval/citation checks produce a source for that variant.
  if (plan.confidence === undefined) {
    if (items.length > 1) {
      return safeClarification("Mình tìm thấy nhiều quy cách phù hợp. Bạn cho mình thêm tên hoặc quy cách cụ thể để đối chiếu đúng mặt hàng nhé.");
    }
    const matchedVariantId = items[0]?.id;
    const citedEvidence = matchedVariantId === undefined ? [] : buildCitations(chunks
      .filter((chunk) => chunk.product_variant_id === matchedVariantId)
      .map((chunk) => ({
        pageNumber: (chunk.source_page_id === null ? undefined : pageNumbers.get(chunk.source_page_id)) ?? (typeof chunk.metadata.page_number === "number" ? chunk.metadata.page_number : null),
        chunkId: chunk.id,
        chunkKey: chunk.chunk_key,
        sourceRevision: chunk.source_revision ?? null,
        sourceSpan: chunk.source_start !== null && chunk.source_end !== null ? { start: chunk.source_start, end: chunk.source_end } : null,
        excerpt: chunk.content,
        evidenceKind: chunk.metadata.kind === "verified_catalog" ? chunk.metadata.kind : null,
        verifiedVariantId: chunk.product_variant_id,
      })));
    if (items.length !== 1 || citedEvidence.length === 0) {
      return {
        status: "insufficient_evidence" as const,
        answer: "Mình chưa tìm thấy bằng chứng nguồn hiện hành đủ để xác nhận mặt hàng này.",
        items: [],
        sources: [],
        retrieval: { vectorChunks: chunks.length, lexicalProducts: lexicalIds.length, embeddingModel: model },
      };
    }
  }

  if (asksForPrice && !comparisons && items.length > 1) {
    const byCategory = new Map<string, typeof items>();
    for (const item of items) byCategory.set(item.category, [...(byCategory.get(item.category) ?? []), item]);
    const relevantGroup = [...byCategory.entries()].sort((left, right) => right[1].length - left[1].length)[0];
    const groupItems = relevantGroup?.[1] ?? items;
    const candidates = [...new Set(groupItems.map((item) => item.variant))].slice(0, 3);
    const clarificationAnswer = `Có nhiều quy cách thuộc nhóm ${relevantGroup?.[0] ?? items[0]?.productName ?? "mặt hàng"}. Bạn cần loại nào: ${candidates.join("; ")}${[...new Set(groupItems.map((item) => item.variant))].length > candidates.length ? "; …" : ""}?`;
    return {
      status: "clarify" as const,
      clarification: "Chọn quy cách sản phẩm",
      answer: clarificationAnswer,
      items: [], sources: [],
      retrieval: {
        vectorChunks: chunks.length,
        lexicalProducts: lexicalIds.length,
        embeddingModel: model,
        trace: {
          question: originalQuestion,
          chunkIds: chunks.map((chunk) => chunk.id),
          variantIds: groupItems.map((item) => item.id),
          priceIds: groupItems.flatMap((item) => item.prices.map((price) => price.id)),
          answer: clarificationAnswer,
        },
      },
    };
  }

  const evidence = [
    ...catalog.slice(0, 8).map((row) => {
      const item = items.find((candidate) => candidate.id === row.id)!;
      const aliases = row.products?.product_aliases?.map((alias) => alias.alias).join(", ") ?? "";
      return { page: item.sourcePages[0] ?? null, content: `Sản phẩm: ${item.productName}; danh mục: ${item.category}; quy cách: ${item.variant}; tên gọi khác: ${aliases}; trạng thái: ${item.verificationStatus}.`, prices: item.prices };
    }),
    ...chunks.slice(0, 6).map((chunk) => ({ page: (chunk.source_page_id === null ? undefined : pageNumbers.get(chunk.source_page_id)) ?? (typeof chunk.metadata.page_number === "number" ? chunk.metadata.page_number : null), content: chunk.content, similarity: chunk.similarity, prices: chunk.product_variant_id ? items.find((item) => item.id === chunk.product_variant_id)?.prices ?? [] : [] })),
  ];
  const uniqueEvidence = [...new Map(evidence.map((item) => [`${item.page ?? "?"}:${item.content}`, item])).values()];
  if (!uniqueEvidence.length) {
    return {
      status: "insufficient_evidence" as const,
      answer: "Mình chưa tìm thấy tài liệu hoặc mặt hàng đủ liên quan để trả lời. Hãy kiểm tra tên hàng và trạng thái xác minh của danh mục Supabase.",
      items: [], sources: [], retrieval: { vectorChunks: 0, lexicalProducts: 0, embeddingModel: model },
    };
  }
  const missingComparisonTargets = asksForPrice ? comparisons?.filter((target) => {
    const row = catalog.find((candidate) => matchesExplicitQuery({
      productName: candidate.products?.name ?? candidate.display_name,
      variant: `${candidate.display_name} ${candidate.raw_specification ?? ""}`,
      aliases: candidate.products?.product_aliases?.map((alias) => alias.alias) ?? [],
      packages: candidate.packaging_options.map((pack) => ({
        name: pack.name,
        quantity: Number(pack.quantity),
        unit: pack.base_unit,
        activeTiers: [...new Set(pack.prices.filter((price) => isCurrentPriceForMatching(price, now)).map((price) => price.price_type))] as Array<"retail" | "wholesale" | "dealer">,
      })),
    }, target));
    if (!row) return true;
    return !items.find((item) => item.id === row.id)?.prices.length;
  }) ?? [] : [];
  let answerBlocks: GroundedResponse["blocks"] | undefined;
  let answer: string;
  let groundedResponseAccepted = true;
  if (asksForPrice) {
    answer = [priceAnswer(items), ...missingComparisonTargets.map((target) => `Chua tim thay mat hang hoac gia hien hanh phu hop cho: ${target}.`)].filter(Boolean).join("\n");
  } else {
    const packet = buildEvidencePacket({
      role: options.publicCatalogOnly ? "customer" : "staff",
      variants: catalog.map((row) => ({
        id: row.id,
        productId: row.product_id && row.product_id > 0 ? row.product_id : row.id,
        productName: row.products?.name ?? row.display_name,
        variant: row.raw_specification ?? row.display_name,
        category: row.products?.categories?.name ?? "",
        aliases: row.products?.product_aliases?.map((alias) => alias.alias) ?? [],
        attributes: Object.fromEntries(Object.entries(row.attributes ?? {}).map(([key, value]) => [key, value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value)) ? value : JSON.stringify(value)])),
        active: true,
        verificationStatus: row.verification_status,
        sourcePages: items.find((item) => item.id === row.id)?.sourcePages ?? [],
      })),
      prices: catalog.flatMap((row) => row.packaging_options.flatMap((pack) => pack.prices.map((price) => ({
        id: price.id,
        variantId: row.id,
        packageId: pack.id,
        version: Number(price.version),
        amount: Number(price.amount),
        tier: price.price_type as "retail" | "wholesale" | "dealer",
        minimumQuantity: Number(price.minimum_quantity),
        packageName: pack.name,
        packageQuantity: Number(pack.quantity),
        unit: pack.base_unit,
        priceListName: price.price_lists?.name ?? "",
        supplierName: price.price_lists?.suppliers?.name ?? "",
        currency: "VND",
        active: price.active,
        validFrom: price.valid_from,
        validTo: price.valid_to,
        isSample: price.price_lists?.is_sample ?? false,
        supplierActive: price.price_lists?.suppliers?.active ?? true,
      })))),
      documents: chunks
        .filter((chunk) => chunk.metadata.kind === "verified_catalog")
        .map((chunk) => ({
          id: chunk.id,
          variantId: chunk.product_variant_id,
          sourcePageId: chunk.source_page_id,
          pageNumber: typeof chunk.metadata.page_number === "number" ? chunk.metadata.page_number : chunk.source_page_id === null ? null : pageNumbers.get(chunk.source_page_id) ?? null,
          sourceRevision: chunk.source_revision,
          sourceSpan: chunk.source_start !== null && chunk.source_end !== null ? { start: chunk.source_start, end: chunk.source_end } : null,
          chunkKey: chunk.chunk_key,
          content: chunk.content,
          evidenceKind: "verified_catalog" as const,
          current: true,
          publicVisible: true,
        })),
    });
    const raw = await generateGroundedResponseText({
      question,
      plan,
      evidence: packet.entries.map((entry) => ({
        id: entry.id,
        kind: entry.kind,
        summary: entry.kind === "document" ? entry.excerpt : entry.kind === "catalog"
          ? `${entry.productName}; ${entry.variant}; ${entry.category}`
          : `${entry.tier} price evidence exists for ${entry.packageName}; do not state the amount or unit.`,
      })),
    }).catch((error: unknown) => {
      if (error instanceof RagProviderUnavailableError) throw new ApiError(503, "RAG_UNAVAILABLE", "Dich vu RAG tam thoi chua san sang.");
      throw error;
    });
    const requiredDocumentTerms = [...new Set([
      ...(adviceRequest?.constraints ?? []),
      ...(!asksForPrice ? comparisonTerms : []),
    ])].slice(0, 12);
    const validated = validateGroundedResponse(raw, packet, requiredDocumentTerms.length
      ? { requiredDocumentTerms }
      : {});
    const responseKindsRequired: Array<"comparison" | "recommendation"> = [
      ...(hasComparison ? ["comparison" as const] : []),
      ...(adviceRequest ? ["recommendation" as const] : []),
    ];
    const clarificationOnly = validated.valid && validated.blocks.every((block) => block.kind === "clarification");
    if (validated.valid && (clarificationOnly || hasRequiredResponseKinds(validated.blocks, responseKindsRequired))) {
      answerBlocks = validated.blocks;
      answer = validated.blocks.map((block) => block.text).join("\n");
    } else {
      groundedResponseAccepted = false;
      answer = "Câu trả lời tự động chưa vượt qua kiểm tra bằng chứng catalog. Hãy nêu rõ thuộc tính cần tra hoặc xem quy cách đã xác minh trong danh mục.";
    }
  }
  const sources = buildCitations(chunks.map((chunk) => ({
    pageNumber: (chunk.source_page_id === null ? undefined : pageNumbers.get(chunk.source_page_id)) ?? (typeof chunk.metadata.page_number === "number" ? chunk.metadata.page_number : null),
    chunkId: chunk.id,
    chunkKey: chunk.chunk_key,
    sourceRevision: chunk.source_revision ?? null,
    sourceSpan: chunk.source_start !== null && chunk.source_end !== null ? { start: chunk.source_start, end: chunk.source_end } : null,
    excerpt: chunk.content,
    evidenceKind: chunk.metadata.kind === "verified_catalog" ? chunk.metadata.kind : null,
    verifiedVariantId: chunk.product_variant_id,
  })));
  const generatedClarification = answerBlocks?.some((block) => block.kind === "clarification") ?? false;
  const status = !groundedResponseAccepted || (asksForPrice && (!items.some((item) => item.prices.length > 0) || missingComparisonTargets.length > 0))
    ? "insufficient_evidence"
    : generatedClarification ? "clarify" : "answered";
  const trace = { question: originalQuestion, chunkIds: chunks.map((chunk) => chunk.id), variantIds: items.map((item) => item.id), priceIds: items.flatMap((item) => item.prices.map((price) => price.id)), answer };
  return { status, answer, ...(answerBlocks ? { answerBlocks } : {}), items: asksForPrice ? items : [], sources, retrieval: { vectorChunks: chunks.length, lexicalProducts: lexicalIds.length, embeddingModel: model, trace } };
}

function requestIdentity(request: RagQueryRequest) {
  return JSON.stringify([request.productText ?? "", request.categoryText ?? "", request.specifications, request.material ?? ""])
    .toLocaleLowerCase("vi-VN").normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d");
}

/** Keep each validated task independent so price/list fast paths cannot swallow facts or advice. */
function operationGroups(plan: RagQueryPlan): RagQueryRequest[][] {
  const groups: RagQueryRequest[][] = [];
  for (const request of plan.requests) {
    const comparison = request.intent === "comparison" ? groups.find((group) => group[0]?.intent === "comparison") : undefined;
    if (comparison) comparison.push(request);
    else groups.push([request]);
  }
  // A list already reads all current SQL prices for that exact catalog identity.
  for (const group of groups) {
    if (group[0]?.intent !== "catalog_list") continue;
    const priceGroup = groups.find((candidate) => candidate.length === 1 && candidate[0]?.intent === "price_lookup"
      && candidate[0].constraints.length === 0 && requestIdentity(candidate[0]) === requestIdentity(group[0]!));
    if (priceGroup) {
      group.push(...priceGroup);
      groups.splice(groups.indexOf(priceGroup), 1);
    }
  }
  return groups;
}

function operationQuestion(requests: RagQueryRequest[]) {
  const labels = { price_lookup: "Giá", catalog_list: "Liệt kê", product_info: "Thông tin", advice: "Tư vấn", comparison: "So sánh" };
  return requests.map((request) => [
    labels[request.intent], request.productText, request.categoryText, request.material,
    ...request.specifications, ...request.constraints,
    request.priceTier === "wholesale" ? "giá sỉ" : request.priceTier === "dealer" ? "giá đại lý" : request.priceTier === "retail" ? "giá lẻ" : "",
  ].filter(Boolean).join(" ")).join(" và ").slice(0, 1000);
}

export async function queryRag(body: unknown, client: SupabaseClient, context: { previousQuestion?: string; previousVariantIds?: number[] } = {}, options: { publicCatalogOnly?: boolean } = {}) {
  const input = (typeof body === "object" && body !== null ? body : {}) as { question?: unknown };
  const originalQuestion = typeof input.question === "string" ? input.question.trim() : "";
  // Preserve validation, tier conflicts, and validated conversation-reference handling before planning.
  if (!originalQuestion || originalQuestion.length > 1000 || understandQuery(originalQuestion).tierConflict
    || resolveVariantReference(originalQuestion, context.previousVariantIds ?? []).kind !== "none") {
    return queryRagOperation(body, client, context, options);
  }
  const question = resolveFollowUpQuestion(context.previousQuestion, originalQuestion);
  const plan = await planRagQuery({ question, context: context.previousQuestion ? [context.previousQuestion] : [] });
  const groups = plan.intent === "multi_intent" ? operationGroups(plan) : [];
  if (groups.length <= 1) return queryRagOperation(body, client, context, options, plan);

  const results = await Promise.all(groups.map((requests) => queryRagOperation(
    { question: operationQuestion(requests) }, client, {}, options,
    { ...plan, intent: requests.length > 1 && requests[0]?.intent !== "comparison" ? "multi_intent" : requests[0]!.intent, requests },
  ).catch((error: unknown) => {
    if (!(error instanceof ApiError) || error.statusCode !== 503 || error.code !== "RAG_UNAVAILABLE") throw error;
    return {
      status: "insufficient_evidence" as const,
      answer: "Phần thông tin cần phân tích bằng AI tạm thời chưa sẵn sàng. Mình chỉ trả phần dữ liệu đã đối chiếu được; bạn có thể thử lại phần thông tin còn thiếu.",
      items: [], sources: [],
      retrieval: { vectorChunks: 0, lexicalProducts: 0, embeddingModel: "not_used" },
    };
  })));
  const itemsById = new Map<number, (typeof results)[number]["items"][number]>();
  for (const result of results) for (const item of result.items) {
    const existing = itemsById.get(item.id);
    itemsById.set(item.id, existing ? {
      ...item,
      prices: [...new Map([...existing.prices, ...item.prices].map((price) => [price.id, price])).values()],
    } : item);
  }
  const items = [...itemsById.values()];
  const sources = [...new Map(results.flatMap((result) => result.sources).map((source) => [source.chunkId, source])).values()];
  const answer = results.map((result) => result.answer).join("\n\n");
  const answerBlocks = results.flatMap((result) => "answerBlocks" in result ? result.answerBlocks ?? [] : []);
  const catalogResults = results.filter((result) => "catalogPage" in result);
  const status = results.some((result) => result.status === "insufficient_evidence") ? "insufficient_evidence" as const
    : results.some((result) => result.status === "clarify") ? "clarify" as const : "answered" as const;
  return {
    status, answer, items, sources,
    ...(answerBlocks.length ? { answerBlocks } : {}),
    ...(catalogResults.length === 1 && "catalogPage" in catalogResults[0]! ? { catalogPage: catalogResults[0].catalogPage } : {}),
    retrieval: {
      vectorChunks: results.reduce((sum, result) => sum + result.retrieval.vectorChunks, 0),
      lexicalProducts: results.reduce((sum, result) => sum + result.retrieval.lexicalProducts, 0),
      embeddingModel: results.find((result) => result.retrieval.embeddingModel !== "not_used")?.retrieval.embeddingModel ?? "not_used",
      trace: { question: originalQuestion, answer, chunkIds: sources.map((source) => source.chunkId), variantIds: items.map((item) => item.id), priceIds: items.flatMap((item) => item.prices.map((price) => price.id)) },
    },
  };
}
