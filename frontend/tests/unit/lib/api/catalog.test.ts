import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requestApi: vi.fn() }));
vi.mock("../../../../src/lib/api/client", () => ({ requestApi: mocks.requestApi }));
import { fetchCatalog } from "../../../../src/lib/api/catalog";

it("reads the catalog response through the authenticated API", async () => {
  const payload = { entries: [{ variantId: 3 }], prices: [{ id: 4, price: 12345.5 }], syncedAt: "2026-10-06T00:00:00.000Z" };
  mocks.requestApi.mockResolvedValue(payload);
  expect(await fetchCatalog()).toBe(payload);
  expect(mocks.requestApi).toHaveBeenCalledWith("/api/v1/catalog");
});
