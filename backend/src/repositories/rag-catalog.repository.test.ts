import { describe, expect, it, vi } from "vitest";
import { ragCatalogRepository } from "./rag-catalog.repository.js";
import type { SupabaseClient } from "@supabase/supabase-js";

describe("ragCatalogRepository.expandVerifiedGroups", () => {
  it("groups nullable public RPC rows and calls only the scoped group RPC", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name !== "list_public_rag_product_variants") throw new Error(`Unexpected RPC ${name}`);
      return { data: [
        { product_id: 4, product_name: "Tắc kê đạn", category_name: "Tắc kê", product_aliases: ["tắc kê nở"], variant_id: 20, display_name: "6x50", raw_specification: "6x50", source_pages: [2], packaging_id: 8, packaging_name: "Bịch", package_quantity: 10, unit: "cái", package_note: null, price_id: 30, price_version: 2, price_amount: 34000, price_type: "retail", minimum_quantity: 1, price_list_name: "Sổ hiện hành", supplier_name: "Cửa hàng" },
        { product_id: 4, product_name: "Tắc kê đạn", category_name: "Tắc kê", product_aliases: ["tắc kê nở"], variant_id: 21, display_name: "8x60", raw_specification: "8x60", source_pages: [3], packaging_id: null, packaging_name: null, package_quantity: null, unit: null, package_note: null, price_id: null, price_version: null, price_amount: null, price_type: null, minimum_quantity: null, price_list_name: null, supplier_name: null },
      ], error: null };
    });
    const client = { rpc, from: vi.fn(() => { throw new Error("Public mode must not read tables directly"); }) } as unknown as SupabaseClient;

    const result = await ragCatalogRepository(client, true).expandVerifiedGroups([20]);

    expect(rpc).toHaveBeenCalledExactlyOnceWith("list_public_rag_product_variants", { p_seed_variant_ids: [20] });
    expect(client.from).not.toHaveBeenCalled();
    expect(result.data).toHaveLength(2);
    expect(result.data?.[0]).toMatchObject({ id: 20, products: { name: "Tắc kê đạn", product_aliases: [{ alias: "tắc kê nở" }] }, packaging_options: [{ id: 8, prices: [{ id: 30, amount: 34000, price_type: "retail" }] }] });
    expect(result.data?.[1]).toMatchObject({ id: 21, packaging_options: [] });
    expect(result.data?.[1]?.source_pages).toEqual([3]);
  });

  it("expands staff seeds through authenticated table reads without the public RPC", async () => {
    const rpc = vi.fn(async () => ({ data: [{ product_variant_id: 20, page_number: 2 }], error: null }));
    const seedQuery = { select: vi.fn(() => seedQuery), in: vi.fn(() => seedQuery), eq: vi.fn(() => seedQuery), then: (resolve: (value: unknown) => unknown) => resolve({ data: [{ product_id: 4 }], error: null }) };
    const variantQuery = { select: vi.fn(() => variantQuery), in: vi.fn(() => variantQuery), eq: vi.fn(() => variantQuery), then: (resolve: (value: unknown) => unknown) => resolve({ data: [{ id: 20, display_name: "6x50", raw_specification: "6x50", verification_status: "verified", products: { name: "Tắc kê đạn", categories: { name: "Tắc kê" }, product_aliases: [{ alias: "tắc kê nở" }] }, packaging_options: [] }], error: null }) };
    const from = vi.fn((table: string) => table === "product_variants" ? (from.mock.calls.length === 1 ? seedQuery : variantQuery) : (() => { throw new Error(table); })());
    const client = { rpc, from } as unknown as SupabaseClient;

    const result = await ragCatalogRepository(client).expandVerifiedGroups([20]);

    expect(rpc).toHaveBeenCalledExactlyOnceWith("current_rag_variant_sources", { p_variant_ids: [20] });
    expect(from).toHaveBeenCalledTimes(2);
    expect(result.data).toMatchObject([{ id: 20, products: { name: "Tắc kê đạn" } }]);
    expect(variantQuery.select.mock.calls[0]?.[0]).toContain("is_sample");
    expect(variantQuery.select.mock.calls[0]?.[0]).toContain("suppliers(name,active)");
  });
});

describe("ragCatalogRepository.prices", () => {
  it("selects staff price-source eligibility flags so the service can reject sample and inactive sources", async () => {
    const query = {
      select: vi.fn(() => query), in: vi.fn(() => query), eq: vi.fn(() => query),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [], error: null }),
    };
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;
    await ragCatalogRepository(client).prices([20]);
    expect(query.select.mock.calls[0]?.[0]).toContain("is_sample");
    expect(query.select.mock.calls[0]?.[0]).toContain("suppliers(name,active)");
    expect(query.select.mock.calls[0]?.[0]).toContain("products!inner(name,description,");
  });
});

describe("ragCatalogRepository.searchCatalogPage", () => {
  it("reads a complete public page through the scoped RPC without reading tables", async () => {
    const rpc = vi.fn(async () => ({
      data: { items: [], total_count: 37, next_cursor: 20 },
      error: null,
    }));
    const client = { rpc, from: vi.fn(() => { throw new Error("Public page reads must stay behind the scoped RPC"); }) } as unknown as SupabaseClient;
    const repository = ragCatalogRepository(client, true);
    expect(repository).toHaveProperty("searchCatalogPage");
    const searchCatalogPage = (repository as Record<string, unknown>).searchCatalogPage;
    if (typeof searchCatalogPage !== "function") return;

    const result = await searchCatalogPage("tắc kê đạn", 10, 20, "tắc kê");

    expect(rpc).toHaveBeenCalledExactlyOnceWith("list_public_rag_catalog_page", {
      p_query: "tắc kê đạn", p_category_text: "tắc kê", p_after_variant_id: 10, p_page_size: 20,
    });
    expect(client.from).not.toHaveBeenCalled();
    expect(result).toMatchObject({ data: { items: [], total: 37, nextCursor: 20 }, error: null });
  });

  it("uses the authenticated RLS invoker RPC for staff pages", async () => {
    const rpc = vi.fn(async () => ({
      data: { items: [], total_count: 4, next_cursor: null },
      error: null,
    }));
    const client = { rpc, from: vi.fn(() => { throw new Error("Staff page must remain a scoped RPC call"); }) } as unknown as SupabaseClient;
    const repository = ragCatalogRepository(client, false);
    expect(repository).toHaveProperty("searchCatalogPage");
    const searchCatalogPage = (repository as Record<string, unknown>).searchCatalogPage;
    if (typeof searchCatalogPage !== "function") return;

    const result = await searchCatalogPage("tắc kê đạn", null, 20, "tắc kê");

    expect(rpc).toHaveBeenCalledExactlyOnceWith("list_staff_rag_catalog_page", {
      p_query: "tắc kê đạn", p_category_text: "tắc kê", p_after_variant_id: null, p_page_size: 20,
    });
    expect(client.from).not.toHaveBeenCalled();
    expect(result).toMatchObject({ data: { items: [], total: 4, nextCursor: null }, error: null });
  });
});

describe("ragCatalogRepository.verified", () => {
  it("loads the product description used to build catalog chunks", async () => {
    const query = {
      select: vi.fn(), eq: vi.fn(), order: vi.fn(), range: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    query.order.mockReturnValue(query);
    query.range.mockResolvedValue({ data: [], error: null });
    const client = { from: vi.fn(() => query) } as unknown as SupabaseClient;

    await ragCatalogRepository(client).verified(0, 499);

    expect(query.select.mock.calls[0]?.[0]).toContain("products!inner(name,description,categories!inner(name),product_aliases(alias))");
  });
});
