import { createHash } from "node:crypto";
import { authenticateRagRequest } from "@/lib/rag/auth";
import { CHUNKER_VERSION, chunkText } from "@/lib/rag/chunking";
import { ragJson } from "@/lib/rag/http";
import { EMBEDDING_DIMENSIONS, embedTexts, embeddingModel, embeddingFingerprint } from "@/lib/rag/provider";

export const runtime = "nodejs";
export const maxDuration = 300;

type PageText = { source_page_id: number; title: string; extracted_text: string; revision: number; source_pages: { page_number: number | null; verification_status: string } | null };
type Variant = {
  id: number; display_name: string; raw_specification: string | null; search_text: string; attributes: Record<string, unknown>;
  products: { name: string; categories: { name: string } | null; product_aliases: { alias: string }[] | null } | null;
  variant_sources: { source_page_id: number; source_pages: { page_number: number | null; verification_status: string } | null }[];
};
type DraftChunk = { chunk_key: string; source_page_id: number; source_revision: number | null; product_variant_id: number | null; chunk_index: number; content: string; content_hash: string; metadata: Record<string, unknown> };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const BATCH_SIZE = 16;
async function allRows(query: (start: number, end: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  const rows: unknown[] = [];
  for (let start = 0;; start += 500) {
    const { data, error } = await query(start, start + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < 500) return rows;
  }
}
async function retry<T>(operation: () => Promise<T>): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await operation(); } catch (error) { last = error; if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1))); }
  }
  throw last;
}

export async function GET(request: Request) {
  const auth = await authenticateRagRequest(request, ["owner"]);
  if (!auth.ok) return ragJson({ error: auth.error }, { status: auth.status });
  const { data, error } = await auth.client.from("rag_index_runs")
    .select("id,status,checkpoint,total_chunks,changed,reused,removed,model,corpus_hash")
    .order("id", { ascending: false }).limit(1).maybeSingle();
  if (error) return ragJson({ error: "Không đọc được trạng thái lập chỉ mục." }, { status: 500 });
  return ragJson({ run: data ? {
    runId: data.id, status: data.status, checkpoint: data.checkpoint, chunks: data.total_chunks,
    indexed: data.changed, reused: data.reused, removed: data.removed,
    embeddingModel: data.model, contentHash: data.corpus_hash,
  } : null });
}

export async function POST(request: Request) {
  const auth = await authenticateRagRequest(request, ["owner"]);
  if (!auth.ok) return ragJson({ error: auth.error }, { status: auth.status });
  try {
    const [pageData, rejectedData, variantData] = await Promise.all([
      allRows((start, end) => auth.client.from("rag_page_texts").select("source_page_id,title,extracted_text,revision,source_pages!inner(page_number,verification_status)").eq("review_status", "approved").order("source_page_id").range(start, end)),
      allRows((start, end) => auth.client.from("rag_page_texts").select("source_page_id").eq("review_status", "rejected").order("source_page_id").range(start, end)),
      allRows((start, end) => auth.client.from("product_variants").select("id,display_name,raw_specification,search_text,attributes,products!inner(name,categories(name),product_aliases(alias)),variant_sources(source_page_id,source_pages(page_number,verification_status))").eq("active", true).eq("verification_status", "verified").order("id").range(start, end)),
    ]);
    const pages = ((pageData ?? []) as unknown as PageText[]).filter((page) => page.source_pages?.verification_status !== "unreadable");
    const variants = (variantData ?? []) as unknown as Variant[];
    const rejectedPageIds = new Set((rejectedData as Array<{ source_page_id: number }>).map((row) => row.source_page_id));
    const drafts: DraftChunk[] = [];

    for (const page of pages) {
      const pageNumber = page.source_pages?.page_number ?? null;
      for (const chunk of chunkText(page.extracted_text)) {
        const content = `${page.title || `Sổ giá - Trang ${pageNumber ?? "?"}`}\n${chunk.content}`;
        drafts.push({
          chunk_key: `page:${page.source_page_id}:ocr:${chunk.index}`, source_page_id: page.source_page_id, source_revision: page.revision,
          product_variant_id: null, chunk_index: chunk.index, content, content_hash: hash(content),
          metadata: { kind: "approved_page_ocr", page_number: pageNumber, title: page.title, start_char: chunk.start, end_char: chunk.end },
        });
      }
    }

    for (const variant of variants) {
      const product = variant.products;
      if (!product) continue;
      const aliases = product.product_aliases?.map((item) => item.alias).filter(Boolean) ?? [];
      const text = [
        `Danh mục: ${product.categories?.name ?? "Vật tư"}`,
        `Tên sản phẩm: ${product.name}`,
        aliases.length ? `Tên gọi khác: ${[...new Set(aliases)].join(", ")}` : "",
        `Quy cách: ${variant.raw_specification ?? variant.display_name}`,
        `Thông tin nhận diện: ${variant.search_text}`,
        Object.keys(variant.attributes ?? {}).length ? `Thuộc tính: ${JSON.stringify(variant.attributes)}` : "",
      ].filter(Boolean).join("\n");
      const linkedPages = variant.variant_sources.length ? variant.variant_sources : [{ source_page_id: 0, source_pages: null }];
      for (const source of linkedPages) {
        if (!source.source_page_id || rejectedPageIds.has(source.source_page_id) || source.source_pages?.verification_status === "unreadable") continue;
        for (const chunk of chunkText(text)) {
          const content = chunk.content;
          drafts.push({
            chunk_key: `page:${source.source_page_id}:variant:${variant.id}:${chunk.index}`,
            source_page_id: source.source_page_id, source_revision: null, product_variant_id: variant.id, chunk_index: chunk.index,
            content, content_hash: hash(content),
            metadata: { kind: "verified_catalog", page_number: source.source_pages?.page_number ?? null, product_name: product.name, variant_name: variant.display_name, start_char: chunk.start, end_char: chunk.end },
          });
        }
      }
    }

    drafts.sort((a, b) => a.chunk_key.localeCompare(b.chunk_key));
    const model = embeddingModel();
    const fingerprint = `${CHUNKER_VERSION}:${await embeddingFingerprint()}`;
    const contentHash = hash(drafts.map((chunk) => `${chunk.chunk_key}:${chunk.content_hash}:${chunk.source_revision ?? ""}`).join("\n"));
    const chunkFingerprint = (chunk: DraftChunk) => hash(`${chunk.content_hash}:${fingerprint}`);
    const { data: run, error: runError } = await auth.client.rpc("rag_start_index_run", { p_corpus_hash: contentHash, p_fingerprint: fingerprint, p_model: model, p_total: drafts.length });
    if (runError || !run) throw new Error(runError?.message ?? "Không tạo được index run.");
    if (run.corpus_hash !== contentHash || run.fingerprint !== fingerprint || run.total_chunks !== drafts.length) {
      await auth.client.rpc("rag_abandon_index_run", { p_run_id: run.id });
      return ragJson({ error: "Nguồn đã thay đổi trong khi lập chỉ mục. Bấm Chạy tiếp để bắt đầu generation mới." }, { status: 409 });
    }
    const existing = await allRows((start, end) => auth.client.from("rag_chunks")
      .select("chunk_key,content_hash,embedding_model,embedding_fingerprint,embedding")
      .order("id").range(start, end));
    const existingByKey = new Map((existing as Array<{ chunk_key: string; content_hash: string; embedding_model: string; embedding_fingerprint: string | null; embedding: string }>).map((row) => [row.chunk_key, row]));
    const batch = drafts.slice(run.checkpoint, run.checkpoint + BATCH_SIZE);
    const changed = batch.filter((chunk) => {
      const old = existingByKey.get(chunk.chunk_key);
      return old?.embedding_fingerprint !== chunkFingerprint(chunk);
    });
    const vectors = changed.length ? await retry(() => embedTexts(changed.map((chunk) => chunk.content))) : [];
    const vectorByKey = new Map(changed.map((chunk, index) => [chunk.chunk_key, `[${vectors[index]!.join(",")}]`]));
    const payload = batch.map((chunk) => ({
      ...chunk, generation_id: run.id, embedding_model: model, embedding_fingerprint: chunkFingerprint(chunk),
      embedding: vectorByKey.get(chunk.chunk_key) ?? existingByKey.get(chunk.chunk_key)!.embedding,
    }));
    if (payload.length) {
      const { error } = await retry(async () => {
        const result = await auth.client.from("rag_chunks").upsert(payload, { onConflict: "generation_id,chunk_key" });
        if (result.error) throw result.error;
        return result;
      });
      if (error) throw error;
      const { error: advanceError } = await auth.client.rpc("rag_advance_index_run", {
        p_run_id: run.id, p_expected: run.checkpoint, p_next: run.checkpoint + batch.length,
        p_changed: changed.length, p_reused: batch.length - changed.length,
        p_keys: batch.map((chunk) => chunk.chunk_key),
      });
      if (advanceError) throw advanceError;
    }
    const checkpoint = run.checkpoint + batch.length;
    let finished = null;
    if (checkpoint === drafts.length) {
      const result = await auth.client.rpc("rag_publish_index_run", { p_run_id: run.id });
      if (result.error) throw result.error;
      finished = result.data;
    }
    const summary = { runId: run.id, status: finished ? "completed" : "running", checkpoint,
      indexed: finished?.changed ?? run.changed + changed.length, reused: finished?.reused ?? run.reused + batch.length - changed.length,
      removed: finished?.removed ?? 0, chunks: drafts.length, pages: pages.length,
      variants: new Set(drafts.filter((chunk) => chunk.product_variant_id).map((chunk) => chunk.product_variant_id)).size,
      embeddingModel: model, embeddingDimensions: EMBEDDING_DIMENSIONS, contentHash };
    return ragJson(summary);
  } catch {
    return ragJson({ error: "Lập chỉ mục thất bại. Kiểm tra cấu hình và thử tiếp sau khi xử lý lỗi." }, { status: 500 });
  }
}
