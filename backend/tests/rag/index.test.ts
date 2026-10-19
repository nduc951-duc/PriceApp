import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({ embed: vi.fn(), fingerprint: vi.fn() }));
vi.mock("../../src/rag/provider.js", () => ({
  EMBEDDING_DIMENSIONS: 1024, embeddingModel: () => "bge-m3", embeddingFingerprint: mocks.fingerprint, embedTexts: mocks.embed,
  RagProviderUnavailableError: class RagProviderUnavailableError extends Error {},
}));
import { indexRag } from "../../src/services/rag-index.service.js";
import { RagProviderUnavailableError } from "../../src/rag/provider.js";
import type { SupabaseClient } from "@supabase/supabase-js";
let client: SupabaseClient;

type Row = Record<string, unknown>;
function harness(text: string, initialVariants: Row[] = []) {
  const catalogVariant = (value: string) => ({ id: 1, display_name: value, raw_specification: value, search_text: "", attributes: {}, products: { name: "Vật tư", categories: { name: "Vật tư" }, product_aliases: [] }, variant_sources: [], packaging_options: [] });
  let variants = initialVariants.length ? initialVariants : text ? [catalogVariant(text)] : [];
  let active = 0;
  let nextRun = 1;
  const rows: Row[] = [];
  const runs = new Map<number, Row>();
  const existingKeyFilters: string[][] = [];
  const select = (table: string) => {
    const query: Record<string, unknown> = {};
    let keys: string[] | undefined;
    query.eq = () => query;
    query.in = (_column: string, values: string[]) => { keys = values; existingKeyFilters.push(values); return query; };
    query.order = () => query;
    query.range = async (start: number, end: number) => ({
      data: (table === "product_variants" ? variants
        : table === "rag_chunks" ? rows.filter(row => !keys || keys.includes(row.chunk_key as string)) : []).slice(start, end + 1), error: null,
    });
    return query;
  };
  const client = {
    from: (table: string) => {
      if (table === "rag_page_texts") throw new Error("OCR transcript table has been removed");
      return {
        select: () => select(table),
        upsert: async (batch: Row[]) => {
          for (const row of batch) {
            const index = rows.findIndex((old) => old.generation_id === row.generation_id && old.chunk_key === row.chunk_key);
            if (index < 0) rows.push(row); else rows[index] = row;
          }
          return { error: null };
        },
      };
    },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "rag_start_index_run") {
        let run = [...runs.values()].find((item) => item.status === "running" && item.corpus_hash === args.p_corpus_hash);
        if (!run) {
          run = { id: nextRun++, status: "running", corpus_hash: args.p_corpus_hash, fingerprint: args.p_fingerprint,
            total_chunks: args.p_total, checkpoint: 0, changed: 0, reused: 0, removed: 0 };
          runs.set(run.id as number, run);
        }
        return { data: { ...run }, error: null };
      }
      const run = runs.get(args.p_run_id as number)!;
      if (name === "rag_advance_index_run") {
        run.checkpoint = args.p_next;
        run.changed = (run.changed as number) + (args.p_changed as number);
        run.reused = (run.reused as number) + (args.p_reused as number);
      }
      if (name === "rag_publish_index_run") {
        run.removed = rows.filter((row) => row.generation_id === active && !rows.some((candidate) => candidate.generation_id === run.id && candidate.chunk_key === row.chunk_key)).length;
        active = run.id as number;
        run.status = "completed";
        for (let index = rows.length - 1; index >= 0; index--) {
          if (rows[index]!.generation_id !== active) rows.splice(index, 1);
        }
      }
      return { data: { ...run }, error: null };
    },
  };
  return { client, rows, runs, existingKeyFilters, setText: (value: string) => { variants = value ? [catalogVariant(value)] : []; }, setVariants: (value: Row[]) => { variants = value; }, getActive: () => active };
}

describe("staged index", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fingerprint.mockResolvedValue("ollama:bge-m3:sha256:1024");
    mocks.embed.mockResolvedValue([Array(1024).fill(0.1)]);
  });

  it("reuses unchanged vectors and embeds only changed text", async () => {
    const state = harness("Vật tư A 8 ly");
    client = state.client as unknown as SupabaseClient;
    expect((await indexRag(client)).indexed).toBe(1);
    expect((await indexRag(client))).toMatchObject({ indexed: 0, reused: 1, status: "completed" });
    expect(mocks.embed).toHaveBeenCalledTimes(1);
    state.setText("Vật tư A 10 ly");
    expect((await indexRag(client)).indexed).toBe(1);
    expect(mocks.embed).toHaveBeenCalledTimes(2);
    expect(state.getActive()).toBe(3);
  });

  it("loads existing vectors only for the current batch keys", async () => {
    const state = harness("Vật tư A 8 ly");
    await indexRag(state.client as unknown as SupabaseClient);
    expect(state.existingKeyFilters).toEqual([["variant:1:0"]]);
  });

  it("keeps one active chunk when the same corpus is retried after success", async () => {
    const state = harness("Tắc kê sắt 6x50");
    client = state.client as unknown as SupabaseClient;

    const first = await indexRag(client);
    const retry = await indexRag(client);

    expect(first.status).toBe("completed");
    expect(retry).toMatchObject({ status: "completed", indexed: 0, reused: 1 });
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]!.generation_id).toBe(state.getActive());
    expect(new Set(state.rows.map((row) => row.chunk_key)).size).toBe(1);
    expect(mocks.embed).toHaveBeenCalledTimes(1);
  });

  it("reindexes verified packaging and unit changes without retaining the old chunk", async () => {
    const variant: Row = {
      id: 4, display_name: "Tắc kê sắt 6x50", raw_specification: "6x50", search_text: "tắc kê 6x50", attributes: {},
      products: { name: "Tắc kê sắt", categories: { name: "Tắc kê" }, product_aliases: [] },
      variant_sources: [{ source_page_id: 2, source_pages: { page_number: 2, verification_status: "verified" } }],
      packaging_options: [{ name: "Bịch", quantity: 10, base_unit: "cái", note: null }],
    };
    const state = harness("", [variant]);
    client = state.client as unknown as SupabaseClient;

    const first = await indexRag(client);
    expect(first.status).toBe("completed");
    expect(state.rows[0]!.content).toContain("Bịch · 10 cái");
    state.setVariants([{ ...variant, packaging_options: [{ name: "Hộp", quantity: 20, base_unit: "bộ", note: null }] }]);
    const changed = await indexRag(client);

    expect(changed).toMatchObject({ status: "completed", indexed: 1, reused: 0 });
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]!.content).toContain("Hộp · 20 bộ");
    expect(state.rows[0]!.content).not.toContain("Bịch · 10 cái");
    expect(mocks.embed).toHaveBeenCalledTimes(2);
  });

  it("embeds the Supabase product description with its verified variant", async () => {
    const variant: Row = {
      id: 56, display_name: "Bulong 8 ly x 3F", raw_specification: "8 ly x 3F", search_text: "bulong 8 ly x 3f", attributes: {},
      products: { name: "Bulong", description: "Bulong dùng để liên kết các chi tiết bằng đai ốc.", categories: { name: "Bu lông" }, product_aliases: [] },
      variant_sources: [], packaging_options: [],
    };
    const state = harness("", [variant]);
    client = state.client as unknown as SupabaseClient;

    await indexRag(client);

    expect(state.rows[0]!.content).toContain("Mô tả sản phẩm: Bulong dùng để liên kết các chi tiết bằng đai ốc.");
    expect(mocks.embed.mock.calls.flat(2).join(" ")).toContain("Mô tả sản phẩm: Bulong dùng để liên kết các chi tiết bằng đai ốc.");
  });

  it("embeds the interpreted diameter and length for screw specifications", async () => {
    const state = harness("", [{
      id: 57, display_name: "10x120", raw_specification: "10x120", search_text: "", attributes: {},
      products: { name: "Vít bắn tôn", description: null, categories: { name: "Vít" }, product_aliases: [] },
      variant_sources: [], packaging_options: [],
    }]);
    client = state.client as unknown as SupabaseClient;

    await indexRag(client);

    expect(state.rows[0]!.content).toContain("Diễn giải quy cách: đường kính 10 ly (10 mm), chiều dài 120 mm.");
  });

  it("embeds a tấc measurement found inside a catalog variant description", async () => {
    const state = harness("", [{
      id: 58, display_name: "Đỏ mận khóa ĐL 1T2", raw_specification: "Đỏ mận khóa ĐL 1T2", search_text: "", attributes: {},
      products: { name: "Bánh xe", description: null, categories: { name: "Bánh xe" }, product_aliases: [] },
      variant_sources: [], packaging_options: [],
    }]);
    client = state.client as unknown as SupabaseClient;

    await indexRag(client);

    expect(state.rows[0]!.content).toContain("Diễn giải quy cách: ký hiệu tấc 1T2 tương đương 120 mm.");
  });

  it("indexes a verified catalog row without reading OCR transcripts or source scans", async () => {
    const state = harness("", [{
      id: 55, display_name: "Catalog row", raw_specification: "8x60", search_text: "catalog", attributes: {},
      products: { name: "Catalog row", categories: { name: "Hardware" }, product_aliases: [] },
      variant_sources: [], packaging_options: [],
    }]);
    const result = await indexRag(state.client as unknown as SupabaseClient);
    expect(result).toMatchObject({ chunks: 1, variants: 1, pages: 0, status: "completed" });
    expect(state.rows[0]).toMatchObject({ chunk_key: "variant:55:0", source_page_id: null, metadata: { kind: "verified_catalog" } });
  });

  it("keeps the old generation active after a failed later batch and resumes", async () => {
    const state = harness(Array.from({ length: 18 }, (_, i) => `${i} ${"vật tư ".repeat(125)}`).join("\n"));
    client = state.client as unknown as SupabaseClient;
    mocks.embed.mockImplementation(async (input: string[]) => input.map(() => Array(1024).fill(0.1)));
    const first = await indexRag(client);
    expect(first).toMatchObject({ status: "running", checkpoint: 16 });
    expect(state.getActive()).toBe(0);
    mocks.embed.mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockRejectedValueOnce(new Error("temporary provider failure"));
    await expect(indexRag(client)).rejects.toThrow();
    expect(state.getActive()).toBe(0);
    const resumed = await indexRag(client);
    expect(resumed).toMatchObject({ status: "completed", checkpoint: first.chunks, runId: first.runId });
    expect(state.getActive()).toBe(first.runId);
  });

  it("returns safe unavailability and never publishes after a provider outage", async () => {
    const state = harness("A 8 ly");
    client = state.client as unknown as SupabaseClient;
    mocks.embed.mockRejectedValue(new RagProviderUnavailableError("provider timeout private-token"));
    await expect(indexRag(client)).rejects.toMatchObject({ statusCode: 503, code: "RAG_UNAVAILABLE", message: expect.not.stringContaining("private-token") });
    expect(state.getActive()).toBe(0);
    expect([...state.runs.values()].every((run) => run.status !== "completed")).toBe(true);
  });

  it("rebuilds vectors persisted under the previous chunker fingerprint", async () => {
    const state = harness("Vật tư A 8 ly");
    client = state.client as unknown as SupabaseClient;
    await indexRag(client);
    const oldFingerprint = createHash("sha256").update(`${state.rows[0]!.content_hash}:catalog-1100-overlap160-v4:ollama:bge-m3:sha256:1024`).digest("hex");
    state.rows[0]!.embedding_fingerprint = oldFingerprint;
    const result = await indexRag(client);
    expect(result).toMatchObject({ indexed: 1, reused: 0, status: "completed" });
    expect(mocks.embed).toHaveBeenCalledTimes(2);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]!.embedding_fingerprint).not.toBe(oldFingerprint);
    expect(state.getActive()).toBe(result.runId);
  });
});
