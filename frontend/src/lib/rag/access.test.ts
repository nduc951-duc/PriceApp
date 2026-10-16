import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  embeddingModel: vi.fn(),
  embeddingFingerprint: vi.fn(),
}));

vi.mock("@/lib/rag/auth", () => ({ authenticateRagRequest: mocks.authenticate }));
vi.mock("@/lib/rag/provider", () => ({ EMBEDDING_DIMENSIONS: 1024, embeddingModel: mocks.embeddingModel, embeddingFingerprint: mocks.embeddingFingerprint, embedTexts: vi.fn() }));

import { GET as getPages, PUT as putPage } from "@/app/api/rag/pages/route";
import { POST as buildIndex } from "@/app/api/rag/index/route";

const request = (method: string) => new Request("http://localhost/api/rag/pages", { method });

describe("RAG access and source cleanup", () => {
  it.each([401, 403] as const)("denies page access with status %s without caching", async (status) => {
    mocks.authenticate.mockResolvedValueOnce({ ok: false, status, error: "denied" });
    const response = await getPages(request("GET"));
    expect(response.status).toBe(status);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Vary")).toBe("Authorization");
  });

  it("returns approved and draft source text to owner only, without a shared cache", async () => {
    const rows = [
      { source_page_id: 1, title: "Trang 1", extracted_text: "đã duyệt", review_status: "approved", revision: 2, source_pages: { page_number: 1 } },
      { source_page_id: 2, title: "Trang 2", extracted_text: "bản nháp riêng", review_status: "draft", revision: 4, source_pages: { page_number: 2 } },
    ];
    const order = vi.fn().mockResolvedValue({ data: rows, error: null });
    const client = { from: vi.fn(() => ({ select: vi.fn(() => ({ order })) })) };
    mocks.authenticate.mockResolvedValueOnce({ ok: true, client });
    const response = await getPages(request("GET"));
    const body = await response.json();
    expect(body.pages).toHaveLength(2);
    expect(body.pages[1]).toMatchObject({ reviewStatus: "draft", revision: 4, extractedText: "bản nháp riêng" });
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  });

  it("lets owner revoke an entire page and returns its new revision", async () => {
    const upsert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: { revision: 7 }, error: null }) }) }));
    mocks.authenticate.mockResolvedValueOnce({ ok: true, user: { id: "owner-id" }, client: { from: () => ({ upsert }) } });
    const response = await putPage(new Request("http://localhost/api/rag/pages", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sourcePageId: 1, title: "Trang 1", extractedText: "Đã đối chiếu", reviewStatus: "rejected" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ reviewStatus: "rejected", revision: 7 });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ review_status: "rejected", reviewed_by: null }), { onConflict: "source_page_id" });
  });

  it("publishes an empty generation to remove stale chunks without embedding", async () => {
    mocks.embeddingModel.mockReturnValue("bge-m3");
    mocks.embeddingFingerprint.mockResolvedValue("ollama:bge-m3:digest:1024");
    const chain = (rows: unknown[]) => {
      const query: Record<string, unknown> = {};
      query.eq = () => query;
      query.order = () => query;
      query.range = async () => ({ data: rows, error: null });
      return query;
    };
    const from = vi.fn((table: string) => ({ select: () => chain(table === "rag_chunks" ? [{ chunk_key: "old" }] : []) }));
    const rpc = vi.fn(async (name: string) => ({ data: name === "rag_start_index_run"
      ? { id: 4, corpus_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855", fingerprint: "records-1100-overlap160-v3:ollama:bge-m3:digest:1024", checkpoint: 0, total_chunks: 0, changed: 0, reused: 0 }
      : { id: 4, changed: 0, reused: 0, removed: 1 }, error: null }));
    mocks.authenticate.mockResolvedValueOnce({ ok: true, client: { from, rpc } });
    const response = await buildIndex(request("POST"));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "completed", indexed: 0, removed: 1, chunks: 0 });
    expect(rpc).toHaveBeenCalledWith("rag_publish_index_run", { p_run_id: 4 });
  });
});

describe("service worker session isolation", () => {
  it("evicts old caches, stores only the generic POS shell, and excludes user-specific routes", async () => {
    const listeners: Record<string, (event: { request: Request; waitUntil: (work: Promise<unknown>) => void; respondWith: (work: Promise<unknown>) => void }) => void> = {};
    const deleted: string[] = [];
    const stored: string[] = [];
    const cache = { addAll: async () => undefined, match: async () => undefined, put: async (request: Request | string) => { stored.push(typeof request === "string" ? request : request.url); } };
    const worker = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");
    runInNewContext(worker, {
      URL, fetch: async () => ({ ok: true, type: "basic", clone() { return this; } }),
      caches: { open: async () => cache, keys: async () => ["gia-chuan-v4", "gia-chuan-static-v5"], delete: async (key: string) => { deleted.push(key); return true; } },
      self: { location: { origin: "http://localhost" }, clients: { claim: async () => undefined }, skipWaiting() {}, addEventListener: (name: string, handler: typeof listeners[string]) => { listeners[name] = handler; } },
    });
    let activation: Promise<unknown> = Promise.resolve();
    listeners.activate!({ request: request("GET"), waitUntil: (work) => { activation = work; }, respondWith() {} });
    await activation;
    expect(deleted).toEqual(["gia-chuan-v4", "gia-chuan-static-v5"]);

    let intercepted = false;
    for (const path of ["/api/rag/pages", "/api/rag/health", "/questions", "/rag-admin", "/"]) {
      listeners.fetch!({ request: new Request(`http://localhost${path}`), waitUntil() {}, respondWith() { intercepted = true; } });
    }
    expect(intercepted).toBe(false);

    const navigation = { url: "http://localhost/", method: "GET", mode: "navigate" } as Request;
    let shellResponse: Promise<unknown> = Promise.resolve();
    listeners.fetch!({ request: navigation, waitUntil() {}, respondWith(work) { shellResponse = work; } });
    await shellResponse;

    let assetResponse: Promise<unknown> = Promise.resolve();
    listeners.fetch!({ request: new Request("http://localhost/_next/static/app.js"), waitUntil() {}, respondWith(work) { assetResponse = work; } });
    await assetResponse;
    expect(stored).toEqual(["/", "http://localhost/_next/static/app.js"]);
  });
});
