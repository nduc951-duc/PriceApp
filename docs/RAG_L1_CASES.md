# Trợ lý vật tư: nhóm đánh giá theo epic

`backend/testdata/rag-assistant-cases.json` là bộ câu hỏi ứng viên cho các intent hỏi giá, liệt kê, thông tin sản phẩm, tư vấn, so sánh, câu hỏi nhiều ý, ngoài phạm vi và cần làm rõ. Các dòng hiện mang nhãn `candidate`: chưa có đáp án chuẩn vì cần đối chiếu corpus được duyệt, catalog hiện hành và chuyên môn sử dụng vật tư. Runner cố ý không tính candidate như kết quả đã kiểm chứng.

| User story | Nhóm case | Bằng chứng/đo lường |
| :--- | :--- | :--- |
| US-01 Intent | hỏi giá, liệt kê, thông tin, tư vấn, so sánh, nhiều ý, ngoài phạm vi, làm rõ | intent accuracy và đáp án theo intent |
| US-02 Complete listing | danh sách quy cách, có/không có giá | tập variant chuẩn, tổng số, precision, recall, completeness |
| US-03 Product identity | có dấu/không dấu, tên gọi và quy cách | variant correctness sau khi đối chiếu catalog |
| US-04 Grounded facts | đặc điểm và trang nguồn | citation correctness trên nguồn đã duyệt |
| US-05 Current price | giá hiện hành, đơn vị, đổi giá | price ID/version/amount/tier/unit phải khớp SQL tại thời điểm chạy |
| US-06 Advice clarification | thiếu môi trường/kích thước/điều kiện | yêu cầu làm rõ và căn cứ tư vấn |
| US-07 Recommendations | gợi ý có điều kiện sử dụng | người có chuyên môn duyệt tính phù hợp |
| US-08 Comparisons | hai mặt hàng/quy cách được xác nhận | chỉ so sánh trường có bằng chứng |
| US-09 Follow-ups | tham chiếu tới lượt trước và giá mới | resolve đúng ID, truy vấn lại trạng thái và giá SQL |
| US-10 Roles | customer/staff | RPC, RLS, dữ liệu phù hợp vai trò |
| US-11 Feedback | lý do phản hồi và trace liên quan | bản ghi gắn đúng câu hỏi/đáp án, không lộ dữ liệu riêng |
| US-12 Evaluation | toàn bộ nhóm trên | metric tách theo intent, citation, độ chính xác, completeness và latency |

Mẫu hỏi cũ bên dưới vẫn là bộ L1 kiểm thử candidate. Không tự thêm amount hoặc kết quả quan sát vào câu hỏi; chỉ ghi đáp án chuẩn sau khi đối chiếu nguồn có thẩm quyền. Mỗi lần chạy cần lưu model/corpus fingerprint và kết quả quan sát riêng để phân biệt ground truth với output đo được.

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

## Added epic coverage (candidate-only)

The evaluation set now includes `assistant-advice-missing-constraints-01`, `assistant-advice-document-constraint-01`, `assistant-comparison-missing-dimension-01`, and `assistant-comparison-documented-dimension-01`. These cases cover clarification before advice, citation of each requested use constraint, asking for a comparison dimension, and comparing only a dimension documented for both variants. They remain candidates until the approved corpus and product expertise are used to adjudicate them; no expected prices or outcomes were invented.
