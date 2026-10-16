import { describe, expect, it, vi } from "vitest";
import { readCatalog, mapCatalogRows } from "./catalog.repository.js";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 7, active: true, display_name: "Variant", raw_specification: null, verification_status: "verified",
  products: { id: 2, name: "Product", categories: { id: 3, name: "Category" } },
  variant_sources: [{ source_pages: { page_number: 4, storage_path: "source-pages/four.jpg" } }, { source_pages: null }],
  packaging_options: [{ id: 8, name: "Box", quantity: "10", base_unit: "piece", note: null,
    prices: [{ id: 9, amount: "12345.50", version: 2, price_type: "retail", minimum_quantity: "1", active: true, valid_from: "2020-01-01T00:00:00.000Z", valid_to: null, price_lists: { suppliers: { name: "Vendor" } } },
      { id: 10, amount: "1", version: 1, price_type: "retail", minimum_quantity: "1", active: false, valid_from: "2020-01-01T00:00:00.000Z", valid_to: null, price_lists: null }] }],
  ...overrides,
});

describe("catalog mapping", () => {
  it("returns empty arrays for empty results", () => expect(mapCatalogRows([])).toEqual({ entries: [], prices: [] }));
  it("tolerates absent nested joins and keeps authoritative amount", () => {
    const mapped = mapCatalogRows([row({ products: null, variant_sources: null, packaging_options: [{ ...row().packaging_options[0], prices: [{ ...row().packaging_options[0].prices[0], price_lists: null }] }] })]);
    expect(mapped.entries[0]).toMatchObject({ categoryId: 0, productId: 0, name: "Variant", sourcePages: [], sourceFiles: [] });
    expect(mapped.prices).toHaveLength(1);
    expect(mapped.prices[0]).toMatchObject({ price: 12345.5, supplier: "Chưa rõ nhà cung cấp", sourcePages: [], sourceFiles: [] });
  });
  it("uses the ungrouped category fallback and accepts empty package joins", () => {
    const mapped = mapCatalogRows([row({ products: { id: 2, name: "Product", categories: null }, packaging_options: null, variant_sources: [] })]);
    expect(mapped.entries[0]).toMatchObject({ categoryId: 0, productId: 2, category: "Chưa phân nhóm" });
    expect(mapped.prices).toEqual([]);
  });
  it("omits inactive and sample variants and inactive prices", () => {
    const mapped = mapCatalogRows([row(), row({ id: 11, active: false }), row({ id: 12, verification_status: "sample" })]);
    expect(mapped.entries).toHaveLength(1);
    expect(mapped.prices.map(price => price.id)).toEqual([9]);
    expect(mapped.entries[0].sourceFiles).toEqual(["source-pages/four.jpg"]);
  });
  it("omits prices that have not started or have expired", () => {
    const packaging = row().packaging_options[0];
    const current = packaging.prices[0];
    const prices = [
      { ...current, id: 20, valid_from: "2026-10-16T00:00:00.000Z" },
      { ...current, id: 21, valid_to: "2026-10-14T23:59:59.999Z" },
      { ...current, id: 22, valid_to: "not-a-date" },
      { ...current, id: 23, valid_to: "2026-10-15T00:00:00.000Z" },
    ];
    const mapped = mapCatalogRows([
      row({ packaging_options: [{ ...packaging, prices }] }),
    ], Date.parse("2026-10-15T00:00:00.000Z"));
    expect(mapped.prices.map((price) => price.priceId)).toEqual([23]);
  });
});

it("reads every catalog page in stable ID order through the caller client", async () => {
  const batches = [500, 500, 200].map((count, page) =>
    Array.from({ length: count }, (_, index) => row({ id: page * 500 + index + 1, packaging_options: [] })),
  );
  const range = vi.fn(async (start: number) => ({ data: batches[start / 500] ?? [], error: null }));
  const order = vi.fn(() => ({ range }));
  const neq = vi.fn(() => ({ order }));
  const eq = vi.fn(() => ({ neq }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const result = await readCatalog({ from } as never);
  expect(result.entries).toHaveLength(1200);
  expect(from).toHaveBeenCalledWith("product_variants");
  expect(eq).toHaveBeenCalledWith("active", true);
  expect(neq).toHaveBeenCalledWith("verification_status", "sample");
  expect(order).toHaveBeenCalledWith("id", { ascending: true });
  expect(range.mock.calls.map(([start, end]) => [start, end])).toEqual([[0, 499], [500, 999], [1000, 1499]]);
});
