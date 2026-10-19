# Chuyển sang RAG hội thoại truy xuất trước

Ngày kiểm tra: 19/10/2026.

Đã áp dụng cách tổ chức câu hỏi tương tự [MidTerm](https://github.com/nduc951-duc/MidTerm/blob/main/server/ai.js): đưa nguyên câu hỏi và hội thoại gần đây cùng bằng chứng truy xuất vào model sinh câu trả lời. Chế độ `RAG_QUERY_MODE=retrieval_first` được bật trong cấu hình local và `.env.example`. Backend cần được người dùng khởi động lại để nạp cấu hình và mã mới.

## Luồng hiện tại

1. Embed nguyên câu hỏi bằng bge-m3; khi có hội thoại, bổ sung một truy vấn kết hợp câu hỏi user gần nhất với câu hiện tại. Không dùng bộ tách ý định, danh sách từ hội thoại hoặc bộ lọc tên sản phẩm cũ trong luồng đang bật.
2. Truy xuất vector, tối đa 8 chunk mỗi truy vấn; hợp nhất tối đa 16 chunk. Dùng ID quy cách để mở rộng các nhóm hàng đã xác minh từ SQL, chia lô tối đa 8 ID theo giới hạn RPC công khai.
3. Dựng lại nội dung bằng chứng từ SQL hiện tại để tránh nội dung index lỗi thời. Giữ ID và điểm truy xuất làm dấu vết; nguồn nội dung là `current_sql`, không gán trang hoặc revision cũ cho nội dung mới.
4. Gửi nguyên câu hỏi, tối đa 6 tin nhắn gần nhất, bằng chứng và tối đa 200 quy cách cho một lần gọi Gemini. Model tự hiểu các vế, tham chiếu và chọn ID; không bắt người dùng nói đúng mẫu câu.
5. Kiểm tra JSON và ID, quyền xem giá, quan hệ giá–quy cách. Giá hiển thị được đọc lại từ `prices.amount` trong SQL. Model không được tự viết số tiền vào phần diễn giải.

Khách hàng gửi lịch sử gần nhất trong phiên giao diện. Nhân viên đọc các câu hỏi và ID kết quả từ hội thoại thuộc tài khoản đó; không dùng giá cũ trong lịch sử làm nguồn hiện tại. Nhánh cũ vẫn được giữ để có thể chuyển cấu hình khi cần.

## Kiểm chứng

- Backend: **436/436** test đạt với `npm.cmd test --workspace backend -- --maxWorkers=2`.
- Frontend: **84/84** unit test đạt; dev runner **2/2** đạt.
- Playwright: **38/38** bài kiểm tra RAG liên quan đạt trên desktop/mobile, bao gồm lịch sử câu hỏi, nguồn, thêm hàng vào đơn và đọc lại giá trước khi thêm.
- Lint, typecheck, OpenAPI contract và production build đạt cho các workspace.
- Review đã phát hiện và sửa giới hạn RPC 8 ID, nội dung chỉ mục lỗi thời và việc khẳng định danh sách đầy đủ từ kết quả vector hữu hạn.
- Lần chạy backend mặc định nhiều worker gặp timeout 5 giây trong nhiều bài HTTP và bắt gặp test RED đang được sửa. Chạy lại toàn bộ với 2 worker sau khi hoàn tất: 53 file, 436 test đạt; không tăng timeout để che lỗi.
- Gemini ban đầu trả HTTP 400 với JSON Schema sinh từ Zod. Đã chuyển schema gửi provider về tập tính năng chung, vẫn giữ Zod chặt chẽ để kiểm tra server. Việc sửa này đã được kiểm chứng bằng Gemini thật với catalog rỗng và catalog hiện tại sau khi người dùng cho phép gửi dữ liệu.

Các lượt thực tế ban đầu:

| Câu hỏi | Kết quả |
| --- | --- |
| tôi muốn bulong, thì bên bạn có những loại nào | Giới thiệu Bulong có tán, 47 quy cách |
| ờm cho mình tham khảo bulong với nhé | Giới thiệu được nhóm bulong |
| giá bulong 8 ly x 3F | Đúng quy cách ID 47, giá lẻ 9.000đ và giá sỉ 70.000đ từ SQL |
| loại đó giá sỉ thôi nhé, sau câu hỏi giá trên | Giữ ID 47 và chỉ chọn giá sỉ 70.000đ |
| tắc kê sắt 8 ly x 3F có không, giới thiệu đúng loại đó giúp tôi | Không đổi sang bulong; báo thiếu quy cách và gợi ý quy cách tắc kê có dữ liệu |
| Bulong 8 ly x 3F và 8 ly x 4F khác nhau quy cách, đóng gói thế nào? | So sánh đúng 30mm/40mm, cùng gói 10 bộ hoặc 100 bộ |

Kết quả lần chạy được tổng kết trong bảng trên. Bản ghi JSON thô đã được xóa theo yêu cầu dọn dự án. Bộ chạy thử khách hàng được tập trung tại `backend/tests/live/customer-rag.ts`; các script smoke/debug dùng một lần đã được bỏ. Bộ chạy chỉ đọc catalog và gọi AI, không tạo đơn hay sửa giá.

## Phạm vi và giới hạn

Đây là conversational RAG, chưa phải agent có quyền tạo đơn hoặc sửa dữ liệu. Nó có thể giải thích, giới thiệu, tìm quy cách, tra giá, so sánh dữ liệu và xử lý câu nhiều vế khi có bằng chứng. Tư vấn chịu tải hoặc công dụng cần tài liệu kỹ thuật phù hợp.

Tìm kiếm vector hữu hạn không chứng minh đã tìm tất cả nhóm phù hợp. `catalogPage.complete=false` phản ánh giới hạn đó; `truncated` chỉ báo ngữ cảnh vượt 200 quy cách. Chỉ mục cũ có thể ảnh hưởng khả năng tìm thấy hàng dù nội dung gửi model đã được đọc lại từ SQL. Chất lượng hiểu ngôn ngữ và độ đúng sự thật trong phần văn bản vẫn phụ thuộc model và bằng chứng; đây không phải đánh giá benchmark tổng quát. Năm lượt cuối mất khoảng 6,5–36 giây và có thể chịu quota/độ trễ của dịch vụ.
