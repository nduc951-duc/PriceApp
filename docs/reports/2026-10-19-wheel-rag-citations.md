# Câu giới thiệu bánh xe: kiểm tra provider và API web

Ngày kiểm tra: 19/10/2026.

Câu nguyên văn: `giới thiệu về mặt hàng bánh xe đi`.

## Bằng chứng

- Truy xuất Supabase tìm product ID 98 và 31 quy cách. Gemini có lượt trả 429 quota, Groq trả 200.
- Trước sửa, Groq sinh câu giới thiệu nhưng `evidenceIds` chứa chuỗi số trần như `2581`, `2123`. Zod ở server yêu cầu `chunk:2581` hoặc `variant:<id>` / `price:<id>`. Backend từ chối đầu ra thành `clarify`. Đây là lỗi hợp đồng dữ liệu provider, không phải thiếu bánh xe trong catalog.
- Đã sửa JSON Schema strict của Groq để `evidenceIds` chỉ có thể chọn trong tập ID nguồn thực sự cung cấp trong chính request. Không sửa câu hỏi, không thêm luật từ khóa bánh xe, không tự đoán tiền tố cho đầu ra sai.
- Ép riêng nhánh Gemini 429 bằng fault injection rồi gọi Groq/Supabase thật: Groq 200, đúng tiền tố `chunk:...`, kết quả `answered`, 31 quy cách, khoảng 3,2 giây.
- Gọi trực tiếp API backend đang chạy `POST http://localhost:4000/api/v1/public/rag/query` với nguyên câu trên: HTTP 200, `answered`, 31 quy cách, khoảng 4,2 giây. Đây là API web công khai, không phải chỉ kiểm tra hàm trong một tiến trình thử.

## Giới hạn kết luận

Ảnh báo banner đỏ chung, còn lỗi tiền tố nguồn tái hiện ở trên trả `clarify`; chưa đủ bằng chứng khẳng định chúng là cùng một nguyên nhân. Người dùng đã xác nhận lại lỗi ở trang nhân viên `/questions`. Public endpoint hoạt động ở lượt kiểm tra hiện tại không chứng minh endpoint nhân viên và bước lưu hội thoại đều hoạt động. Công cụ browser hiện không có phiên của người dùng. Đang chờ đường dẫn request và Response JSON lỗi nhân viên; không yêu cầu token hay Headers và không đổi quyền xác thực để thử.

Sau sửa mã nguồn trích dẫn: backend lint, typecheck, 449/449 test và production build đạt. Lỗi banner đỏ riêng nhân viên chưa được xác nhận đã sửa.

Gemini/Groq vẫn có quota và giới hạn token; không kết luận mọi lỗi tạm thời đã hết. Không lưu key, token phiên hoặc raw log.
