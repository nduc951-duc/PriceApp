import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "./auth.service.js";
import { ApiError } from "../middleware/errors.js";
import { ragPagesRepository } from "../repositories/rag-pages.repository.js";
import { DEFAULT_CHUNK_SETTINGS, type RagChunkSettings } from "../rag/chunking.js";

type PageRow = {
  source_page_id: number; title: string; extracted_text: string; review_status: "draft" | "approved" | "rejected"; revision: number;
  reviewed_by: string | null; reviewed_at: string | null; updated_at: string;
  chunk_settings: RagChunkSettings; chunk_links: Record<string, number>;
  source_pages: { page_number: number | null; storage_path: string; verification_status: string };
};
type VariantRow = { id: number; display_name: string; raw_specification: string | null; products: { name: string } | null; variant_sources: { source_page_id: number }[] };

export async function listRagPages(client: SupabaseClient, includeOwnerDetails = true) {
  const repo = ragPagesRepository(client);
  const { data, error } = await repo.list();
  if (error) throw new Error("RAG repository unavailable");
  const rows = (data ?? []) as unknown as PageRow[];
  const ids = rows.map((row) => row.source_page_id);
  const [generationResult, variantsResult, runResult] = includeOwnerDetails
    ? await Promise.all([
      repo.activeGeneration(), ids.length ? repo.variants(ids) : Promise.resolve({ data: [], error: null }), repo.latestRun(),
    ])
    : [{ data: { active_generation: 0 }, error: null }, { data: [], error: null }, { data: null, error: null }];
  if (generationResult.error || variantsResult.error || runResult.error) throw new Error("RAG repository unavailable");
  const generation = generationResult.data?.active_generation ?? 0;
  const indexedChunks: Array<{ source_page_id: number; updated_at: string }> = [];
  for (let start = 0; includeOwnerDetails; start += 500) {
    const indexedResult = await repo.indexedChunks(generation, start, start + 499);
    if (indexedResult.error) throw new Error("RAG repository unavailable");
    indexedChunks.push(...(indexedResult.data ?? []));
    if (!indexedResult.data || indexedResult.data.length < 500) break;
  }
  const indexStats = new Map<number, { chunks: number; indexedAt: string | null }>();
  for (const chunk of indexedChunks) {
    const current = indexStats.get(chunk.source_page_id) ?? { chunks: 0, indexedAt: null };
    current.chunks++;
    if (!current.indexedAt || chunk.updated_at > current.indexedAt) current.indexedAt = chunk.updated_at;
    indexStats.set(chunk.source_page_id, current);
  }
  const variantsByPage = new Map<number, { id: number; name: string }[]>();
  for (const variant of (variantsResult.data ?? []) as unknown as VariantRow[]) {
    for (const source of variant.variant_sources ?? []) {
      if (!ids.includes(source.source_page_id)) continue;
      const list = variantsByPage.get(source.source_page_id) ?? [];
      list.push({ id: variant.id, name: `${variant.products?.name ?? "Mặt hàng"} · ${variant.raw_specification ?? variant.display_name}` });
      variantsByPage.set(source.source_page_id, list);
    }
  }
  const indexError = runResult.data?.status === "failed" ? "Lần lập chỉ mục gần nhất bị gián đoạn; có thể chạy tiếp sau khi xử lý cấu hình." : null;
  const pages = rows.map((row) => {
    const stats = indexStats.get(row.source_page_id) ?? { chunks: 0, indexedAt: null };
    return {
      sourcePageId: row.source_page_id, pageNumber: row.source_pages.page_number, storagePath: row.source_pages.storage_path,
      sourceStatus: row.source_pages.verification_status, title: row.title, extractedText: row.extracted_text,
      reviewStatus: row.review_status, revision: row.revision,
      reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, updatedAt: row.updated_at,
      chunkSettings: row.chunk_settings ?? DEFAULT_CHUNK_SETTINGS, chunkLinks: row.chunk_links ?? {},
      chunkCount: stats.chunks, indexedAt: stats.indexedAt, indexError: indexError && row.review_status === "approved" ? indexError : null,
      variants: variantsByPage.get(row.source_page_id) ?? [],
    };
  });
  return { pages };
}

export async function saveRagPage(body: unknown, auth: AuthContext) {
  const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const sourcePageId = Number(input.sourcePageId);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const extractedText = typeof input.extractedText === "string" ? input.extractedText.trim() : "";
  const reviewStatus = input.reviewStatus;
  const rawSettings = typeof input.chunkSettings === "object" && input.chunkSettings !== null ? input.chunkSettings as Record<string, unknown> : DEFAULT_CHUNK_SETTINGS;
  const chunkSettings = { maxCharacters: Number(rawSettings.maxCharacters), overlapCharacters: Number(rawSettings.overlapCharacters) };
  const rawLinks = typeof input.chunkLinks === "object" && input.chunkLinks !== null && !Array.isArray(input.chunkLinks) ? input.chunkLinks as Record<string, unknown> : {};
  if (!Number.isInteger(sourcePageId) || sourcePageId < 1 || title.length > 200 || extractedText.length > 100_000) {
    throw new ApiError(400, "INVALID_INPUT", "Thông tin trang không hợp lệ hoặc văn bản vượt quá 100.000 ký tự.");
  }
  if (!Number.isInteger(chunkSettings.maxCharacters) || chunkSettings.maxCharacters < 200 || chunkSettings.maxCharacters > 4_000 ||
      !Number.isInteger(chunkSettings.overlapCharacters) || chunkSettings.overlapCharacters < 0 || chunkSettings.overlapCharacters >= chunkSettings.maxCharacters) {
    throw new ApiError(400, "INVALID_INPUT", "Cấu hình chia đoạn không hợp lệ.");
  }
  if (Object.keys(rawLinks).length > 500 || Object.entries(rawLinks).some(([key, value]) => !/^\d+:\d+$/.test(key) || !Number.isInteger(value) || Number(value) < 1)) {
    throw new ApiError(400, "INVALID_INPUT", "Liên kết sản phẩm trong preview không hợp lệ.");
  }
  if (reviewStatus !== "draft" && reviewStatus !== "approved" && reviewStatus !== "rejected") throw new ApiError(400, "INVALID_INPUT", "Trạng thái duyệt không hợp lệ.");
  if (auth.role !== "owner" && reviewStatus !== "draft") throw new ApiError(403, "FORBIDDEN", "Only owners can approve or reject RAG pages");
  if (auth.role !== "owner" && Object.keys(rawLinks).length) throw new ApiError(403, "FORBIDDEN", "Only owners can link approved products to RAG chunks");
  if (auth.role !== "owner") {
    const { data: existing, error: existingError } = await auth.client.from("rag_page_texts")
      .select("review_status").eq("source_page_id", sourcePageId).maybeSingle();
    if (existingError) throw new Error("RAG repository unavailable");
    if (existing && existing.review_status !== "draft") throw new ApiError(403, "FORBIDDEN", "Only owners can change reviewed RAG pages");
  }
  if (reviewStatus === "approved" && !extractedText) throw new ApiError(400, "INVALID_INPUT", "Cần nhập nội dung trang trước khi duyệt.");

  const requestedVariantIds = [...new Set(Object.values(rawLinks).map(Number))];
  if (requestedVariantIds.length) {
    const { data, error } = await auth.client.from("product_variants").select("id,variant_sources!inner(source_page_id)")
      .in("id", requestedVariantIds).eq("active", true).eq("verification_status", "verified");
    if (error) throw new Error("RAG repository unavailable");
    const eligible = new Set((data ?? []).flatMap((row) => (row.variant_sources as Array<{ source_page_id: number }>).map((source) => `${row.id}:${source.source_page_id}`)));
    if (requestedVariantIds.some((id) => !eligible.has(`${id}:${sourcePageId}`))) throw new ApiError(400, "INVALID_INPUT", "Chỉ có thể gắn mặt hàng đã xác minh và cùng trang nguồn.");
  }
  const { data, error } = await ragPagesRepository(auth.client).save({
    source_page_id: sourcePageId, title: title || `Sổ giá - Trang ${sourcePageId}`, extracted_text: extractedText,
    review_status: reviewStatus, chunk_settings: chunkSettings, chunk_links: rawLinks,
    reviewed_by: reviewStatus === "approved" ? auth.user.id : null,
    reviewed_at: reviewStatus === "approved" ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error("RAG repository unavailable");
  return { saved: true, reviewStatus, revision: data.revision };
}
