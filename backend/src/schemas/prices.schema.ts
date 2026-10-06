import { z } from "zod";

const positiveId = z.number().int().positive();
const nullableText = z.string().trim().min(1).nullable();
const nullablePositive = z.number().positive().nullable();

export const priceUpdateSchema = z.object({
  amount: z.number().finite().nonnegative().max(999_999_999_999),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(1).max(500),
}).strict();
export const priceIdParamsSchema = z.object({ priceId: z.coerce.number().int().positive() });
export const priceUndoSchema = z.object({ historyId: positiveId, expectedVersion: z.number().int().positive() }).strict();
export const catalogUpdateSchema = z.object({
  categoryId: positiveId,
  categoryName: z.string().trim().min(1).max(200),
  productId: positiveId,
  productName: z.string().trim().min(1).max(200),
  variantId: positiveId,
  variantDisplayName: z.string().trim().min(1).max(200),
  rawSpecification: z.string().trim().min(1).max(500),
  packagingId: positiveId.nullable(),
  packageName: nullableText,
  packageQuantity: nullablePositive,
  baseUnit: nullableText,
  priceId: positiveId.nullable(),
  priceType: z.enum(["retail", "wholesale", "dealer"]).nullable(),
  minimumQuantity: nullablePositive,
  amount: z.number().finite().nonnegative().max(999_999_999_999).nullable(),
  expectedVersion: z.number().int().positive().nullable(),
}).strict().superRefine((value, ctx) => {
  const hasPrice = value.priceId !== null;
  const priceFields = [value.priceType, value.minimumQuantity, value.amount, value.expectedVersion];
  if (hasPrice && priceFields.some(field => field === null)) ctx.addIssue({ code: "custom", message: "Price fields are required when priceId is set" });
  if (!hasPrice && priceFields.some(field => field !== null)) ctx.addIssue({ code: "custom", message: "Price fields must be null when priceId is empty" });
  const packageFields = [value.packageName, value.packageQuantity, value.baseUnit];
  if (value.packagingId === null && packageFields.some(field => field !== null)
      || value.packagingId !== null && packageFields.some(field => field === null)) {
    ctx.addIssue({ code: "custom", message: "Packaging fields must be provided together" });
  }
  if (hasPrice && value.packagingId === null) ctx.addIssue({ code: "custom", message: "A price requires a packaging option" });
});

export type PriceUpdateInput = z.infer<typeof priceUpdateSchema> & { priceId: number };
export type PriceUndoInput = z.infer<typeof priceUndoSchema>;
export type CatalogUpdateInput = z.infer<typeof catalogUpdateSchema>;
export type PriceWriteResult = { amount: number; version: number };
export type PriceUpdateResult = PriceWriteResult & { historyId: number };
export type CatalogUpdateResult = {
  ok: true;
  category: { id: number; name: string };
  product: { id: number; name: string };
  variant: { id: number; displayName: string; rawSpecification: string };
  packaging: null | { id: number; name: string; quantity: number; baseUnit: string };
  price: null | { id: number; amount: number; version: number; priceType: "retail" | "wholesale" | "dealer"; minimumQuantity: number };
};
