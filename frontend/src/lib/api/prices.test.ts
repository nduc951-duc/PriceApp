import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ requestApi: vi.fn() }));
vi.mock("./client", () => ({ requestApi: mocks.requestApi }));
import { updatePrice, updateCatalogItem, undoPrice, OfflineWriteError } from "./prices.js";

beforeEach(() => vi.resetAllMocks());

it("uses API routes and preserves expected versions exactly", async () => {
  mocks.requestApi.mockResolvedValueOnce({ amount: 125.5, version: 8, historyId: 901 });
  await expect(updatePrice({ priceId: 12, amount: 125.5, expectedVersion: 7, reason: "edit" })).resolves.toEqual({ amount: 125.5, version: 8, historyId: 901 });
  expect(mocks.requestApi).toHaveBeenCalledWith("/api/v1/prices/12/update", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: 125.5, expectedVersion: 7, reason: "edit" }) });
});

it("sends catalog edits and undo through their backend endpoints", async () => {
  const catalogInput = { categoryId: 1, categoryName: "C", productId: 2, productName: "P", variantId: 3,
    variantDisplayName: "V", rawSpecification: "S", packagingId: 4, packageName: "Box", packageQuantity: 10,
    baseUnit: "piece", priceId: 5, priceType: "retail" as const, minimumQuantity: 1, amount: 99, expectedVersion: 6 };
  mocks.requestApi.mockResolvedValueOnce({ ok: true, price: { id: 5, amount: 99, version: 7, priceType: "retail", minimumQuantity: 1 } });
  await updateCatalogItem(catalogInput);
  expect(mocks.requestApi).toHaveBeenNthCalledWith(1, "/api/v1/catalog/update", expect.objectContaining({
    method: "POST", body: JSON.stringify(catalogInput),
  }));
  mocks.requestApi.mockResolvedValueOnce({ amount: 80, version: 8 });
  await undoPrice({ historyId: 901, expectedVersion: 7 });
  expect(mocks.requestApi).toHaveBeenNthCalledWith(2, "/api/v1/prices/undo", expect.objectContaining({
    method: "POST", body: JSON.stringify({ historyId: 901, expectedVersion: 7 }),
  }));
});

it("blocks every write before the request boundary while offline", async () => {
  const input = { priceId: 12, amount: 125.5, expectedVersion: 7, reason: "edit" };
  await expect(updatePrice(input, false)).rejects.toBeInstanceOf(OfflineWriteError);
  await expect(updateCatalogItem({} as never, false)).rejects.toBeInstanceOf(OfflineWriteError);
  await expect(undoPrice({ historyId: 9, expectedVersion: 7 }, false)).rejects.toBeInstanceOf(OfflineWriteError);
  expect(mocks.requestApi).not.toHaveBeenCalled();
});
