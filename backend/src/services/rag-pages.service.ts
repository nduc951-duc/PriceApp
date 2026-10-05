import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthContext } from "./auth.service.js";
import { ApiError } from "../middleware/errors.js";
import { ragPagesRepository } from "../repositories/rag-pages.repository.js";

export async function listRagPages(client: SupabaseClient) {
  const { data, error } = await ragPagesRepository(client).list();
  if (error) throw new Error("RAG repository unavailable");
  const pages = (data ?? []).map(row => {
    const source = row.source_pages as unknown as { page_number: number | null };
    return { sourcePageId: row.source_page_id, pageNumber: source.page_number, title: row.title, extractedText: row.extracted_text, reviewStatus: row.review_status, revision: row.revision };
  });
  return { pages };
}

export async function saveRagPage(body: unknown, auth: AuthContext) {
  const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const sourcePageId = Number(input.sourcePageId);
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const extractedText = typeof input.extractedText === "string" ? input.extractedText.trim() : "";
  const reviewStatus = input.reviewStatus;
  if (!Number.isInteger(sourcePageId) || sourcePageId < 1 || title.length > 200 || extractedText.length > 100_000) {
    throw new ApiError(400, "INVALID_INPUT", "Thông tin trang không hợp lệ hoặc văn bản vượt quá 100.000 ký tự.");
  }
  if (reviewStatus !== "draft" && reviewStatus !== "approved" && reviewStatus !== "rejected") throw new ApiError(400, "INVALID_INPUT", "Trạng thái duyệt không hợp lệ.");
  if (reviewStatus === "approved" && !extractedText) throw new ApiError(400, "INVALID_INPUT", "Cần nhập nội dung trang trước khi duyệt.");
  const { data, error } = await ragPagesRepository(auth.client).save({
    source_page_id: sourcePageId, title: title || `Sổ giá - Trang ${sourcePageId}`, extracted_text: extractedText,
    review_status: reviewStatus, reviewed_by: reviewStatus === "approved" ? auth.user.id : null,
    reviewed_at: reviewStatus === "approved" ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
  });
  if (error) throw new Error("RAG repository unavailable");
  return { saved: true, reviewStatus, revision: data.revision };
}
