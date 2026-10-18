import { z } from "zod";

export const publicCatalogResponseSchema = z.object({
  items: z.array(z.object({
    category: z.string(), name: z.string(), variant: z.string(), specification: z.string(),
    productCode: z.string().nullable(), aliases: z.array(z.string()), packaging: z.string(),
    packageQuantity: z.number().positive(), unit: z.string(), priceId: z.number().int().positive(), version: z.number().int().positive(),
    priceType: z.enum(["retail", "wholesale"]), minimumQuantity: z.number().positive(), price: z.number().nonnegative(),
  })), syncedAt: z.string(),
});

export const customerOrderBodySchema = z.strictObject({
  customerName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(8).max(24).regex(/^[0-9+() .-]+$/),
  idempotencyKey: z.uuid(),
  deliveryAddress: z.string().trim().max(500).optional(),
  deliveryNotes: z.string().trim().max(1000).optional(),
  website: z.string().max(0).optional(),
  items: z.array(z.strictObject({ priceId: z.number().int().positive(), version: z.number().int().positive(), quantity: z.number().positive().max(10000) })).min(1).max(50),
});

export const customerOrderReceiptSchema = z.object({ requestId: z.uuid(), reference: z.string(), subtotal: z.number().nonnegative(), status: z.literal("pending_confirmation"), itemCount: z.number().int().positive() });
export const customerOrderListSchema = z.object({ requests: z.array(z.object({
  id: z.uuid(), reference: z.string(), status: z.enum(["pending_confirmation", "contacted", "confirmed", "cancelled"]),
  customerName: z.string(), phone: z.string(), deliveryAddress: z.string().nullable(), deliveryNotes: z.string().nullable(),
  subtotal: z.number().nonnegative(), createdAt: z.string(), items: z.array(z.object({ productName: z.string(), variantName: z.string(),
    packaging: z.string(), packageQuantity: z.number().positive(), priceType: z.enum(["retail", "wholesale"]), quantity: z.number().positive(), unitPrice: z.number().nonnegative(), lineTotal: z.number().nonnegative(), unit: z.string() })),
})) });
export const customerOrderStatusBodySchema = z.strictObject({ status: z.enum(["contacted", "confirmed", "cancelled"]) });
export const customerOrderIdParamsSchema = z.strictObject({ requestId: z.uuid() });
