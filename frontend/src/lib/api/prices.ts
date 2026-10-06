import { requestApi } from "./client";

export type PriceUpdateInput = { priceId: number; amount: number; expectedVersion: number; reason: string };
export type PriceWriteResult = { amount: number; version: number };
export type PriceUpdateResult = PriceWriteResult & { historyId: number };
export type CatalogUpdateInput = {
  categoryId: number; categoryName: string; productId: number; productName: string;
  variantId: number; variantDisplayName: string; rawSpecification: string;
  packagingId: number | null; packageName: string | null; packageQuantity: number | null; baseUnit: string | null;
  priceId: number | null; priceType: "retail" | "wholesale" | "dealer" | null;
  minimumQuantity: number | null; amount: number | null; expectedVersion: number | null;
};
export type CatalogUpdateResult = {
  ok: true;
  category: { id: number; name: string };
  product: { id: number; name: string };
  variant: { id: number; displayName: string; rawSpecification: string };
  packaging: null | { id: number; name: string; quantity: number; baseUnit: string };
  price: null | { id: number; amount: number; version: number; priceType: "retail" | "wholesale" | "dealer"; minimumQuantity: number };
};
export type PriceUndoInput = { historyId: number; expectedVersion: number };

export class OfflineWriteError extends Error {
  constructor() { super("Offline writes are disabled"); }
}

function ensureOnline(online: boolean): void {
  if (!online) throw new OfflineWriteError();
}

function post<T>(path: string, body: unknown): Promise<T> {
  return requestApi<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function updatePrice(input: PriceUpdateInput, online = true): Promise<PriceUpdateResult> {
  ensureOnline(online);
  const { priceId, ...body } = input;
  return await post(`/api/v1/prices/${priceId}/update`, body);
}

export async function updateCatalogItem(input: CatalogUpdateInput, online = true): Promise<CatalogUpdateResult> {
  ensureOnline(online);
  return await post("/api/v1/catalog/update", input);
}

export async function undoPrice(input: PriceUndoInput, online = true): Promise<PriceWriteResult> {
  ensureOnline(online);
  return await post("/api/v1/prices/undo", input);
}
