import { z } from "zod";

const positiveId = z.number().int().positive();
const attributeMap = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

const variantInputSchema = z.strictObject({
  id: positiveId,
  productId: positiveId,
  productName: z.string().trim().min(1),
  variant: z.string(),
  category: z.string(),
  aliases: z.array(z.string()),
  attributes: attributeMap,
  active: z.boolean(),
  verificationStatus: z.string(),
  sourcePages: z.array(z.number().int().positive()),
});

const priceInputSchema = z.strictObject({
  id: positiveId,
  variantId: positiveId,
  packageId: positiveId,
  version: z.number().int().nonnegative(),
  amount: z.number().finite().nonnegative(),
  tier: z.enum(["retail", "wholesale", "dealer"]),
  minimumQuantity: z.number().finite().positive(),
  packageName: z.string(),
  packageQuantity: z.number().finite().positive(),
  unit: z.string().trim().min(1),
  priceListName: z.string(),
  supplierName: z.string(),
  currency: z.string().trim().min(1),
  active: z.boolean(),
  validFrom: z.string().datetime({ offset: true }).nullable(),
  validTo: z.string().datetime({ offset: true }).nullable(),
  isSample: z.boolean(),
  supplierActive: z.boolean(),
});

const documentInputSchema = z.strictObject({
  id: positiveId,
  variantId: positiveId,
  sourcePageId: positiveId.nullable(),
  pageNumber: positiveId.nullable(),
  sourceRevision: z.number().int().nonnegative().nullable(),
  sourceSpan: z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }).nullable(),
  chunkKey: z.string().min(1),
  content: z.string().trim().min(1),
  evidenceKind: z.literal("verified_catalog"),
  current: z.boolean(),
  publicVisible: z.boolean(),
});

const catalogPageSchema = z.strictObject({
  total: z.number().int().nonnegative(),
  nextCursor: positiveId.nullable(),
  complete: z.boolean(),
});

export const evidencePacketInputSchema = z.strictObject({
  role: z.enum(["customer", "staff"]),
  now: z.date().optional(),
  variants: z.array(variantInputSchema),
  prices: z.array(priceInputSchema),
  documents: z.array(documentInputSchema),
  catalogPage: catalogPageSchema.optional(),
});

export type EvidencePacketInput = z.input<typeof evidencePacketInputSchema>;
export type EvidenceRole = "customer" | "staff";
export type CatalogEvidence = {
  id: `variant:${number}`;
  kind: "catalog";
  variantId: number;
  productId: number;
  productName: string;
  variant: string;
  category: string;
  aliases: string[];
  attributes: Record<string, string | number | boolean | null>;
  sourcePages: number[];
};
export type PriceEvidence = {
  id: `price:${number}`;
  kind: "price";
  variantId: number;
  priceId: number;
  packageId: number;
  version: number;
  amount: number;
  currency: string;
  tier: "retail" | "wholesale" | "dealer";
  minimumQuantity: number;
  packageName: string;
  packageQuantity: number;
  unit: string;
  priceListName: string;
  supplierName: string;
};
export type DocumentEvidence = {
  id: `chunk:${number}`;
  kind: "document";
  variantId: number;
  sourcePageId: number | null;
  pageNumber: number | null;
  sourceRevision: number | null;
  sourceSpan: { start: number; end: number } | null;
  chunkKey: string;
  excerpt: string;
  evidenceKind: "verified_catalog";
};
export type EvidenceEntry = CatalogEvidence | PriceEvidence | DocumentEvidence;
export type EvidencePacket = {
  role: EvidenceRole;
  entries: EvidenceEntry[];
  catalogPage?: z.infer<typeof catalogPageSchema>;
};

function isCurrentPrice(price: z.infer<typeof priceInputSchema>, variantIds: Set<number>, role: EvidenceRole, now: Date) {
  const validFrom = price.validFrom ? Date.parse(price.validFrom) : Number.NEGATIVE_INFINITY;
  const validTo = price.validTo ? Date.parse(price.validTo) : Number.POSITIVE_INFINITY;
  return variantIds.has(price.variantId)
    && price.active
    && price.supplierActive
    && !price.isSample
    && validFrom <= now.getTime()
    && now.getTime() < validTo
    && (role === "staff" || price.tier !== "dealer");
}

export function buildEvidencePacket(rawInput: EvidencePacketInput): EvidencePacket {
  const input = evidencePacketInputSchema.parse(rawInput);
  const now = input.now ?? new Date();
  const variants = input.variants.filter((variant) => variant.active && variant.verificationStatus === "verified");
  const variantIds = new Set(variants.map(({ id }) => id));
  const entries: EvidenceEntry[] = [];

  for (const variant of variants) {
    entries.push({
      id: `variant:${variant.id}`,
      kind: "catalog",
      variantId: variant.id,
      productId: variant.productId,
      productName: variant.productName,
      variant: variant.variant,
      category: variant.category,
      aliases: variant.aliases,
      attributes: variant.attributes,
      sourcePages: [...new Set(variant.sourcePages)].sort((a, b) => a - b),
    });
  }

  for (const price of input.prices) {
    if (!isCurrentPrice(price, variantIds, input.role, now)) continue;
    entries.push({
      id: `price:${price.id}`,
      kind: "price",
      variantId: price.variantId,
      priceId: price.id,
      packageId: price.packageId,
      version: price.version,
      amount: price.amount,
      currency: price.currency,
      tier: price.tier,
      minimumQuantity: price.minimumQuantity,
      packageName: price.packageName,
      packageQuantity: price.packageQuantity,
      unit: price.unit,
      priceListName: price.priceListName,
      supplierName: price.supplierName,
    });
  }

  for (const document of input.documents) {
    if (!document.current || !variantIds.has(document.variantId)) continue;
    if (input.role === "customer" && !document.publicVisible) continue;
    entries.push({
      id: `chunk:${document.id}`,
      kind: "document",
      variantId: document.variantId,
      sourcePageId: document.sourcePageId,
      pageNumber: document.pageNumber,
      sourceRevision: document.sourceRevision,
      sourceSpan: document.sourceSpan,
      chunkKey: document.chunkKey,
      excerpt: document.content,
      evidenceKind: document.evidenceKind,
    });
  }

  return {
    role: input.role,
    entries,
    ...(input.catalogPage ? { catalogPage: input.catalogPage } : {}),
  };
}
