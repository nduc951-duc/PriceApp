# Kiểm thử RAG sau khi lập chỉ mục

Ngày kiểm tra: 19/10/2026 (Asia/Saigon).

## Phạm vi và cách chạy

Chạy 8 câu hỏi khác nhau qua route `/api/v1/public/rag/query` bằng `app.inject` trên mã nguồn hiện tại, gọi Supabase và dịch vụ AI thật. Không khởi động lại backend của người dùng, không sửa catalog, model hay logic trả lời. Đây là smoke test sau indexing, không phải benchmark chất lượng embedding và không chứng minh mức cải thiện trước/sau vì chưa có baseline cùng điều kiện.

Đối chiếu độc lập bằng RPC catalog công khai, đọc hết các trang, so tập ID của danh sách bulong và ID/số tiền của giá với kết quả RAG. Ba request cuối trong lượt đầu bị HTTP 429 do giới hạn tần suất; đã chạy lại từng câu trong app test riêng và lấy kết quả thành công. Không thay đổi giới hạn của ứng dụng.

## Kết quả

| Câu hỏi | Kết quả thực tế | Nhận xét |
|---|---|---|
| tôi muốn mua bulong, bên bạn có những mặt hàng nào | 47 quy cách Bulong có tán | Tập ID khớp catalog; trả lời dài, chưa tóm tắt theo nhóm/cỡ |
| Bulong bên bạn có những cỡ nào? | 47 quy cách Bulong có tán | Tập ID khớp; cần trình bày đường kính và khoảng chiều dài gọn hơn |
| tắc kê sắt 8 ly x 3f | Không có đúng mẫu; đưa các mẫu cùng nhóm | Phù hợp dữ liệu hiện có, không nhầm sang bulong |
| Tắc kê sắt 8 ly x 3F có quy cách gì? | Không có đúng mẫu; đưa các mẫu cùng nhóm | Nhất quán với cách hỏi ngắn |
| Bulong 8 ly x 3F có quy cách gì? | Đúng variant 47 | Giá trả kèm khớp catalog; câu dẫn nói về lựa chọn tương tự dù đã khớp chính xác |
| Giá Bulong 8 mm x 3 cm? | Đúng variant 47, lẻ 9.000 đ/10 bộ; sỉ 70.000 đ/100 bộ | ID và số tiền giá khớp catalog, xử lý được cách viết đơn vị khác |
| Giá tàu vũ trụ chạy bằng năng lượng mặt trời? | Không đủ dữ liệu | Không bịa sản phẩm/giá |
| Tắc kê sắt dùng được cho tường thạch cao không? | Hỏi lại tên hàng/loại câu hỏi | Chưa đạt về hiểu ý: tên hàng đã rõ, nhưng planner trả clarification và không retrieval |

Thời gian trung bình 2.667 ms/câu, trung vị 2.754 ms/câu trong lượt này. Không coi đây là đo hiệu năng ổn định vì mỗi câu chỉ chạy một lần thành công.

## Đối chiếu catalog

- Có đúng 47 variant mang tên `Bulong có tán` trong kết quả catalog. RPC tìm từ `bulong` trả 177 variant, gồm cả các nhóm liên quan như long đền, tán và vít; không được lấy 177 làm số bulong đúng tên. RAG đã lọc còn đúng 47.
- Có 31 variant `Tắc kê sắt`. Các mẫu đường kính 8 mm là 8x60, 8x80, 8x100, 8x120; không có 8x30. Vì vậy khác biệt giữa tắc kê 8×3F và bulong 8×3F xuất phát từ dữ liệu sản phẩm khác nhau trong các ca đã kiểm tra.
- Bulong variant 47 có quy cách `8 ly x 3F`, giá retail ID 84 = 9.000 đ và wholesale ID 83 = 70.000 đ.

## Vấn đề cần cải thiện tiếp

1. Planner chưa ổn định: câu tư vấn bị chuyển thành hỏi lại tên hàng; ở một số câu quy cách, JSON planner chỉ trích `8 ly`, còn phần xử lý chuỗi gốc giữ được kích thước đầy đủ. Chưa nên đánh giá planner là đã hiểu tốt chỉ vì kết quả cuối đúng.
2. Hai câu hỏi mở đều được planner yêu cầu `variants`, dẫn đến liệt kê 47 dòng thay vì tổng quan nhóm/cỡ và gợi ý thu hẹp.
3. Câu dẫn của model còn chung chung, có thể nhắc lựa chọn tương tự khi đã khớp chính xác.
4. Với câu hỏi công dụng, cần phân biệt rõ hỏi lại thông tin còn thiếu với thiếu tài liệu kỹ thuật làm bằng chứng. Không tự suy ra độ phù hợp chỉ từ tên hàng.
5. Có gọi embedding và vector retrieval thật (1–8 chunk ở các ca liên quan), nhưng kết quả cuối còn kết hợp SQL và bộ lọc. Không thể quy toàn bộ độ chính xác cho bge-m3 hoặc kết luận đổi model nào tốt hơn từ lượt thử này.

## Bằng chứng

- `2026-10-19-post-index-rag-live.jsonl`: lượt đầu, có trace planner/provider và các request 429.
- `2026-10-19-post-index-rag-retries.jsonl`: ba câu chạy lại.
- `2026-10-19-post-index-catalog-evidence.json`: catalog phân trang dùng đối chiếu.
- `2026-10-19-post-index-rag-summary.json`: kết quả đối chiếu tự động và thời gian.

Chưa kiểm thử đăng nhập staff trực tiếp hoặc UI trong lượt này. Chưa sửa các vấn đề planner/trình bày; báo cáo ghi nhận đúng trạng thái để chọn bước cải thiện tiếp theo.
