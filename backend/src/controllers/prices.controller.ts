import type { FastifyRequest } from "fastify";
import { changeCatalogItem, changePrice, undoPriceChange } from "../services/prices.service.js";
import { catalogUpdateSchema, demoPriceApplySchema, demoPriceRollbackSchema, priceIdParamsSchema, priceUndoSchema, priceUpdateSchema } from "../schemas/prices.schema.js";
import { ApiError } from "../middleware/errors.js";

function body<T>(schema: { safeParse: (input: unknown) => { success: true; data: T } | { success: false } }, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(422, "INVALID_INPUT", "Thông tin gửi lên chưa hợp lệ.");
  return parsed.data;
}

export async function priceUpdate(request: FastifyRequest) {
  const { priceId } = body(priceIdParamsSchema, request.params);
  return changePrice(request.auth!.client, { ...body(priceUpdateSchema, request.body), priceId });
}

export function catalogUpdate(request: FastifyRequest) {
  return changeCatalogItem(request.auth!.client, body(catalogUpdateSchema, request.body));
}

export function priceUndo(request: FastifyRequest) {
  return undoPriceChange(request.auth!.client, body(priceUndoSchema, request.body));
}

export async function demoPricePreview(request: FastifyRequest) {
  const { data, error } = await request.auth!.client.rpc("preview_demo_price_backfill");
  if (error) throw new ApiError(error.code === "42501" ? 403 : 503, error.code === "42501" ? "FORBIDDEN" : "INTERNAL_ERROR", "Không thể tạo bản xem trước giá demo.");
  const preview = data as { batchId: string; snapshotHash: string; ruleVersion: string; count: number; items: Array<Record<string, unknown>> };
  return { ...preview, items: preview.items.map(item => ({ ...item, amount: Number(item.amount), referencePriceIds: (item.referencePriceIds as unknown[]).map(Number) })) };
}

export async function demoPriceApply(request: FastifyRequest) {
  const input = body(demoPriceApplySchema, request.body);
  const { data, error } = await request.auth!.client.rpc("apply_demo_price_backfill", { p_snapshot_hash: input.snapshotHash });
  if (error) {
    if (error.code === "42501") throw new ApiError(403, "FORBIDDEN", "Chỉ chủ cửa hàng được tạo giá demo.");
    if (error.code === "40001") throw new ApiError(409, "CONFLICT", "Danh mục đã thay đổi sau khi xem trước. Hãy tạo bản xem trước mới.");
    throw new ApiError(422, "INVALID_INPUT", "Không thể áp dụng lô giá demo này.");
  }
  return data;
}

export async function demoPriceRollback(request: FastifyRequest) {
  const input = body(demoPriceRollbackSchema, request.body);
  const { data, error } = await request.auth!.client.rpc("rollback_demo_price_backfill", { p_batch_id: input.batchId });
  if (error) {
    if (error.code === "42501") throw new ApiError(403, "FORBIDDEN", "Chỉ chủ cửa hàng được hoàn tác giá demo.");
    if (error.code === "40001") throw new ApiError(409, "CONFLICT", "Một số giá đã được sửa hoặc dùng trong đơn; không thể hoàn tác an toàn.");
    throw new ApiError(422, "INVALID_INPUT", "Không thể hoàn tác lô giá demo này.");
  }
  return data;
}
