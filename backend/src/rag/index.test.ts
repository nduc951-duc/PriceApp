import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const mocks = vi.hoisted(() => ({ embed: vi.fn(), fingerprint: vi.fn() }));
vi.mock("./provider.js", () => ({
  EMBEDDING_DIMENSIONS: 1024, embeddingModel: () => "bge-m3", embeddingFingerprint: mocks.fingerprint, embedTexts: mocks.embed,
  RagProviderUnavailableError: class RagProviderUnavailableError extends Error {},
}));
import { indexRag } from "../services/rag-index.service.js";
import { RagProviderUnavailableError } from "./provider.js";
import type { SupabaseClient } from "@supabase/supabase-js";
let client: SupabaseClient;

type Row = Record<string, unknown>;
function harness(text: string) {
  let pageText = text;
  let active = 0;
  let nextRun = 1;
  const rows: Row[] = [];
  const runs = new Map<number, Row>();
  const select = (table: string) => {
    const query: Record<string, unknown> = {};
    query.eq = () => query;
    query.order = () => query;
    query.range = async (start: number, end: number) => ({
      data: (table === "rag_page_texts" ? [{ source_page_id: 1, title: "Trang 1", extracted_text: pageText, revision: 1, source_pages: { page_number: 1, verification_status: "verified" } }]
        : table === "rag_chunks" ? rows : []).slice(start, end + 1), error: null,
    });
    return query;
  };
  const client = {
    from: (table: string) => ({
      select: () => select(table),
      upsert: async (batch: Row[]) => {
        for (const row of batch) {
          const index = rows.findIndex((old) => old.generation_id === row.generation_id && old.chunk_key === row.chunk_key);
          if (index < 0) rows.push(row); else rows[index] = row;
        }
        return { error: null };
      },
    }),
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
      }
      return { data: { ...run }, error: null };
    },
  };
  return { client, rows, runs, setText: (value: string) => { pageText = value; }, getActive: () => active };
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
    const oldFingerprint = createHash("sha256").update(`${state.rows[0]!.content_hash}:lines-1100-overlap160-v1:ollama:bge-m3:sha256:1024`).digest("hex");
    state.rows[0]!.embedding_fingerprint = oldFingerprint;
    const result = await indexRag(client);
    expect(result).toMatchObject({ indexed: 1, reused: 0, status: "completed" });
    expect(mocks.embed).toHaveBeenCalledTimes(2);
    expect(state.rows[1]!.embedding_fingerprint).not.toBe(oldFingerprint);
    expect(state.getActive()).toBe(result.runId);
  });
});
