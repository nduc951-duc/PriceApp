import { authenticateRagRequest } from "@/lib/rag/auth";
import { ragJson } from "@/lib/rag/http";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authenticateRagRequest(request, ["owner"]);
  if (!auth.ok) return ragJson({ error: auth.error }, { status: auth.status });
  const { data, error } = await auth.client.from("rag_page_texts").select("source_page_id,title,extracted_text,review_status,revision,source_pages!inner(page_number)").order("source_page_id");
  if (error) return ragJson({ error: "Không tải được trang nguồn." }, { status: 500 });
  const pages = (data ?? []).map((row) => {
    const source = row.source_pages as unknown as { page_number: number | null };
    return { sourcePageId: row.source_page_id, pageNumber: source.page_number, title: row.title, extractedText: row.extracted_text, reviewStatus: row.review_status, revision: row.revision };
  });
  return ragJson({ pages });
}

export async function PUT(request: Request) {
  const auth = await authenticateRagRequest(request, ["owner"]);
  if (!auth.ok) return ragJson({ error: auth.error }, { status: auth.status });
  try {
    const input = await request.json() as { sourcePageId?: unknown; title?: unknown; extractedText?: unknown; reviewStatus?: unknown };
    const sourcePageId = Number(input.sourcePageId);
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const extractedText = typeof input.extractedText === "string" ? input.extractedText.trim() : "";
    const reviewStatus = input.reviewStatus;
    if (!Number.isInteger(sourcePageId) || sourcePageId < 1 || title.length > 200 || extractedText.length > 100_000) {
      return ragJson({ error: "Thông tin trang không hợp lệ hoặc văn bản vượt quá 100.000 ký tự." }, { status: 400 });
    }
    if (reviewStatus !== "draft" && reviewStatus !== "approved" && reviewStatus !== "rejected") return ragJson({ error: "Trạng thái duyệt không hợp lệ." }, { status: 400 });
    if (reviewStatus === "approved" && !extractedText) return ragJson({ error: "Cần nhập nội dung trang trước khi duyệt." }, { status: 400 });
    const { data, error } = await auth.client.from("rag_page_texts").upsert({
      source_page_id: sourcePageId, title: title || `Sổ giá - Trang ${sourcePageId}`, extracted_text: extractedText,
      review_status: reviewStatus, reviewed_by: reviewStatus === "approved" ? auth.user.id : null,
      reviewed_at: reviewStatus === "approved" ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
    }, { onConflict: "source_page_id" }).select("revision").single();
    if (error) return ragJson({ error: "Không lưu được trang nguồn." }, { status: 500 });
    return ragJson({ saved: true, reviewStatus, revision: data.revision });
  } catch {
    return ragJson({ error: "Không đọc được dữ liệu gửi lên." }, { status: 400 });
  }
}
