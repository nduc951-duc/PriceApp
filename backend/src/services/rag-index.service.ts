import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";
import { ragChunksRepository, allRagRows } from "../repositories/rag-chunks.repository.js";
import { ragPagesRepository } from "../repositories/rag-pages.repository.js";
import { ragCatalogRepository } from "../repositories/rag-catalog.repository.js";
import { createHash } from "node:crypto";
import { CHUNKER_VERSION, chunkRecords, chunkText, DEFAULT_CHUNK_SETTINGS, type RagChunkSettings } from "../rag/chunking.js";
import { EMBEDDING_DIMENSIONS, embedTexts, embeddingModel, embeddingFingerprint, RagProviderUnavailableError } from "../rag/provider.js";


type PageText = { source_page_id: number; title: string; extracted_text: string; revision: number; chunk_settings: RagChunkSettings; chunk_links: Record<string, number>; source_pages: { page_number: number | null; verification_status: string } | null };
type Variant = {
  id: number; display_name: string; raw_specification: string | null; search_text: string; attributes: Record<string, unknown>;
  products: { name: string; categories: { name: string } | null; product_aliases: { alias: string }[] | null } | null;
  variant_sources: { source_page_id: number; source_pages: { page_number: number | null; verification_status: string } | null }[];
  packaging_options?: { name: string; quantity: number | string; base_unit: string; note: string | null }[];
};
type DraftChunk = { chunk_key: string; source_page_id: number; source_revision: number | null; product_variant_id: number | null; chunk_index: number; chunker_version: string; source_start: number | null; source_end: number | null; content: string; content_hash: string; metadata: Record<string, unknown> };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const BATCH_SIZE = 16;
export class RagIndexFailure extends ApiError {
  constructor(public readonly diagnosticCode: string, message: string) {
    super(500, "INTERNAL_ERROR", message);
  }
}
function databaseCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error) || typeof error.code !== "string") return "";
  return /^[A-Z0-9]{3,8}$/.test(error.code) ? `_${error.code}` : "";
}
async function retry<T>(operation: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await operation(); } catch (error) { last = error; if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1))); }
  }
  throw last;
}
export async function latestRagIndex(client: SupabaseClient) {
  const { data, error } = await ragChunksRepository(client).latestRun();
  if (error) throw new Error("RAG repository unavailable");
  return { run: data ? {
    runId: data.id, status: data.status, checkpoint: data.checkpoint, chunks: data.total_chunks,
    indexed: data.changed, reused: data.reused, removed: data.removed,
    embeddingModel: data.model, contentHash: data.corpus_hash,
  } : null };
}

export async function indexRag(client: SupabaseClient) {
  const chunksRepo = ragChunksRepository(client);
  const pagesRepo = ragPagesRepository(client);
  const catalogRepo = ragCatalogRepository(client);
  let stage = "load_corpus";
  try {
    const [pageData, rejectedData, variantData] = await Promise.all([
      allRagRows((start, end) => pagesRepo.approved(start, end)),
      allRagRows((start, end) => pagesRepo.rejected(start, end)),
      allRagRows((start, end) => catalogRepo.verified(start, end)),
    ]);
    const pages = ((pageData ?? []) as unknown as PageText[]).filter((page) => page.source_pages?.verification_status !== "unreadable");
    const variants = (variantData ?? []) as unknown as Variant[];
    const rejectedPageIds = new Set((rejectedData as Array<{ source_page_id: number }>).map((row) => row.source_page_id));
    const drafts: DraftChunk[] = [];

    for (const page of pages) {
      const pageNumber = page.source_pages?.page_number ?? null;
      const settings = page.chunk_settings ?? DEFAULT_CHUNK_SETTINGS;
      for (const chunk of chunkRecords(page.extracted_text, settings)) {
        const content = [page.title || `Sổ giá - Trang ${pageNumber ?? "?"}`, chunk.heading ? `Nhóm: ${chunk.heading}` : "", chunk.content].filter(Boolean).join("\n");
        const variantId = page.chunk_links?.[`${chunk.start}:${chunk.end}`] ?? null;
        drafts.push({
          chunk_key: `page:${page.source_page_id}:ocr:${chunk.index}`, source_page_id: page.source_page_id, source_revision: page.revision,
          product_variant_id: variantId, chunk_index: chunk.index, chunker_version: CHUNKER_VERSION, source_start: chunk.start, source_end: chunk.end, content, content_hash: hash(content),
          metadata: { kind: "approved_page_ocr", page_number: pageNumber, title: page.title, heading: chunk.heading, source_text: chunk.content, start_char: chunk.start, end_char: chunk.end },
        });
      }
    }

    for (const variant of variants) {
      const product = variant.products;
      if (!product) continue;
      const aliases = product.product_aliases?.map((item) => item.alias).filter(Boolean) ?? [];
      const packages = [...(variant.packaging_options ?? [])]
        .sort((left, right) => left.name.localeCompare(right.name) || Number(left.quantity) - Number(right.quantity) || left.base_unit.localeCompare(right.base_unit));
      const text = [
        `Danh mục: ${product.categories?.name ?? "Vật tư"}`,
        `Tên sản phẩm: ${product.name}`,
        aliases.length ? `Tên gọi khác: ${[...new Set(aliases)].join(", ")}` : "",
        `Quy cách: ${variant.raw_specification ?? variant.display_name}`,
        `Thông tin nhận diện: ${variant.search_text}`,
        Object.keys(variant.attributes ?? {}).length ? `Thuộc tính: ${JSON.stringify(variant.attributes)}` : "",
        packages.length ? `Đóng gói/đơn vị: ${packages.map((pack) => `${pack.name} · ${new Intl.NumberFormat("vi-VN").format(Number(pack.quantity))} ${pack.base_unit}${pack.note ? ` · ${pack.note}` : ""}`).join("; ")}` : "",
      ].filter(Boolean).join("\n");
      const linkedPages = variant.variant_sources.length ? variant.variant_sources : [{ source_page_id: 0, source_pages: null }];
      for (const source of linkedPages) {
        if (!source.source_page_id || rejectedPageIds.has(source.source_page_id) || source.source_pages?.verification_status === "unreadable") continue;
        for (const chunk of chunkText(text)) {
          const content = chunk.content;
          drafts.push({
            chunk_key: `page:${source.source_page_id}:variant:${variant.id}:${chunk.index}`,
            source_page_id: source.source_page_id, source_revision: null, product_variant_id: variant.id, chunk_index: chunk.index,
            chunker_version: CHUNKER_VERSION, source_start: null, source_end: null, content, content_hash: hash(content),
            metadata: { kind: "verified_catalog", page_number: source.source_pages?.page_number ?? null, product_name: product.name, variant_name: variant.display_name, start_char: chunk.start, end_char: chunk.end },
          });
        }
      }
    }

    drafts.sort((a, b) => a.chunk_key.localeCompare(b.chunk_key));
    stage = "start_generation";
    const model = embeddingModel();
    const fingerprint = `${CHUNKER_VERSION}:${await embeddingFingerprint()}`;
    const contentHash = hash(drafts.map((chunk) => `${chunk.chunk_key}:${chunk.content_hash}:${chunk.source_revision ?? ""}`).join("\n"));
    const chunkFingerprint = (chunk: DraftChunk) => hash(`${chunk.content_hash}:${fingerprint}`);
    const { data: run, error: runError } = await chunksRepo.start(contentHash, fingerprint, model, drafts.length);
    if (runError || !run) throw new Error(runError?.message ?? "Không tạo được index run.");
    if (run.corpus_hash !== contentHash || run.fingerprint !== fingerprint || run.total_chunks !== drafts.length) {
      await chunksRepo.abandon(run.id);
      throw new ApiError(409, "SOURCE_CHANGED", "Nguồn đã thay đổi trong khi lập chỉ mục. Bấm Chạy tiếp để bắt đầu generation mới.");
    }
    stage = "read_existing_chunks";
    const existing = await allRagRows((start, end) => chunksRepo.existing(start, end));
    const existingByKey = new Map((existing as Array<{ chunk_key: string; content_hash: string; embedding_model: string; embedding_fingerprint: string | null; embedding: string }>).map((row) => [row.chunk_key, row]));
    const batch = drafts.slice(run.checkpoint, run.checkpoint + BATCH_SIZE);
    const changed = batch.filter((chunk) => {
      const old = existingByKey.get(chunk.chunk_key);
      return old?.embedding_fingerprint !== chunkFingerprint(chunk);
    });
    stage = "embed_batch";
    const vectors = changed.length ? await retry(() => embedTexts(changed.map((chunk) => chunk.content))) : [];
    const vectorByKey = new Map(changed.map((chunk, index) => [chunk.chunk_key, `[${vectors[index]!.join(",")}]`]));
    const payload = batch.map((chunk) => ({
      ...chunk, generation_id: run.id, embedding_model: model, embedding_fingerprint: chunkFingerprint(chunk),
      embedding: vectorByKey.get(chunk.chunk_key) ?? existingByKey.get(chunk.chunk_key)!.embedding,
    }));
    if (payload.length) {
      stage = "stage_chunks";
      const { error } = await retry(async () => {
        const result = await chunksRepo.stage(payload);
        if (result.error) throw result.error;
        return result;
      });
      if (error) throw error;
      stage = "advance_checkpoint";
      const { error: advanceError } = await chunksRepo.advance({
        p_run_id: run.id, p_expected: run.checkpoint, p_next: run.checkpoint + batch.length,
        p_changed: changed.length, p_reused: batch.length - changed.length,
        p_keys: batch.map((chunk) => chunk.chunk_key),
      });
      if (advanceError) throw advanceError;
    }
    const checkpoint = run.checkpoint + batch.length;
    let finished = null;
    if (checkpoint === drafts.length) {
      stage = "publish_generation";
      const result = await chunksRepo.publish(run.id);
      if (result.error) throw result.error;
      finished = result.data;
    }
    const summary = { runId: run.id, status: finished ? "completed" : "running", checkpoint,
      indexed: finished?.changed ?? run.changed + changed.length, reused: finished?.reused ?? run.reused + batch.length - changed.length,
      removed: finished?.removed ?? 0, chunks: drafts.length, pages: pages.length,
      variants: new Set(drafts.filter((chunk) => chunk.product_variant_id).map((chunk) => chunk.product_variant_id)).size,
      embeddingModel: model, embeddingDimensions: EMBEDDING_DIMENSIONS, contentHash };
    return summary;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof RagProviderUnavailableError) throw new ApiError(503, "RAG_UNAVAILABLE", "Dịch vụ RAG tạm thời chưa sẵn sàng.");
    throw new RagIndexFailure(`RAG_${stage.toUpperCase()}_FAILED${databaseCode(error)}`, `RAG indexing failed during ${stage}.`);
  }
}
