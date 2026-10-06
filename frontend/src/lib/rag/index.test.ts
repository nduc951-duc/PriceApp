import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticate: vi.fn(), embed: vi.fn(), fingerprint: vi.fn() }));
vi.mock("@/lib/rag/auth", () => ({ authenticateRagRequest: mocks.authenticate }));
vi.mock("@/lib/rag/provider", () => ({
  EMBEDDING_DIMENSIONS: 1024, embeddingModel: () => "bge-m3", embeddingFingerprint: mocks.fingerprint, embedTexts: mocks.embed,
}));
import { POST } from "@/app/api/rag/index/route";

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
    mocks.fingerprint.mockResolvedValue("ollama:bge-m3:sha256:1024");
    mocks.embed.mockResolvedValue([Array(1024).fill(0.1)]);
  });

  it("reuses unchanged vectors and embeds only changed text", async () => {
    const state = harness("Vật tư A 8 ly");
    mocks.authenticate.mockResolvedValue({ ok: true, client: state.client });
    const request = () => new Request("http://localhost/api/rag/index", { method: "POST" });
    expect((await (await POST(request())).json()).indexed).toBe(1);
    expect((await (await POST(request())).json())).toMatchObject({ indexed: 0, reused: 1, status: "completed" });
    expect(mocks.embed).toHaveBeenCalledTimes(1);
    state.setText("Vật tư A 10 ly");
    expect((await (await POST(request())).json()).indexed).toBe(1);
    expect(mocks.embed).toHaveBeenCalledTimes(2);
    expect(state.getActive()).toBe(3);
  });

  it("keeps the old generation active after a failed later batch and resumes", async () => {
    const state = harness(Array.from({ length: 18 }, (_, i) => `${i} ${"vật tư ".repeat(125)}`).join("\n"));
    mocks.authenticate.mockResolvedValue({ ok: true, client: state.client });
    mocks.embed.mockImplementation(async (input: string[]) => input.map(() => Array(1024).fill(0.1)));
    const request = () => new Request("http://localhost/api/rag/index", { method: "POST" });
    const first = await (await POST(request())).json();
    expect(first).toMatchObject({ status: "running", checkpoint: 16 });
    expect(state.getActive()).toBe(0);
    mocks.embed.mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockRejectedValueOnce(new Error("temporary provider failure"))
      .mockRejectedValueOnce(new Error("temporary provider failure"));
    expect((await POST(request())).status).toBe(500);
    expect(state.getActive()).toBe(0);
    const resumed = await (await POST(request())).json();
    expect(resumed).toMatchObject({ status: "completed", checkpoint: first.chunks, runId: first.runId });
    expect(state.getActive()).toBe(first.runId);
  });
});
