import { expect, it } from "vitest";
import { catalogPayload } from "../../src/rag/compact-context.js";
import type { RetrievedCatalogInput } from "../../src/rag/retrieved-context.js";

it("compacts repeated SQL evidence without dropping facts, prices, raw documents or question context", () => {
  const row = { id: 47, productId: 2, productName: "Bulong", category: "Vật tư", specification: "8 ly x 3F", description: "Có tán", attributes: { material: "thép" },
    packages: [{ id: 84, name: "10 bộ", quantity: 10, unit: "bộ", prices: [{ id: 85, amount: 9000, type: "retail", minimumQuantity: 1 }] }] };
  const input: RetrievedCatalogInput = { question: "loại đó giá sỉ?", history: [], previousVariantIds: [47], truncated: false, catalog: [row],
    chunks: [{ id: 11, variantId: 47, content: JSON.stringify({ provenance: "current_sql", ...row }), similarity: 0.8 },
      { id: 12, variantId: 47, content: "Independent technical document: do not truncate this.", similarity: 0.6 }] };
  const compact = catalogPayload(input, true);
  expect(compact.question).toBe(input.question);
  expect(compact.previousVariantIds).toEqual([47]);
  const table = compact.verifiedCatalog as { columns: string[]; rows: unknown[][]; packageColumns: string[]; priceColumns: string[] };
  const restored = Object.fromEntries(table.columns.map((key,index) => [key, table.rows[0]![index]]));
  restored.packages = (restored.packages as unknown[][]).map(values => {
    const pack = Object.fromEntries(table.packageColumns.map((key,index) => [key, values[index]]));
    pack.prices = (pack.prices as unknown[][]).map(values => Object.fromEntries(table.priceColumns.map((key,index) => [key, values[index]])));
    return pack;
  });
  expect(restored).toEqual(row);
  expect(compact.retrievedChunks[0]?.content).toContain("variant:47");
  expect(compact.retrievedChunks[1]?.content).toBe(input.chunks[1]!.content);
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(catalogPayload(input)).length);
});

it("keeps SQL-tagged text when its content differs from the supplied live catalog", () => {
  const input: RetrievedCatalogInput = { question: "test", history: [], previousVariantIds: [], catalog: [], truncated: false,
    chunks: [{ id: 1, variantId: 47, content: '{"provenance":"current_sql","extra":"fact"}', similarity: 0.8 }] };
  expect(catalogPayload(input, true).retrievedChunks[0]?.content).toBe(input.chunks[0]!.content);
});

it("groups local catalog facts with explicit ID names without losing a variant or price", () => {
  const row = { id: 47, productId: 2, productName: "Bulong", category: "Vật tư", specification: "8 ly x 3F", description: "Có tán", attributes: { material: "thép" },
    packages: [{ id: 84, name: "10 bộ", quantity: 10, unit: "bộ", prices: [{ id: 85, amount: 9000, type: "retail", minimumQuantity: 1 }] }] };
  const input: RetrievedCatalogInput = { question: "bulong", history: [], previousVariantIds: [], truncated: false, chunks: [], catalog: [row] };
  const payload = catalogPayload(input, true, "grouped");
  expect(payload.verifiedCatalog).toEqual({ products: [{ productId: 2, productName: "Bulong", category: "Vật tư", description: "Có tán",
    variants: [{ variantId: 47, specification: "8 ly x 3F", attributes: { material: "thép" },
      packages: [{ packagingId: 84, name: "10 bộ", quantity: 10, unit: "bộ", prices: [{ priceId: 85, amount: 9000, type: "retail", minimumQuantity: 1 }] }] }] }] });
});
