import { describe, expect, it, vi } from "vitest";
import { createCustomerOrderRequest, listCustomerOrderRequests, mapPublicCatalogRows, readPublicCatalog } from "./customer-orders.repository.js";
import { createCustomerOrderSubmissionProof } from "../services/customer-order-signature.js";
const proof = createCustomerOrderSubmissionProof("test-secret-at-least-32-characters-long", 1_800_000_000);

const row = (priceType: string, overrides: Record<string, unknown> = {}) => ({
  category: "Vít", product_name: "Vít tự khoan", variant_name: "Đầu dù 4x20",
  specification: "4 x 20 mm", packaging_name: "Gói 100 cái", package_quantity: "100", unit: "cái",
  price_id: 21, price_version: 3, price_type: priceType, minimum_quantity: "1", amount: "15000.00",
  ...overrides,
});

describe("customer order repository", () => {
  it("returns only safe retail and wholesale rows from the public catalog RPC", () => {
    const result = mapPublicCatalogRows([row("retail"), row("wholesale"), row("dealer"), row("retail", { supplier: "private" })]);
    expect(result).toEqual([
      { category: "Vít", name: "Vít tự khoan", variant: "Đầu dù 4x20", specification: "4 x 20 mm", productCode: null, aliases: [], packaging: "Gói 100 cái", packageQuantity: 100, unit: "cái", priceId: 21, version: 3, priceType: "retail", minimumQuantity: 1, price: 15000 },
      { category: "Vít", name: "Vít tự khoan", variant: "Đầu dù 4x20", specification: "4 x 20 mm", productCode: null, aliases: [], packaging: "Gói 100 cái", packageQuantity: 100, unit: "cái", priceId: 21, version: 3, priceType: "wholesale", minimumQuantity: 1, price: 15000 },
      { category: "Vít", name: "Vít tự khoan", variant: "Đầu dù 4x20", specification: "4 x 20 mm", productCode: null, aliases: [], packaging: "Gói 100 cái", packageQuantity: 100, unit: "cái", priceId: 21, version: 3, priceType: "retail", minimumQuantity: 1, price: 15000 },
    ]);
    expect(JSON.stringify(result)).not.toContain("supplier");
  });

  it("maps public SKU and aliases for direct catalog search", () => {
    const [mapped] = mapPublicCatalogRows([row("retail", { product_code: "TK-650", aliases: ["Tắc kê đạn"] })]);
    expect(mapped).toMatchObject({ productCode: "TK-650", aliases: ["Tắc kê đạn"] });
  });

  it("reads public catalog only through its narrow RPC", async () => {
    const rpc = vi.fn(async () => ({ data: [row("retail")], error: null }));
    const result = await readPublicCatalog({ rpc } as never);
    expect(rpc).toHaveBeenCalledWith("get_public_customer_catalog");
    expect(result.items[0]).toMatchObject({ priceId: 21, price: 15000, priceType: "retail" });
  });

  it("submits identifiers, versions and quantities but never client prices", async () => {
    const rpc = vi.fn(async () => ({ data: { request_id: "id-1", reference: "DH-ABC123", subtotal: 30000, status: "pending_confirmation", item_count: 2 }, error: null }));
    const result = await createCustomerOrderRequest({ rpc } as never, {
      customerName: "Lan", phone: "0901234567", items: [{ priceId: 21, version: 3, quantity: 2 }],
    }, proof);
    expect(rpc).toHaveBeenCalledWith("create_customer_order_request", expect.objectContaining({
      p_customer_name: "Lan", p_phone: "0901234567", p_delivery_address: null, p_delivery_notes: null,
      p_items: [{ price_id: 21, version: 3, quantity: 2 }],
      p_nonce: proof.nonce, p_timestamp: proof.timestamp, p_signature: proof.signature,
    }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("amount");
    expect(result).toEqual({ requestId: "id-1", reference: "DH-ABC123", subtotal: 30000, status: "pending_confirmation", itemCount: 2 });
  });

  it("turns changed-price errors into a conflict that requires refreshed review", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "P0001", message: "price_version_conflict" } }));
    await expect(createCustomerOrderRequest({ rpc } as never, {
      customerName: "Lan", phone: "0901234567", items: [{ priceId: 21, version: 2, quantity: 1 }],
    }, proof)).rejects.toMatchObject({ statusCode: 409, code: "CONFLICT" });
  });

  it("rejects a quantity below the canonical package minimum", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "P0001", message: "below_minimum" } }));
    await expect(createCustomerOrderRequest({ rpc } as never, {
      customerName: "Lan", phone: "0901234567", items: [{ priceId: 22, version: 3, quantity: 1 }],
    }, proof)).rejects.toMatchObject({ statusCode: 422, code: "INVALID_INPUT" });
  });

  it("lists snapshots only through the authenticated request query", async () => {
    const rows = [{ id: "id-1", status: "pending_confirmation", customer_name: "Lan", phone: "0901234567", subtotal: "30000", customer_order_request_items: [] }];
    const order = vi.fn(async () => ({ data: rows, error: null }));
    const select = vi.fn(() => ({ order }));
    const from = vi.fn(() => ({ select }));
    const result = await listCustomerOrderRequests({ from } as never);
    expect(from).toHaveBeenCalledWith("customer_order_requests");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "id-1", customerName: "Lan", phone: "0901234567" });
  });
});
