# Kiểm thử RAG từ góc nhìn khách hàng — 19/10/2026

Đã chuẩn bị 12 lượt trong 10 tình huống qua public HTTP handler, Supabase và Gemini thật. Chưa thể hoàn tất đánh giá chất lượng cả bộ vì Gemini đã hết quota ngày. Không coi HTTP 503 là trả lời sai của model.

## Kết quả đã quan sát

| Tình huống | Quan sát | Đánh giá |
| --- | --- | --- |
| “Chào shop, mình đang tìm mua bu lông mà chưa biết chọn loại nào, bên mình bán những loại gì vậy?” | Giới thiệu Bulong có tán, 47 quy cách; nêu đường kính và mời khách cho biết nhu cầu | Đạt giới thiệu hàng, khoảng 11 giây |
| “Cho mình hỏi bu lông 8 ly bao nhiêu tiền một bịch?” | Liệt kê 12 chiều dài cùng nhiều mức giá/đóng gói | Cần cải thiện trải nghiệm: nên hỏi chiều dài hoặc đưa vài lựa chọn tiêu biểu, thay vì đổ một bảng dài |
| Câu nối đổi sang dài 4 phân | Một lượt thử hỏi lại tên mặt hàng; các lượt trước trong chính phiên thử đó đã lỗi dịch vụ nên chưa có ngữ cảnh | Không đủ điều kiện kết luận model mất ngữ cảnh |
| Ngân sách 100 nghìn; bịch lớn giá sỉ; đổi ý; so sánh; tắc kê thiếu cỡ; chịu tải 40kg; yêu cầu giao hàng; hàng ngoài danh mục; chỉ dẫn đổi giá | Nhiều lượt bị dịch vụ chặn | Chưa đánh giá chất lượng được, cần chạy lại khi quota phục hồi |

## Nguyên nhân ngừng kiểm thử thật

Chẩn đoán từng tầng xác nhận embedding bge-m3 hoạt động (1.024 chiều), Supabase vector retrieval trả 8 chunk. Gemini trả HTTP 429 `RESOURCE_EXHAUSTED`, metric `generate_content_free_tier_requests`, giới hạn 20 yêu cầu/ngày cho model đang dùng. Ứng dụng chuyển lỗi provider thành HTTP 503 `RAG_UNAVAILABLE`. Thử kết nối bằng catalog rỗng có thể thành công trước khi quota tiếp tục bị từ chối; không dùng điều đó để kết luận mọi yêu cầu catalog đều hoạt động.

Lượt chạy đầu còn chạm giới hạn public 5 câu/phút do runner hỏi liên tục. Runner đã được chỉnh để tuân thủ giới hạn này, phân biệt BLOCKED với REVIEW, dừng gọi khi provider trả 429, và bỏ qua câu nối nếu lượt trước không thành công. Không nới giới hạn trong ứng dụng.

## Chạy lại

Từ thư mục `backend`:

```powershell
node --env-file=.env.local --import tsx tests/live/customer-rag.ts
```

Runner chỉ đọc catalog, không tạo đơn hay sửa giá; ghi đè báo cáo này bằng kết quả mới. Cần quota Gemini khả dụng. Bộ thử tự động không chứng minh khả năng hiểu mọi câu hoặc tư vấn an toàn khi thiếu tài liệu kỹ thuật.
