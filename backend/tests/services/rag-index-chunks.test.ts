import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { listIndexedChunks } from "../../src/services/rag-index-chunks.js";

function fixture(generation: number | null = 7, fail = false) {
  const chain = {
    select: vi.fn(() => chain), eq: vi.fn(() => chain), order: vi.fn(() => chain),
    range: vi.fn(async () => ({ data: [{ id: 21, content: "Tên sản phẩm: Bulong", metadata: { product_name: "Bulong", variant_name: "8x30" } }], count: 41, error: fail ? {} : null })),
    maybeSingle: vi.fn(async () => ({ data: { active_generation: generation }, error: null })),
  };
  return { chain, client: { from: vi.fn(() => chain) } as unknown as SupabaseClient };
}

describe("published index chunk listing", () => {
  it("paginates only the published catalog generation without selecting vectors", async () => {
    const { client, chain } = fixture();
    const result = await listIndexedChunks(client, 2);
    expect(chain.eq).toHaveBeenCalledWith("generation_id", 7);
    expect(chain.eq).toHaveBeenCalledWith("metadata->>kind", "verified_catalog");
    expect(chain.range).toHaveBeenCalledWith(20, 39);
    expect(chain.select).toHaveBeenCalledWith("id,content,metadata", { count: "exact" });
    expect(result).toEqual({ generation: 7, page: 2, pageSize: 20, total: 41, items: [{ id: 21, content: "Tên sản phẩm: Bulong", productName: "Bulong", variantName: "8x30" }] });
  });
  it("returns an empty list before the first published index", async () => {
    const { client, chain } = fixture(null);
    expect(await listIndexedChunks(client, 1)).toMatchObject({ total: 0, items: [], generation: null });
    expect(chain.range).not.toHaveBeenCalled();
  });
  it("reports database failures instead of pretending the list is empty", async () => {
    const { client } = fixture(7, true);
    await expect(listIndexedChunks(client, 1)).rejects.toMatchObject({ statusCode: 503 });
  });
});
