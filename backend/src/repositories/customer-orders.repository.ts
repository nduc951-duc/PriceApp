import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";
import type { CustomerOrderSubmissionProof } from "../services/customer-order-signature.js";

export type PublicPriceType = "retail" | "wholesale";
export type PublicCatalogItem = {
  category: string; name: string; variant: string; specification: string; packaging: string;
  packageQuantity: number; unit: string; priceId: number; version: number;
  priceType: PublicPriceType; minimumQuantity: number; price: number;
};
export type CustomerOrderInput = {
  customerName: string; phone: string; deliveryAddress?: string; deliveryNotes?: string;
  items: Array<{ priceId: number; version: number; quantity: number }>;
};
export type CustomerOrderReceipt = {
  requestId: string; reference: string; subtotal: number; status: "pending_confirmation"; itemCount: number;
};
export type CustomerOrderItemSnapshot = {
  productName: string; variantName: string; packaging: string; priceType: PublicPriceType;
  quantity: number; unitPrice: number; lineTotal: number; unit: string;
};
export type CustomerOrderRequest = {
  id: string; reference: string; status: "pending_confirmation" | "contacted" | "confirmed" | "cancelled";
  customerName: string; phone: string; deliveryAddress: string | null; deliveryNotes: string | null;
  subtotal: number; createdAt: string; items: CustomerOrderItemSnapshot[];
};

type PublicCatalogRow = {
  category: string; product_name: string; variant_name: string; specification: string;
  packaging_name: string; package_quantity: string | number; unit: string; price_id: number;
  price_version: number; price_type: string; minimum_quantity: string | number; amount: string | number;
};

export function mapPublicCatalogRows(rows: PublicCatalogRow[]): PublicCatalogItem[] {
  return rows.flatMap(row => {
    if (row.price_type !== "retail" && row.price_type !== "wholesale") return [];
    const numbers = [Number(row.package_quantity), Number(row.minimum_quantity), Number(row.amount)];
    if (!numbers.every(Number.isFinite) || numbers[0] <= 0 || numbers[1] <= 0 || numbers[2] < 0 || !Number.isSafeInteger(row.price_id) || !Number.isSafeInteger(row.price_version)) return [];
    return [{ category: row.category, name: row.product_name, variant: row.variant_name, specification: row.specification,
      packaging: row.packaging_name, packageQuantity: numbers[0], unit: row.unit, priceId: row.price_id,
      version: row.price_version, priceType: row.price_type, minimumQuantity: numbers[1], price: numbers[2] }];
  });
}

export async function readPublicCatalog(client: SupabaseClient): Promise<{ items: PublicCatalogItem[]; syncedAt: string }> {
  const { data, error } = await client.rpc("get_public_customer_catalog");
  if (error) throw new ApiError(503, "INTERNAL_ERROR", "Public catalog unavailable");
  const rows = Array.isArray(data) ? data as PublicCatalogRow[] : [];
  return { items: mapPublicCatalogRows(rows), syncedAt: new Date().toISOString() };
}

export async function createCustomerOrderRequest(client: SupabaseClient, input: CustomerOrderInput, proof: CustomerOrderSubmissionProof): Promise<CustomerOrderReceipt> {
  const { data, error } = await client.rpc("create_customer_order_request", {
    p_customer_name: input.customerName.trim(), p_phone: input.phone.trim(),
    p_delivery_address: input.deliveryAddress?.trim() || null, p_delivery_notes: input.deliveryNotes?.trim() || null,
    p_items: input.items.map(item => ({ price_id: item.priceId, version: item.version, quantity: item.quantity })),
    p_nonce: proof.nonce, p_timestamp: proof.timestamp, p_signature: proof.signature,
  });
  if (error) {
    if (/price_version_conflict|order_price_changed|price_not_public/i.test(error.message)) throw new ApiError(409, "CONFLICT", "Giá vừa thay đổi. Vui lòng kiểm tra lại giỏ hàng.");
    if (/below_minimum|invalid_order_item/i.test(error.message)) throw new ApiError(422, "INVALID_INPUT", "Số lượng hoặc mặt hàng không còn hợp lệ.");
    throw new ApiError(503, "INTERNAL_ERROR", "Could not create order request");
  }
  const result = data as Record<string, unknown>;
  if (!result || typeof result.request_id !== "string" || typeof result.reference !== "string" || !Number.isFinite(Number(result.subtotal)) || result.status !== "pending_confirmation") {
    throw new ApiError(503, "INTERNAL_ERROR", "Invalid order response");
  }
  return { requestId: result.request_id, reference: result.reference, subtotal: Number(result.subtotal), status: "pending_confirmation", itemCount: Number(result.item_count) };
}

type CustomerOrderRow = {
  id: string; reference: string; status: CustomerOrderRequest["status"]; customer_name: string; phone: string;
  delivery_address: string | null; delivery_notes: string | null; subtotal: string | number; created_at: string;
  customer_order_request_items?: Array<{ product_name: string; variant_name: string; packaging_name: string; price_type: PublicPriceType; quantity: string | number; unit_price: string | number; line_total: string | number; unit: string }> | null;
};

export function mapCustomerOrderRows(rows: CustomerOrderRow[]): CustomerOrderRequest[] {
  return rows.map(row => ({ id: row.id, reference: row.reference, status: row.status, customerName: row.customer_name,
    phone: row.phone, deliveryAddress: row.delivery_address, deliveryNotes: row.delivery_notes, subtotal: Number(row.subtotal), createdAt: row.created_at,
    items: (row.customer_order_request_items ?? []).map(item => ({ productName: item.product_name, variantName: item.variant_name,
      packaging: item.packaging_name, priceType: item.price_type, quantity: Number(item.quantity), unitPrice: Number(item.unit_price),
      lineTotal: Number(item.line_total), unit: item.unit })) }));
}

export async function listCustomerOrderRequests(client: SupabaseClient): Promise<CustomerOrderRequest[]> {
  const { data, error } = await client.from("customer_order_requests").select(`
    id, reference, status, customer_name, phone, delivery_address, delivery_notes, subtotal, created_at,
    customer_order_request_items(product_name, variant_name, packaging_name, price_type, quantity, unit_price, line_total, unit)
  `).order("created_at", { ascending: false });
  if (error) throw new ApiError(503, "INTERNAL_ERROR", "Customer order requests unavailable");
  return mapCustomerOrderRows((data ?? []) as unknown as CustomerOrderRow[]);
}

export async function updateCustomerOrderStatus(client: SupabaseClient, requestId: string, status: "contacted" | "confirmed" | "cancelled"): Promise<void> {
  const { error } = await client.rpc("update_customer_order_request_status", { p_request_id: requestId, p_status: status });
  if (error) {
    if (/not_found/i.test(error.message)) throw new ApiError(404, "NOT_FOUND", "Customer request not found");
    if (/invalid_transition/i.test(error.message)) throw new ApiError(409, "CONFLICT", "Request status has changed");
    throw new ApiError(503, "INTERNAL_ERROR", "Could not update request status");
  }
}
