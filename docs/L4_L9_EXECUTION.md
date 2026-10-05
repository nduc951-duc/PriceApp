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

- Code L4 đã có nhưng migration cloud và nghiệm thu trên nguồn đã duyệt chưa được chứng minh.
- L5 đã có bước RRF cho ID variant từ hai nhánh retrieval, có unit test; chưa có tập câu hỏi đã khóa hoặc benchmark để nghiệm thu T05.1–T05.5.
- L6 đã có trả lời giá bằng code từ các dòng SQL hiện hành và ghi rõ ngưỡng sỉ chưa xác nhận, có unit test; schema response, citation span và ca bảo mật OCR vẫn chưa hoàn thành.
- Giao diện báo giá có đường nhập theo gói lẻ nhỏ nhất, chọn bao bì tương đương chính xác và sao chép báo giá. Kết quả RAG đã có nút mở đúng variant trên màn bán hàng; nhân viên vẫn phải chọn số lượng và xác nhận thêm. Lưu hội thoại và kiểm E2E chuyển giỏ vẫn thuộc L7.
- `/rag-admin` hiển thị ảnh sổ cạnh bản chép, cảnh báo thay đổi chưa lưu khi rời trang, chặn tạo embedding khi còn chỉnh sửa chưa lưu và preview chunk cùng offset chuẩn hóa. L3 vẫn thiếu danh sách trạng thái/revision/index cho từng trang, chunk theo record sản phẩm và gắn variant ID vào nguồn.
- Workspace không có Supabase CLI hoặc biến môi trường quản trị DB trong phiên này. `.env.local` có mặt nhưng không được in ra hay đưa vào tài liệu.
- L5–L9 phụ thuộc dữ liệu đã duyệt, phiên owner/viewer và kết quả nghiệm thu L4. Không tự duyệt nội dung OCR hoặc giả lập kết quả benchmark thành kết quả thật.
