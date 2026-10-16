# L4–L9: thứ tự thực hiện và điều kiện nghiệm thu

Mục tiêu: nhân viên tra đúng quy cách, báo đúng `prices.amount`, dẫn được nguồn và thêm vào báo giá; chủ cửa hàng kiểm soát dữ liệu và quyền truy cập. Các task chi tiết T04.1–T09.4 nằm trong [roadmap](PRICEAPP_RAG_ROADMAP.md). Không đánh dấu hoàn thành chỉ dựa trên unit test hoặc build.

| Đợt | Việc triển khai kế tiếp | Bằng chứng cần có |
| --- | --- | --- |
| L4 | Áp các migration RAG theo thứ tự; chạy index, ngắt giữa batch, resume, thu hồi trang, chạy lại sau sửa giá | Run ID, checkpoint, generation, số embedding mới, SQL/RLS và truy vấn thực tế |
| L5 | Khóa tập câu hỏi theo sản phẩm đã duyệt; parser thuộc tính, lọc cứng, RRF, trang debug retrieval | 80–100 câu có đáp án; Recall@5/MRR và ví dụ quy cách gần nhau |
| L6 | Tra giá bằng SQL tham số, kiểm ID/phiên bản và citation tại backend; định dạng tiền bằng code | Ca thiếu giá, sai nguồn, sỉ chưa rõ ngưỡng, OCR chứa chỉ dẫn độc hại |
| L7 | Lưu ngữ cảnh có RLS; hỏi lại khi mơ hồ; chuyển price ID và số gói sang giỏ với xác nhận | E2E hỏi tiếp → chọn đúng dòng giá → sao chép báo giá |
| L8 | Đóng băng corpus/test set; chạy keyword, vector, hybrid cùng ngân sách; thu phản hồi | Bảng metric retrieval, tiền, citation, abstention, latency; rà toàn bộ lỗi tiền |
| L9 | Hoàn thiện tài liệu, kiểm quyền và demo xuyên suốt | E2E owner/nhân viên; video/slide; phương án tra SQL khi model tắt |

## Điều kiện hiện tại

- **L4:** migration cloud đến `202610130002` đã áp dụng; còn nghiệm thu index/resume/revoke trên corpus được duyệt.
- **L5:** parser, RRF và lọc thuộc tính rõ ràng có unit tests; tập câu hỏi khóa và benchmark trên corpus cửa hàng còn thiếu.
- **L6:** API trả trạng thái, giá SQL có ID/version và citation revision/span; còn đánh giá OCR/prompt-safety trên nguồn thật đã duyệt.
- **L7:** API hội thoại/feedback dùng caller JWT/RLS; POS kiểm duyệt/phiên bản khi thêm và sao chép. Còn E2E với hai phiên owner/nhân viên trên project test riêng.
- **L8:** runner và metric đã có; chưa có labels/corpus adjudicated để báo Recall@5, MRR, độ đúng giá/citation hay latency.
- **L9:** setup, kiến trúc và hướng dẫn evaluation có; video/slide demo chưa làm.
- Remote regression đã xác nhận guard quyền, version và số không hữu hạn trong transaction rollback. Không dùng dữ liệu `.env.local` trong báo cáo hoặc tự duyệt OCR.

## Cập nhật triển khai ngày 10/10/2026

Các ghi chú blocker phía trên mô tả trạng thái cũ. Sau đợt thực hiện L4–L9, migration `202610090001` đến `202610130002` đã được áp dụng trên Supabase `App Price`; regression SQL của price RPC chạy thành công trong transaction rollback, gồm profileless caller, `expected_version` thiếu, `NaN`/vô cực và số lượng catalog không hữu hạn. Backend hiện có parser thuộc tính, lọc candidate, giá lấy từ SQL, citation revision/span, hội thoại/feedback, evaluation runner và OpenAPI. `/rag-admin` có review theo trang, cấu hình chunk/preview, liên kết record–variant và trạng thái index. Xem bằng chứng và giới hạn hiện tại ở [RAG L5–L9 status](RAG_L5_L9_STATUS.md), [RAG L4 status](RAG_L4_STATUS.md), và [workspace runbook](workspace-runbook.md).

Các điều kiện nghiệm thu còn mở là corpus/nhãn đã được cửa hàng duyệt, benchmark trên corpus đó, hai phiên đăng nhập thật để kiểm RLS/role, E2E có tài khoản ở project kiểm thử tách biệt, và sản phẩm demo video/slide. Không đánh dấu L5–L9 hoàn tất khi chưa có các bằng chứng này.
