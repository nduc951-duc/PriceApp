import type { RetrievedCatalogInput } from "./retrieved-context.js";

function namedVariant(row: RetrievedCatalogInput["catalog"][number]) {
  return { variantId: row.id, specification: row.specification, attributes: row.attributes,
    packages: row.packages.map(({ id, prices, ...pack }) => ({ packagingId: id, ...pack,
      prices: prices.map(({ id, ...price }) => ({ priceId: id, ...price })) })) };
}

function groupedCatalog(input: RetrievedCatalogInput) {
  const products = new Map<string, { productId: number; productName: string; category: string; description: string; variants: ReturnType<typeof namedVariant>[] }>();
  for (const row of input.catalog) {
    const facts = { productId: row.productId, productName: row.productName, category: row.category, description: row.description };
    const key = JSON.stringify(facts);
    const group = products.get(key) ?? { ...facts, variants: [] };
    group.variants.push(namedVariant(row));
    products.set(key, group);
  }
  return { products: [...products.values()] };
}

/** Lossless table serialization for providers with small free-tier token budgets. */
export function catalogPayload(input: RetrievedCatalogInput, compact = false, format: "table" | "grouped" = "table") {
  const compacted = compact && input.catalog.length > 0;
  const byId = new Map(input.catalog.map(row => [row.id, row]));
  const retrievedChunks = input.chunks.map(chunk => {
    if (!compacted) return chunk;
    try {
      const { provenance, ...facts } = JSON.parse(chunk.content);
      if (provenance === "current_sql" && JSON.stringify(facts) === JSON.stringify(byId.get(chunk.variantId))) {
        return { ...chunk, content: `current_sql variant:${chunk.variantId}; full facts in verifiedCatalog` };
      }
    } catch { /* Independent document text is retained in full. */ }
    return chunk;
  });
  const verifiedCatalog = compacted && format === "grouped" ? groupedCatalog(input) : compacted ? {
    columns: ["id", "productId", "productName", "category", "specification", "description", "attributes", "packages"],
    packageColumns: ["id", "name", "quantity", "unit", "prices"],
    priceColumns: ["id", "amount", "type", "minimumQuantity"],
    rows: input.catalog.map(row => [row.id, row.productId, row.productName, row.category, row.specification, row.description, row.attributes,
      row.packages.map(pack => [pack.id, pack.name, pack.quantity, pack.unit, pack.prices.map(price => [price.id, price.amount, price.type, price.minimumQuantity])])]),
  } : input.catalog;
  return { question: input.question, retrievedChunks, verifiedCatalog, previousVariantIds: input.previousVariantIds, truncated: input.truncated };
}
