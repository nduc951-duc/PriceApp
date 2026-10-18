> Cập nhật 2026-10-18: tài liệu này ghi lại thiết kế/trạng thái cũ có luồng OCR. Ứng dụng hiện chỉ dùng catalog Supabase đã xác minh; xem [RAG_SETUP.md](../RAG_SETUP.md) và migration 202610180009_catalog_only_rag.sql để biết hành vi hiện hành.

# L3 · Trạng thái quản trị nguồn và preview chunk

## Đã triển khai trong code ngày 10/10/2026

- Trang `/rag-admin` hiển thị revision, trạng thái nguồn, số chunk generation đang hoạt động, thời điểm index và lỗi run gần nhất theo từng trang; loading, lỗi quyền/kết nối và danh sách rỗng có nội dung riêng.
- Danh sách ghi người duyệt bằng ID Auth rút gọn và thời điểm duyệt; tên/email không đọc được vì RLS chỉ cho phép đọc hồ sơ của chính tài khoản hiện tại.
- Ảnh nguồn mở được ở chế độ phóng lớn cạnh bản chép. Nháp cảnh báo trước khi rời trang hoặc đổi nguồn; trạng thái lỗi API được giữ trong vùng thông báo.
- Chunker `records-1100-overlap160-v3` giữ từng dòng OCR làm record, kế thừa heading kết thúc bằng dấu hai chấm, tách dòng dài theo ranh giới câu và giữ source span trong văn bản chuẩn hóa.
- Cấu hình giới hạn ký tự/chồng lấn có thể chỉnh theo trang và được dùng giống nhau ở preview lẫn indexing. Sửa OCR hoặc cấu hình sẽ xóa các liên kết chunk cũ để không gắn nhầm record.
- Admin gắn record với variant active/verified cùng trang. Backend kiểm tra liên kết trước khi lưu; indexer lưu variant ID, source revision, source span, chunker version, heading và OCR text vào metadata.
- Migration `202610090001_rag_page_chunk_review.sql` thêm trường dữ liệu, giới hạn cấu hình và tăng revision khi nội dung hoặc cấu hình review thay đổi.

## Kiểm tra và phần còn cần nghiệm thu

- Backend/frontend typecheck, backend lint, frontend lint và kiểm tra OpenAPI đã qua ngày 10/10/2026. Frontend lint còn cảnh báo font có từ trước ở `src/app/layout.tsx`.
- Ghi chú tại thời điểm trước vòng rà soát ngày 10/10: unit tests, kiểm tra owner và áp migration còn đang chờ. Phần dưới ghi kết quả mới nhất; kiểm thử owner thật vẫn cần tài khoản E2E riêng và trang nguồn đã có dữ liệu.
- Các mục T03.1–T03.5 vẫn để chưa đánh dấu đến khi chạy kiểm tra phù hợp và xác nhận preview/source span, mapping, report 13 trang trên database có dữ liệu.
- Ranh giới source span trỏ vào văn bản chuẩn hóa mà preview trả về; bộ dữ liệu hiện không có tọa độ OCR để khoanh vùng trực tiếp trên ảnh.
- Ngân sách chunk dùng ký tự thay vì tokenizer model cụ thể để giữ cùng kết quả giữa Ollama và API tương thích OpenAI; mặc định 1.100 ký tự và trần 4.000. Nếu model thực tế có tokenizer khác đáng kể, giới hạn cần hiệu chỉnh bằng benchmark.

## Kết quả rà soát toàn workspace ngày 10/10/2026

Ghi chú “chưa chạy unit tests” phía trên là trạng thái trước lần rà soát này. Root gates hiện đã chạy: frontend lint/typecheck/build và backend lint/typecheck/tests/build/OpenAPI; xem tổng kết cuối cùng trong [RAG L5–L9 status](RAG_L5_L9_STATUS.md). Migration L3 `202610090001_rag_page_chunk_review.sql` đã được áp dụng. Vẫn cần tài khoản owner và trang nguồn có nội dung đã duyệt để nghiệm thu giao diện/mapping trên dữ liệu thật; không tự điền hoặc duyệt OCR mẫu.
