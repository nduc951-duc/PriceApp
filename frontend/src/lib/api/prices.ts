import { requestApi } from "./client";
import type { ApiPaths } from "./generated/api-types";

type PriceUpdateBody = ApiPaths["/api/v1/prices/{priceId}/update"]["post"]["requestBody"]["content"]["application/json"];
type PriceUpdateResponse = ApiPaths["/api/v1/prices/{priceId}/update"]["post"]["responses"]["200"]["content"]["application/json"];
type CatalogUpdateBody = ApiPaths["/api/v1/catalog/update"]["post"]["requestBody"]["content"]["application/json"];
type CatalogUpdateResponse = ApiPaths["/api/v1/catalog/update"]["post"]["responses"]["200"]["content"]["application/json"];
type PriceUndoBody = ApiPaths["/api/v1/prices/undo"]["post"]["requestBody"]["content"]["application/json"];
type PriceUndoResponse = ApiPaths["/api/v1/prices/undo"]["post"]["responses"]["200"]["content"]["application/json"];
export type PriceUpdateInput = PriceUpdateBody & { priceId: number };
export type PriceWriteResult = PriceUndoResponse;
export type PriceUpdateResult = PriceUpdateResponse;
export type CatalogUpdateInput = CatalogUpdateBody;
export type CatalogUpdateResult = CatalogUpdateResponse;
export type PriceUndoInput = PriceUndoBody;

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
