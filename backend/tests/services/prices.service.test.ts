import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ updatePrice: vi.fn(), updateCatalogItem: vi.fn(), undoPrice: vi.fn() }));
vi.mock("../../src/repositories/prices.repository.js", () => mocks);
import { changePrice, changeCatalogItem, undoPriceChange } from "../../src/services/prices.service.js";

beforeEach(() => vi.resetAllMocks());

it("validates write inputs before reaching the audited repository", async () => {
  await expect(changePrice({} as never, { priceId: 1, amount: -1, expectedVersion: 2, reason: "bad" } as never)).rejects.toMatchObject({ statusCode: 422 });
  await expect(undoPriceChange({} as never, { historyId: 1, expectedVersion: 0 } as never)).rejects.toMatchObject({ statusCode: 422 });
  expect(mocks.updatePrice).not.toHaveBeenCalled();
  expect(mocks.undoPrice).not.toHaveBeenCalled();
});

it("passes the validated expected versions unchanged to the repository use cases", async () => {
  const client = {} as never;
  mocks.updatePrice.mockResolvedValue({ amount: 125.5, version: 8, historyId: 901 });
  await expect(changePrice(client, { priceId: 12, amount: 125.5, expectedVersion: 7, reason: "Inventory correction" })).resolves.toMatchObject({ amount: 125.5, version: 8, historyId: 901 });
  expect(mocks.updatePrice).toHaveBeenCalledWith(client, { priceId: 12, amount: 125.5, expectedVersion: 7, reason: "Inventory correction" });
});

it("validates and forwards catalog and undo expected versions without changing them", async () => {
  const client = {} as never;
  mocks.updateCatalogItem.mockResolvedValue({ ok: true, price: { amount: 40, version: 6 } });
  const catalog = { categoryId: 1, categoryName: "C", productId: 2, productName: "P", variantId: 3,
    variantDisplayName: "V", rawSpecification: "S", packagingId: 4, packageName: "Box", packageQuantity: 10,
    baseUnit: "piece", priceId: 5, priceType: "retail", minimumQuantity: 1, amount: 40, expectedVersion: 5 } as const;
  await changeCatalogItem(client, catalog);
  expect(mocks.updateCatalogItem).toHaveBeenCalledWith(client, catalog);
  mocks.undoPrice.mockResolvedValue({ amount: 30, version: 7 });
  await undoPriceChange(client, { historyId: 901, expectedVersion: 6 });
  expect(mocks.undoPrice).toHaveBeenCalledWith(client, { historyId: 901, expectedVersion: 6 });
});
