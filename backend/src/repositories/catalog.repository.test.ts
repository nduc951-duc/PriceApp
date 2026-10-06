import { describe, expect, it, vi } from "vitest";
import { readCatalog, mapCatalogRows } from "./catalog.repository.js";

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 7, active: true, display_name: "Variant", raw_specification: null, verification_status: "verified",
  products: { id: 2, name: "Product", categories: { id: 3, name: "Category" } },
  variant_sources: [{ source_pages: { page_number: 4, storage_path: "source-pages/four.jpg" } }, { source_pages: null }],
  packaging_options: [{ id: 8, name: "Box", quantity: "10", base_unit: "piece", note: null,
    prices: [{ id: 9, amount: "12345.50", version: 2, price_type: "retail", minimum_quantity: "1", active: true, price_lists: { suppliers: { name: "Vendor" } } },
      { id: 10, amount: "1", version: 1, price_type: "retail", minimum_quantity: "1", active: false, price_lists: null }] }],
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
});

it("limits catalog reads to the current 1000 rows through caller client", async () => {
  const limit = vi.fn().mockResolvedValue({ data: Array.from({ length: 1000 }, (_, id) => row({ id, packaging_options: [] })), error: null });
  const neq = vi.fn(() => ({ limit }));
  const eq = vi.fn(() => ({ neq }));
  const select = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ select }));
  const result = await readCatalog({ from } as never);
  expect(result.entries).toHaveLength(1000);
  expect(from).toHaveBeenCalledWith("product_variants");
  expect(eq).toHaveBeenCalledWith("active", true);
  expect(neq).toHaveBeenCalledWith("verification_status", "sample");
  expect(limit).toHaveBeenCalledWith(1000);
});
