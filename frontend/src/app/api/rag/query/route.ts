import { authenticateRagRequest } from "@/lib/rag/auth";
import { ragJson } from "@/lib/rag/http";
import { embedTexts, embeddingModel, generateGroundedAnswer } from "@/lib/rag/provider";
import { rankVariantIds } from "@/lib/rag/rank";
import { priceAnswer } from "@/lib/rag/price-answer";

export const runtime = "nodejs";
export const maxDuration = 90;

type Match = { id: number; chunk_key: string; source_page_id: number; product_variant_id: number | null; content: string; metadata: Record<string, unknown>; similarity: number };
type PriceRow = { id: number; amount: number | string; price_type: string; minimum_quantity: number | string; active: boolean; valid_from: string; valid_to: string | null; price_lists: { name: string; effective_date: string; suppliers: { name: string } | null } | null };
type CatalogRow = {
  id: number; display_name: string; raw_specification: string | null; verification_status: string;
  products: { name: string; categories: { name: string } | null; product_aliases: { alias: string }[] | null } | null;
  packaging_options: { id: number; name: string; quantity: number | string; base_unit: string; note: string | null; prices: PriceRow[] }[];
};
type EligibleSource = { product_variant_id: number; source_page_id: number; page_number: number | null };

export async function POST(request: Request) {
  const auth = await authenticateRagRequest(request);
  if (!auth.ok) return ragJson({ error: auth.error }, { status: auth.status });
  try {
    const input = await request.json() as { question?: unknown };
    const question = typeof input.question === "string" ? input.question.trim() : "";
    if (!question || question.length > 1000) return ragJson({ error: "Nhập câu hỏi từ 1 đến 1.000 ký tự." }, { status: 400 });

    const model = embeddingModel();
    const [queryVector] = await embedTexts([question]);
    if (!queryVector) throw new Error("Không tạo được embedding cho câu hỏi.");
    const vector = `[${queryVector.join(",")}]`;
    const [{ data: vectorData, error: vectorError }, { data: lexicalData, error: lexicalError }] = await Promise.all([
      auth.client.rpc("match_rag_chunks", { p_embedding: vector, p_embedding_model: model, p_match_count: 8 }),
      auth.client.rpc("search_catalog", { query: question, result_limit: 8, filter_category_id: null }),
    ]);
    if (vectorError) throw new Error(`Tìm chunk trong pgvector thất bại. Kiểm tra migration RAG và lập chỉ mục: ${vectorError.message}`);
    if (lexicalError) throw new Error(`Tìm tên/quy cách trong catalog thất bại: ${lexicalError.message}`);
    const chunks = ((vectorData ?? []) as unknown as Match[]).filter((item) => item.similarity >= 0.20);
    const lexicalIds = ((lexicalData ?? []) as unknown as Array<{ id: number; result_type?: string; relevance?: number }>).filter((row) => row.result_type === "variant").map((row) => Number(row.id)).filter(Number.isFinite);
    const ids = rankVariantIds(chunks.map((chunk) => chunk.product_variant_id).filter((id): id is number => id !== null), lexicalIds);

    let catalog: CatalogRow[] = [];
    const eligiblePages = new Map<number, number[]>();
    if (ids.length) {
      const { data, error } = await auth.client.from("product_variants").select(
        "id,display_name,raw_specification,verification_status,products!inner(name,categories(name),product_aliases(alias)),packaging_options(id,name,quantity,base_unit,note,prices(id,amount,price_type,minimum_quantity,active,valid_from,valid_to,price_lists(name,effective_date,suppliers(name))))",
      ).in("id", ids).eq("active", true).eq("verification_status", "verified");
      if (error) throw new Error(`Không lấy được giá chuẩn từ PostgreSQL: ${error.message}`);
      const { data: sourceData, error: sourceError } = await auth.client.rpc("current_rag_variant_sources", { p_variant_ids: ids });
      if (sourceError) throw new Error(`Không kiểm tra được nguồn catalog còn hiệu lực. Kiểm tra migration thu hồi nguồn: ${sourceError.message}`);
      for (const source of (sourceData ?? []) as EligibleSource[]) {
        if (source.page_number === null) continue;
        eligiblePages.set(source.product_variant_id, [...(eligiblePages.get(source.product_variant_id) ?? []), source.page_number]);
      }
      catalog = ((data ?? []) as unknown as CatalogRow[]).filter((row) => eligiblePages.has(row.id));
      const order = new Map(ids.map((id, index) => [id, index]));
      catalog.sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99));
    }

    const sourceIds = [...new Set(chunks.map((chunk) => chunk.source_page_id))];
    const sourcePages = sourceIds.length ? await auth.client.from("source_pages").select("id,page_number").in("id", sourceIds) : { data: [], error: null };
    if (sourcePages.error) throw new Error(`Không tải được thông tin trang nguồn: ${sourcePages.error.message}`);
    const pageNumbers = new Map((sourcePages.data ?? []).map((page) => [page.id, page.page_number]));
    const now = Date.now();
    const items = catalog.map((row) => {
      const pages = [...new Set(eligiblePages.get(row.id) ?? [])];
      const prices = row.packaging_options.flatMap((pack) => pack.prices
        .filter((price) => price.active && Date.parse(price.valid_from) <= now && (!price.valid_to || Date.parse(price.valid_to) >= now))
        .map((price) => ({
          id: price.id, amount: Number(price.amount), priceType: price.price_type,
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
      return ragJson({
        answer: "Mình chưa tìm thấy tài liệu hoặc mặt hàng đủ liên quan để trả lời. Hãy kiểm tra câu hỏi, trạng thái duyệt của tài liệu và việc lập chỉ mục embedding.",
        items: [], sources: [], retrieval: { vectorChunks: 0, lexicalProducts: 0, embeddingModel: model },
      });
    }
    const asksForPrice = /giá|bao nhiêu|báo giá|giá sỉ|giá lẻ|đồng|vnđ/i.test(question) && !/trang nào|nguồn nào|trích dẫn/i.test(question);
    const answer = asksForPrice
      ? priceAnswer(items)
      : await generateGroundedAnswer({ question, evidence: uniqueEvidence });
    const sources = [...new Map(uniqueEvidence.filter((item) => item.page !== null).map((item) => [item.page!, { pageNumber: item.page!, excerpt: item.content.slice(0, 500) }])).values()];
    const trace = { question, chunkIds: chunks.map((chunk) => chunk.id), variantIds: items.map((item) => item.id), priceIds: items.flatMap((item) => item.prices.map((price) => price.id)), answer };
    return ragJson({ answer, items, sources, retrieval: { vectorChunks: chunks.length, lexicalProducts: lexicalIds.length, embeddingModel: model, trace } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không thể xử lý câu hỏi RAG.";
    const status = /chưa được cấu hình/.test(message) ? 503 : 500;
    return ragJson({ error: status === 503 ? "Dịch vụ RAG chưa được cấu hình." : "Không thể xử lý câu hỏi RAG." }, { status });
  }
}
