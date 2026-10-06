import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError } from "../middleware/errors.js";
import type { CatalogUpdateInput, CatalogUpdateResult, PriceUpdateInput, PriceUpdateResult, PriceUndoInput, PriceWriteResult } from "../schemas/prices.schema.js";

type RpcFailure = { message?: string; code?: string };
function throwRpcError(error: RpcFailure): never {
  const message = error.message ?? "Price update failed";
  if (message.includes("version_conflict")) throw new ApiError(409, "CONFLICT", "Giá đã được thay đổi. Tải lại bảng giá rồi thử lại.");
  if (message.includes("owner_required") || message.includes("forbidden") || error.code === "42501") throw new ApiError(403, "FORBIDDEN", "Tài khoản không có quyền thực hiện thao tác này.");
  if (message.includes("duplicate key") || error.code === "23505") throw new ApiError(409, "CONFLICT", "Tên hoặc dữ liệu này đã tồn tại.");
  if (message.includes("invalid input") || message.includes("required_catalog_field_missing") || message.includes("invalid_") || error.code === "22023") {
    throw new ApiError(422, "INVALID_INPUT", "Thông tin gửi lên chưa hợp lệ.");
  }
  if (message.includes("not found") || message.endsWith("_not_found")) throw new ApiError(404, "NOT_FOUND", "Không tìm thấy dữ liệu cần cập nhật.");
  throw new ApiError(500, "INTERNAL_ERROR", "Không thể lưu thay đổi lúc này.");
}

export async function updatePrice(client: SupabaseClient, input: PriceUpdateInput): Promise<PriceUpdateResult> {
  const { data, error } = await client.rpc("update_price_with_history", {
    p_price_id: input.priceId,
    p_new_amount: input.amount,
    p_expected_version: input.expectedVersion,
    p_reason: input.reason,
  });
  if (error) throwRpcError(error);
  const changed = data as unknown as { amount: number | string; version: number } | null;
  if (!changed) throw new ApiError(500, "INTERNAL_ERROR", "Không nhận được kết quả cập nhật giá.");
  const { data: history, error: historyError } = await client.from("price_history").select("id")
    .eq("price_id", input.priceId).filter("new_payload->>version", "eq", String(changed.version)).maybeSingle();
  if (historyError || !history) throw new ApiError(503, "INTERNAL_ERROR", "Giá đã được cập nhật nhưng chưa tải được mã lịch sử.");
  return { amount: Number(changed.amount), version: changed.version, historyId: Number(history.id) };
}

export async function updateCatalogItem(client: SupabaseClient, input: CatalogUpdateInput): Promise<CatalogUpdateResult> {
  const { data, error } = await client.rpc("update_catalog_item", {
    p_category_id: input.categoryId,
    p_category_name: input.categoryName,
    p_product_id: input.productId,
    p_product_name: input.productName,
    p_variant_id: input.variantId,
    p_variant_display_name: input.variantDisplayName,
    p_raw_specification: input.rawSpecification,
    p_packaging_id: input.packagingId,
    p_package_name: input.packageName,
    p_package_quantity: input.packageQuantity,
    p_base_unit: input.baseUnit,
    p_price_id: input.priceId,
    p_price_type: input.priceType,
    p_minimum_quantity: input.minimumQuantity,
    p_amount: input.amount,
    p_expected_version: input.expectedVersion,
  });
  if (error) throwRpcError(error);
  if (!data) throw new ApiError(500, "INTERNAL_ERROR", "Không nhận được kết quả cập nhật danh mục.");
  let price: CatalogUpdateResult["price"] = null;
  if (input.priceId !== null) {
    const { data: row, error: readError } = await client.from("prices")
      .select("id, amount, version, price_type, minimum_quantity").eq("id", input.priceId).maybeSingle();
    if (readError || !row) throw new ApiError(503, "INTERNAL_ERROR", "Danh mục đã được cập nhật nhưng chưa tải được giá mới.");
    price = {
      id: Number(row.id), amount: Number(row.amount), version: Number(row.version),
      priceType: row.price_type as "retail" | "wholesale" | "dealer", minimumQuantity: Number(row.minimum_quantity),
    };
  }
  return {
    ok: true,
    category: { id: input.categoryId, name: input.categoryName },
    product: { id: input.productId, name: input.productName },
    variant: { id: input.variantId, displayName: input.variantDisplayName, rawSpecification: input.rawSpecification },
    packaging: input.packagingId === null ? null : {
      id: input.packagingId, name: input.packageName!, quantity: input.packageQuantity!, baseUnit: input.baseUnit!,
    },
    price,
  };
}

export async function undoPrice(client: SupabaseClient, input: PriceUndoInput): Promise<PriceWriteResult> {
  const { data, error } = await client.rpc("undo_price_change", {
    p_history_id: input.historyId,
    p_expected_version: input.expectedVersion,
  });
  if (error) throwRpcError(error);
  const changed = data as unknown as { amount: number | string; version: number } | null;
  if (!changed) throw new ApiError(500, "INTERNAL_ERROR", "Không nhận được kết quả hoàn tác giá.");
  return { amount: Number(changed.amount), version: changed.version };
}
