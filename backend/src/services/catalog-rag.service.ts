import type { SupabaseClient } from "@supabase/supabase-js";
import { ragCatalogRepository, type RagCatalogVariant, type CatalogPrice } from "../repositories/rag-catalog.repository.js";
import { ragChunksRepository } from "../repositories/rag-chunks.repository.js";
import { canonicalCatalogQuery } from "../rag/catalog-measurements.js";
import { matchesExplicitPackage, matchesExplicitQuery, matchesNamedCandidate } from "../rag/candidate-filters.js";
import { catalogIdentityQuestion, understandQuery, withoutConversationPhrases } from "../rag/query-understanding.js";
import { embedTexts, embeddingModel, generateGroundedResponseText } from "../rag/provider.js";
import { buildEvidencePacket } from "../rag/evidence.js";
import { validateGroundedResponse } from "../rag/grounded-response.js";
import { buildCitations } from "../rag/citations.js";
import { priceAnswer } from "../rag/price-answer.js";
import { catalogSpecificationMeaning } from "../rag/catalog-specification.js";
import type { RagQueryPlan } from "../rag/query-plan.js";

type Chunk = { id: number; product_variant_id: number; content: string; similarity: number;
  chunk_key?: string; source_page_id?: number; source_revision?: number; source_start?: number; source_end?: number;
  metadata: { kind?: string; page_number?: number } };

const conversationTerms = new Set(["bạn", "ban", "bên", "ben", "muốn", "muon", "tìm", "tim", "xem", "giúp", "giup", "không", "khong", "thế", "the", "sao", "đang", "dang"]);
const compactIdentity = (value: string) => value.toLocaleLowerCase("vi").replace(/đ/g, "d").normalize("NFD").replace(/\p{M}/gu, "").replace(/[^a-z0-9]/gu, "");

function candidate(row: RagCatalogVariant) {
  return { productName: row.products?.name ?? row.display_name,
    variant: canonicalCatalogQuery(row.raw_specification ?? row.display_name),
    aliases: row.products?.product_aliases.map(alias => alias.alias) ?? [],
    packages: row.packaging_options.map(pack => ({ name: pack.name, quantity: Number(pack.quantity), unit: pack.base_unit, activeTiers: [] })) };
}

function currentPrice(price: CatalogPrice, row: RagCatalogVariant, publicOnly: boolean, now: number): boolean {
  const active = (p: CatalogPrice) => p.active && p.price_lists?.suppliers?.active !== false
    && Date.parse(p.valid_from) <= now && (!p.valid_to || Date.parse(p.valid_to) > now);
  if (!active(price) || (publicOnly && price.price_type === "dealer")) return false;
  if (price.price_lists?.is_sample !== true) return true;
  return price.price_lists.is_demo === true && !row.packaging_options.some(pack => pack.prices.some(p => active(p) && p.price_lists?.is_sample !== true));
}

/** Model understanding -> hybrid retrieval -> current SQL evidence -> validated generation. */
export async function queryCatalogRag(question: string, plan: RagQueryPlan, client: SupabaseClient, publicOnly: boolean) {
  const request = plan.requests[0]!;
  const repo = ragCatalogRepository(client, publicOnly);
  const identityQuestion = withoutConversationPhrases(question, plan.conversationPhrases ?? [], plan.requests.map(request => request.productText ?? ""));
  const literal = understandQuery(canonicalCatalogQuery(catalogIdentityQuestion(identityQuestion)));
  if (!literal.nameTerms.length && !literal.aliases.length && !request.categoryText) {
    return { status: "clarify" as const, answer: "Bạn muốn xem quy cách của mặt hàng nào?", items: [], sources: [],
      catalogPage: { total: 0, complete: false, nextCursor: null },
      retrieval: { vectorChunks: 0, lexicalProducts: 0, embeddingModel: "not_used" } };
  }
  const modelIdentity = understandQuery(request.productText ?? "");
  const productText = [...modelIdentity.aliases, ...modelIdentity.nameTerms].join(" ")
    || [...literal.aliases, ...literal.nameTerms].join(" ");
  const material = literal.material ?? request.material ?? modelIdentity.material;
  let identity = [productText, material].filter(Boolean).join(" ");
  const literalNames = [...literal.aliases, ...literal.nameTerms.filter(term => !conversationTerms.has(term.toLocaleLowerCase("vi")))];
  const literalIdentity = [...literalNames, literal.material].filter(Boolean).join(" ");
  const literalSpecs = [...literal.dimensions, ...literal.specCodes];
  const specifications = canonicalCatalogQuery(literalSpecs.length ? literalSpecs.join(" ") : request.specifications.join(" "));
  const filter = [material, specifications].filter(Boolean).join(" ");
  const tier = literal.tier ?? request.priceTier;
  const asksPrice = request.intent === "price_lookup" || request.requestedFields.includes("price");

  // Semantic failure may degrade retrieval, but it must never conceal a SQL failure.
  let model = "not_used";
  const semantic = (async (): Promise<Chunk[]> => {
    let selected: string;
    let vector: number[] | undefined;
    try {
      selected = embeddingModel();
      [vector] = await embedTexts([question]);
    } catch { return []; }
    if (!vector?.length) return [];
    const result = await ragChunksRepository(client, publicOnly).match(`[${vector.join(",")}]`, selected);
    if (result.error) throw new Error("RAG semantic retrieval unavailable");
    model = selected;
    return ((result.data ?? []) as Chunk[]).filter(chunk => chunk.metadata?.kind === "verified_catalog"
      && Number.isSafeInteger(chunk.product_variant_id) && chunk.similarity >= 0.2);
  })();
  const readPages = async (query: string) => {
    const rows = new Map<number, RagCatalogVariant>();
    let cursor: number | null = null;
    let complete = false;
    let total = 0;
    for (let page = 0; page < 100; page++) {
      const result = await repo.searchCatalogPage(query, cursor, 50, request.categoryText ?? null);
      if (result.error || !result.data) throw new Error("RAG catalog retrieval unavailable");
      total = result.data.total;
      for (const row of result.data.items) rows.set(row.id, row);
      cursor = result.data.nextCursor;
      if (cursor === null) { complete = true; break; }
    }
    return { rows, complete, cursor, total };
  };
  const [chunks, modelCatalog, literalCatalog] = await Promise.all([semantic, readPages(identity),
    literalIdentity && literalIdentity.toLocaleLowerCase("vi") !== identity.toLocaleLowerCase("vi") ? readPages(literalIdentity) : Promise.resolve(null),
  ]);
  // A family explicitly named by the user and supported by SQL outranks model extraction.
  const literalSupported = literalCatalog && [...literalCatalog.rows.values()].some(row => matchesNamedCandidate(candidate(row), literalIdentity));
  const catalog = literalSupported ? literalCatalog! : modelCatalog;
  if (literalSupported) identity = literalIdentity;
  if (!catalog.rows.size && chunks.length) {
    const expanded = await repo.expandVerifiedGroups([...new Set(chunks.map(chunk => chunk.product_variant_id))]);
    if (expanded.error) throw new Error("RAG semantic catalog retrieval unavailable");
    for (const row of expanded.data ?? []) catalog.rows.set(row.id, row);
    // Vector top-k cannot establish an exhaustive product listing.
    catalog.complete = false;
  }
  const family = [...catalog.rows.values()].filter(row => row.verification_status === "verified"
    && matchesNamedCandidate(candidate(row), identity)
    && (matchesNamedCandidate(candidate(row), literalIdentity)
      || (compactIdentity(literalNames.join(" ")).length >= 3
        && [row.products?.name ?? row.display_name, ...(row.products?.product_aliases.map(alias => alias.alias) ?? [])]
          .some(name => compactIdentity(name).includes(compactIdentity(literalNames.join(" "))))))
    && (!material || matchesExplicitQuery(candidate(row), material)));
  const matched = family.filter(row => !filter || matchesExplicitQuery(candidate(row), filter));
  // An exact dimension is never relaxed into an orderable result.
  const diameter = /^\s*(\d+(?:[.,]\d+)?)\s*x/u.exec(specifications)?.[1];
  const alternatives = matched.length ? [] : family.filter(row => !diameter || matchesExplicitQuery(candidate(row), `${diameter} mm`)).slice(0, 8);
  const evidenceRows = matched.length ? matched : alternatives;
  const relevantIds = new Set(evidenceRows.map(row => row.id));
  const supportedChunks = chunks.filter(chunk => relevantIds.has(chunk.product_variant_id));
  const rank = new Map(supportedChunks.map((chunk, index) => [chunk.product_variant_id, index]));
  matched.sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99));
  const now = Date.now();
  const items = matched.map(row => ({ id: row.id, productName: row.products?.name ?? row.display_name,
    category: row.products?.categories?.name ?? "Vật tư", variant: row.raw_specification ?? row.display_name,
    verificationStatus: row.verification_status, sourcePages: row.source_pages ?? [],
    prices: row.packaging_options.filter(pack => matchesExplicitPackage({ name: pack.name,
      quantity: Number(pack.quantity), unit: pack.base_unit,
      activeTiers: pack.prices.filter(p => currentPrice(p, row, publicOnly, now)).map(p => p.price_type as "retail" | "wholesale" | "dealer"),
    }, question)).flatMap(pack => pack.prices.filter(p => currentPrice(p, row, publicOnly, now) && (!tier || p.price_type === tier)).map(p => ({
      id: p.id, packagingId: pack.id, version: Number(p.version), amount: Number(p.amount), priceType: p.price_type,
      minimumQuantity: Number(p.minimum_quantity), packagingName: pack.name, packageQuantity: Number(pack.quantity),
      unit: pack.base_unit, packageNote: pack.note ?? "", priceList: p.price_lists?.name ?? null,
      supplier: p.price_lists?.suppliers?.name ?? null, isDemo: p.price_lists?.is_demo === true, purchasable: true,
      verificationStatus: row.verification_status,
    }))),
  }));
  const packet = buildEvidencePacket({ role: publicOnly ? "customer" : "staff", prices: [], documents: [],
    variants: evidenceRows.slice(0, 16).map(row => ({ id: row.id, productId: row.product_id, productName: row.products?.name ?? row.display_name,
      variant: row.raw_specification ?? row.display_name, category: row.products?.categories?.name ?? "Vật tư",
      aliases: row.products?.product_aliases.map(alias => alias.alias) ?? [],
      attributes: Object.fromEntries(Object.entries(row.attributes ?? {}).filter(([, value]) => value === null || ["string", "number", "boolean"].includes(typeof value))) as Record<string, string | number | boolean | null>, active: true,
      verificationStatus: row.verification_status, sourcePages: row.source_pages ?? [],
    })), catalogPage: { total: matched.length, complete: catalog.complete, nextCursor: catalog.cursor },
  });
  let introduction = "";
  try {
    // Numeric specifications and prices are rendered from SQL below. Give the
    // language model only the grounded identity and match outcome for its prose.
    const raw = await generateGroundedResponseText({ question,
      plan: { intent: plan.intent, requestedFields: request.requestedFields,
        matchStatus: matched.length ? "exact" : "no_exact_match", alternativesOnly: !matched.length },
      evidence: packet.entries.map(entry => ({ id: entry.id, kind: entry.kind,
        summary: entry.kind === "catalog" ? JSON.stringify({ productName: entry.productName, category: entry.category }) : JSON.stringify(entry) })),
    });
    const validated = validateGroundedResponse(raw, packet, { allowCatalogFacts: true });
    if (validated.valid && (matched.length || validated.blocks.every(block => block.kind === "clarification"))) introduction = validated.blocks.map(block => block.text).join("\n");
  } catch { /* Return SQL evidence when answer generation is temporarily unavailable. */ }
  const facts = matched.map(row => {
    const packages = row.packaging_options.map(pack => `${pack.name}: ${Number(pack.quantity)} ${pack.base_unit}`).join("; ");
    const meaning = catalogSpecificationMeaning(row.raw_specification ?? row.display_name, [row.products?.name, row.products?.categories?.name]);
    const attributeLabels: Record<string, string> = { material: "Chất liệu", color: "Màu sắc", finish: "Bề mặt", brand: "Thương hiệu" };
    const attributes = Object.entries(row.attributes ?? {}).filter(([key, value]) => attributeLabels[key] && value !== null && value !== "")
      .map(([key, value]) => `${attributeLabels[key]}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join("; ");
    return `• ${row.products?.name ?? row.display_name} — ${row.raw_specification ?? row.display_name}${packages ? `. Đóng gói: ${packages}` : ""}.${meaning ? ` ${meaning}.` : ""}${attributes ? ` ${attributes}.` : ""}${row.products?.description ? ` ${row.products.description}` : ""}`;
  }).join("\n");
  const noExact = `${specifications ? "Chưa tìm thấy đúng quy cách bạn yêu cầu trong phần danh mục đã tra." : "Chưa tìm thấy mặt hàng phù hợp với yêu cầu trong phần danh mục đã tra."}${alternatives.length
    ? ` Các quy cách cùng nhóm tìm được (chưa phải đúng quy cách yêu cầu):\n${alternatives.map(row => `• ${row.products?.name ?? row.display_name} — ${row.raw_specification ?? row.display_name}`).join("\n")}`
    : " Bạn kiểm tra lại tên hàng hoặc quy cách giúp mình."}`;
  const summary = catalog.complete ? `${matched.length} quy cách phù hợp trong danh mục đã xác minh.` : "Danh sách chưa tải hết; các dòng dưới đây chỉ là phần đã truy xuất được.";
  const groups = new Map<string, typeof matched>();
  for (const row of matched) {
    const name = row.products?.name ?? row.display_name;
    groups.set(name, [...groups.get(name) ?? [], row]);
  }
  const productDiscovery = request.requestedFields.includes("products");
  const groupedFacts = `${groups.size} nhóm sản phẩm tìm được${catalog.complete ? "" : " trong phần danh mục đã tải"}:\n${[...groups].map(([name, rows]) => `• ${name}: ${rows.length} quy cách`).join("\n")}`;
  const answer = [matched.length ? introduction : noExact, matched.length ? (productDiscovery ? groupedFacts : asksPrice ? priceAnswer(items) : `${summary}\n${facts}`) : introduction].filter(Boolean).join("\n");
  const sources = buildCitations(supportedChunks.map(chunk => ({ chunkId: chunk.id, chunkKey: chunk.chunk_key,
    pageNumber: chunk.metadata.page_number, excerpt: chunk.content, evidenceKind: "verified_catalog",
    verifiedVariantId: chunk.product_variant_id, sourceRevision: chunk.source_revision,
    sourceSpan: chunk.source_start !== undefined && chunk.source_end !== undefined ? { start: chunk.source_start, end: chunk.source_end } : null,
  })));
  return {
    status: matched.length && (!asksPrice || items.some(item => item.prices.length)) ? "answered" as const : "insufficient_evidence" as const,
    answer, items: productDiscovery ? [] : items, sources,
    catalogPage: { total: catalog.complete ? matched.length : catalog.total, complete: catalog.complete, nextCursor: catalog.cursor },
    retrieval: { vectorChunks: supportedChunks.length, lexicalProducts: matched.length, embeddingModel: model,
      trace: { question, chunkIds: supportedChunks.map(chunk => chunk.id), variantIds: items.map(item => item.id),
        priceIds: items.flatMap(item => item.prices.map(price => price.id)), answer } },
  };
}
