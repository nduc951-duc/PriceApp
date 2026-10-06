import { expect, it, vi } from "vitest";
import { priceUpdate, catalogUpdate, priceUndo } from "./prices.controller.js";

vi.mock("../services/prices.service.js", () => ({
  changePrice: vi.fn().mockResolvedValue({ amount: 40, version: 2, historyId: 7 }),
  changeCatalogItem: vi.fn().mockResolvedValue({ ok: true, price: { amount: 40, version: 2 } }),
  undoPriceChange: vi.fn().mockResolvedValue({ amount: 30, version: 3 }),
}));
import { changePrice, changeCatalogItem, undoPriceChange } from "../services/prices.service.js";

const request = (body: unknown, params: unknown = {}) => ({ auth: { client: "caller-client" }, body, params }) as never;

it("passes the caller-scoped client and route price ID to the update service", async () => {
  await expect(priceUpdate(request({ amount: 40, expectedVersion: 1, reason: "correction" }, { priceId: "9" }))).resolves.toEqual({ amount: 40, version: 2, historyId: 7 });
  expect(changePrice).toHaveBeenCalledWith("caller-client", { priceId: 9, amount: 40, expectedVersion: 1, reason: "correction" });
});

it("passes caller client and catalog fields into catalog service", async () => {
  const body = { categoryId: 1, categoryName: "C", productId: 2, productName: "P", variantId: 3, variantDisplayName: "V", rawSpecification: "S", packagingId: null, packageName: null, packageQuantity: null, baseUnit: null, priceId: null, priceType: null, minimumQuantity: null, amount: null, expectedVersion: null };
  await catalogUpdate(request(body));
  expect(changeCatalogItem).toHaveBeenCalledWith("caller-client", body);
});

it("passes caller client and undo version to undo service", async () => {
  await priceUndo(request({ historyId: 7, expectedVersion: 2 }));
  expect(undoPriceChange).toHaveBeenCalledWith("caller-client", { historyId: 7, expectedVersion: 2 });
});
