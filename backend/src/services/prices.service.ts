import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";
import { catalogUpdateSchema, priceUndoSchema, priceUpdateSchema, type CatalogUpdateInput, type PriceUpdateInput, type PriceUndoInput } from "../schemas/prices.schema.js";
import { undoPrice, updateCatalogItem, updatePrice } from "../repositories/prices.repository.js";

function parseInput<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } }, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ApiError(422, "INVALID_INPUT", "Thông tin gửi lên chưa hợp lệ.");
  return result.data;
}

export async function changePrice(client: SupabaseClient, input: PriceUpdateInput) {
  const { priceId, ...fields } = input;
  const valid = parseInput(priceUpdateSchema, fields);
  return updatePrice(client, { ...valid, priceId });
}

export async function changeCatalogItem(client: SupabaseClient, input: CatalogUpdateInput) {
  return updateCatalogItem(client, parseInput(catalogUpdateSchema, input));
}

export async function undoPriceChange(client: SupabaseClient, input: PriceUndoInput) {
  return undoPrice(client, parseInput(priceUndoSchema, input));
}
