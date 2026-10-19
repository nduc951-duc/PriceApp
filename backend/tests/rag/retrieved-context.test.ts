import { expect, it } from "vitest";
import { retrievedCatalogAnswerSchemaFor, retrievedCatalogAnswerJsonSchema, type RetrievedCatalogInput } from "../../src/rag/retrieved-context.js";

it("constrains model citation strings to exact supplied chunk, variant and price references", () => {
  const input: RetrievedCatalogInput = { question: "giới thiệu bánh xe", history: [], previousVariantIds: [], truncated: false,
    chunks: [{ id: 2581, variantId: 252, content: "catalog", similarity: 0.8 }],
    catalog: [{ id: 252, productId: 98, productName: "Bánh xe", category: "Bánh xe", specification: "4F", description: "", attributes: {},
      packages: [{ id: 7, name: "1 cái", quantity: 1, unit: "cái", prices: [{ id: 8, amount: 12345, type: "retail", minimumQuantity: 1 }] }] }] };
  const allowed = retrievedCatalogAnswerSchemaFor(input).properties.evidenceIds.items.enum;
  expect(allowed).toEqual(["chunk:2581", "variant:252", "price:8"]);
  expect(allowed).not.toContain("2581");
  expect(allowed).not.toContain("product:98");
  expect(retrievedCatalogAnswerJsonSchema.properties.evidenceIds.items).not.toHaveProperty("enum");
});

it("never reuses evidence from a prior request", () => {
  const input: RetrievedCatalogInput = { question: "test", history: [], previousVariantIds: [], truncated: false, chunks: [], catalog: [] };
  expect(retrievedCatalogAnswerSchemaFor(input).properties.evidenceIds.items).not.toHaveProperty("enum");
});

it("bounds local model selections to the current catalog and keeps product listings free of price selections", () => {
  const input: RetrievedCatalogInput = { question: "bulong", history: [], previousVariantIds: [], truncated: false, chunks: [],
    catalog: [{ id: 47, productId: 2, productName: "Bulong", category: "", specification: "8 ly", description: "", attributes: {}, packages: [] }] };
  const schema = retrievedCatalogAnswerSchemaFor(input, true);
  expect(schema.properties).toMatchObject({
    selectedVariantIds: { items: { enum: [47] }, maxItems: 1 },
    selectedPriceIds: { maxItems: 0 },
    listedProductIds: { items: { enum: [2] } },
  });
  expect(schema).toHaveProperty("anyOf", expect.arrayContaining([expect.objectContaining({ required: retrievedCatalogAnswerJsonSchema.required, properties: expect.objectContaining({
    listingMode: expect.objectContaining({ enum: ["products"] }), selectedVariantIds: expect.objectContaining({ maxItems: 0 }), selectedPriceIds: expect.objectContaining({ maxItems: 0 }),
  }) })]));
});
