import type { FastifyRequest } from "fastify";
import { changeCatalogItem, changePrice, undoPriceChange } from "../services/prices.service.js";
import { catalogUpdateSchema, priceIdParamsSchema, priceUndoSchema, priceUpdateSchema } from "../schemas/prices.schema.js";
import { ApiError } from "../middleware/errors.js";

function body<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(422, "INVALID_INPUT", "Thông tin gửi lên chưa hợp lệ.");
  return parsed.data;
}

export async function priceUpdate(request: FastifyRequest) {
  const { priceId } = body(priceIdParamsSchema, request.params);
  return changePrice(request.auth!.client, { ...body(priceUpdateSchema, request.body), priceId });
}

export function catalogUpdate(request: FastifyRequest) {
  return changeCatalogItem(request.auth!.client, body(catalogUpdateSchema, request.body));
}

export function priceUndo(request: FastifyRequest) {
  return undoPriceChange(request.auth!.client, body(priceUndoSchema, request.body));
}
