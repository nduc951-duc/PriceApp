# L1 · 20 câu hỏi thử nghiệm đầu tiên

Đây là **bộ câu hỏi ứng viên** lấy từ tên/quy cách trong migration catalog 13 trang. Người phụ trách cần đối chiếu ảnh gốc, trạng thái `verified` và bản chép `approved` trước khi khóa đáp án chuẩn. Không chép số tiền vào bộ câu hỏi: mỗi lần chạy lấy `prices.id`, `prices.amount` và hiệu lực từ SQL tại thời điểm hỏi.

| ID | Câu hỏi | Mặt hàng / quy cách cần kiểm tra | Trang ứng viên | Kiểu kiểm tra |
| :--- | :--- | :--- | :---: | :--- |
| Q01 | Giá tắc kê sắt 6x50 là bao nhiêu? | Tắc kê sắt · 6x50 | 1 | Tên đầy đủ |
| Q02 | Có nở sắt 8x80 không? | Tắc kê sắt · 8x80 | 1 | Tên gọi khác |
| Q03 | Tắc kê sắt 10x60 loại mỏng giá nào? | Tắc kê sắt · 10x60 mỏng | 1 | Quy cách gần nhau |
| Q04 | Tắc kê sắt 10x60 loại dày giá nào? | Tắc kê sắt · 10x60 dày | 1 | Quy cách gần nhau |
| Q05 | Giá tắc kê đạn 8 ly? | Tắc kê đạn Đài Loan · 8 ly | 1 | Tên + cỡ |
| Q06 | Tắc kê nhựa Tiến Phát 4F bao nhiêu? | Tắc kê nhựa Tiến Phát · 4F | 1 | Thương hiệu |
| Q07 | Móc điện M8 còn trong bảng giá không? | Móc điện · M8 | 1 | Mặt hàng có thể inactive |
| Q08 | Trang nào ghi tắc kê đạn 10 ly? | Tắc kê đạn Đài Loan · 10 ly | 1 | Nguồn trích dẫn |
| Q09 | Vít tole 4F giá bao nhiêu? | Vít tole sắt gỗ · 4F | 2 | Tên thường gọi |
| Q10 | Vít tole 8F có giá sỉ không? | Vít tole sắt gỗ · 8F | 2 | Loại giá |
| Q11 | Vít bắn dù Đài Loan 2F5 giá nào? | Vít bắn dù Đài Loan · 2F5 | 2 | Tên + quy cách |
| Q12 | Vít sàn ôm la 3F có giá không? | Vít sàn ôm la · 3F | 2 | Dấu tiếng Việt |
| Q13 | Vít sàn mập la 3F giá nào? | Vít sàn mập la · 3F | 2 | Tên gần nhau |
| Q14 | Vít đen 4F bán theo bịch nào? | Vít đen · 4F | 2 | Bao bì |
| Q15 | Vít vàng 2F có những mức giá nào? | Vít vàng · 2F | 2 | Nhiều giá |
| Q16 | Nở ty 8 ly là món nào? | Nở ty · 8 ly | 2 | Tên gọi khác |
| Q17 | Vít 3F giá bao nhiêu? | Cần hỏi rõ loại vít | 2 | Câu mơ hồ |
| Q18 | Có tắc kê sắt 99x99 không? | Không thấy trong danh mục trang 1 | 1 | Không có dữ liệu |
| Q19 | Nếu bỏ duyệt trang 1, câu hỏi về bản chép trang 1 còn lấy chunk cũ không? | Không còn chunk OCR của revision cũ | 1 | Thu hồi nguồn |
| Q20 | Sau khi đổi giá tắc kê sắt 6x50 bằng RPC, hỏi lại ra giá nào? | `prices.amount` mới; vector/hash không đổi | 1 | Giá động |

## Mẫu ghi kết quả mỗi lần chạy

`run_id`, thời điểm, trạng thái duyệt trang, model/fingerprint, câu hỏi, chunk IDs và source revision, variant IDs, price IDs, amount SQL, câu trả lời, trang trích dẫn, đúng/sai, ghi chú. Chưa có lần chạy thật thì để trống; không tự điền kết quả mong muốn thành kết quả đo được.
