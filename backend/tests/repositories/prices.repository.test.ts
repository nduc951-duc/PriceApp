import { describe, expect, it, vi } from "vitest";
import { updatePrice, updateCatalogItem, undoPrice } from "../../src/repositories/prices.repository.js";

describe("audited price repository", () => {
  it("updates price only through the audited RPC and returns its history ID", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { amount: "125.50", version: 8 }, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 901 }, error: null });
    const filter = vi.fn(() => ({ maybeSingle }));
    const eq = vi.fn(() => ({ filter }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const result = await updatePrice({ rpc, from } as never, { priceId: 12, amount: 125.5, expectedVersion: 7, reason: "Counter correction" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("update_price_with_history", {
      p_price_id: 12, p_new_amount: 125.5, p_expected_version: 7, p_reason: "Counter correction",
    });
    expect(from).toHaveBeenCalledWith("price_history");
    expect(eq).toHaveBeenCalledWith("price_id", 12);
    expect(filter).toHaveBeenCalledWith("new_payload->>version", "eq", "8");
    expect(result).toEqual({ amount: 125.5, version: 8, historyId: 901 });
  });

  it("updates catalog only through its audited RPC and reads authoritative price after it", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { ok: true, price_version: 4 }, error: null });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { amount: "99.25", version: 4 }, error: null });
    const eq = vi.fn(() => ({ maybeSingle }));
    const select = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ select }));
    const input = { categoryId: 1, categoryName: "Fasteners", productId: 2, productName: "Bolt", variantId: 3,
      variantDisplayName: "M8", rawSpecification: "M8 x 20", packagingId: 4, packageName: "Box", packageQuantity: 10,
      baseUnit: "piece", priceId: 5, priceType: "retail", minimumQuantity: 1, amount: 99.25, expectedVersion: 3 };
    const result = await updateCatalogItem({ rpc, from } as never, input);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("update_catalog_item", {
      p_category_id: 1, p_category_name: "Fasteners", p_product_id: 2, p_product_name: "Bolt",
      p_variant_id: 3, p_variant_display_name: "M8", p_raw_specification: "M8 x 20",
      p_packaging_id: 4, p_package_name: "Box", p_package_quantity: 10, p_base_unit: "piece",
      p_price_id: 5, p_price_type: "retail", p_minimum_quantity: 1, p_amount: 99.25, p_expected_version: 3,
    });
    expect(from).toHaveBeenCalledWith("prices");
    expect(result).toMatchObject({ ok: true, price: { amount: 99.25, version: 4 } });
  });

  it("undoes only through the audited RPC with the exact expected version", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { amount: "77", version: 9 }, error: null });
    const result = await undoPrice({ rpc } as never, { historyId: 901, expectedVersion: 8 });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("undo_price_change", { p_history_id: 901, p_expected_version: 8 });
    expect(result).toEqual({ amount: 77, version: 9 });
  });

  it.each([
    [{ message: "version_conflict", code: "P0001" }, 409, "CONFLICT"],
    [{ message: "owner_required", code: "42501" }, 403, "FORBIDDEN"],
    [{ message: "duplicate key value violates unique constraint", code: "23505" }, 409, "CONFLICT"],
    [{ message: "invalid input", code: "22023" }, 422, "INVALID_INPUT"],
  ])("maps RPC error %j to the agreed API contract", async (error, statusCode, code) => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error });
    await expect(updatePrice({ rpc } as never, { priceId: 12, amount: 1, expectedVersion: 3, reason: "test" }))
      .rejects.toMatchObject({ statusCode, code });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
