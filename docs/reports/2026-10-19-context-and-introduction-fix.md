# Sửa hiểu câu nhiều vế và ngữ cảnh RAG

Ngày: 19/10/2026. Tiếp nối bằng chứng trong `2026-10-19-introduction-root-cause.md`.

## Thay đổi

- Planner nhận hướng dẫn phân tích toàn câu: chủ ngữ/mặt hàng có thể nằm ở vế mua hàng, còn vế giới thiệu chỉ định thao tác. Schema provider yêu cầu trả trường `productText`; thiếu định danh sẽ yêu cầu model đọc lại toàn câu một lần. Không để một câu hội thoại dài chưa phân tích được trở thành tên hàng tự ghép.
- Model phải phân biệt câu mới có tên hàng với tham chiếu kết quả cũ. Với một yêu cầu mới có tên hàng được nêu trực tiếp, phân tích lại nguyên câu hiện tại không kèm lịch sử để tránh giữ nhầm điều kiện cũ. Không thay kích thước model hiểu được bằng kết quả regex có thể thiếu. Giữ đường xử lý tham chiếu đã xác minh cho “loại đó”, thứ tự sản phẩm và các câu tiếp nối. Lượt phân tích độc lập này có thể thêm một lần gọi model.
- Model trích thêm `conversationPhrases` từ nguyên câu để phân biệt vế yêu cầu với tên hàng. Chỉ cho phép bỏ các từ hội thoại được kiểm tra độc lập trong tập từ hạn chế, bảo vệ tên hàng và giữ lại mọi từ bổ nghĩa chưa biết. Không tin nhãn của model để xóa màu, vật liệu, mã, kích thước hay mức giá; không bỏ qua bộ lọc định danh chỉ vì model tìm được một từ chung trong tên hàng. Cơ chế dự phòng chỉ bỏ các từ hội thoại trong cùng tập hạn chế khi model đánh dấu thiếu hoặc đánh dấu cả câu có chứa tên hàng.
- Model tạo câu trả lời nhận nguyên câu hỏi hiện tại, thay vì chỉ một câu tổng hợp “Tra cứu mặt hàng: ...”. Giá và các dữ kiện catalog tiếp tục được hiển thị từ SQL và kiểm chứng.
- Thông báo không có kết quả phân biệt thiếu mặt hàng và thiếu đúng quy cách; không coi mọi câu hỏi giới thiệu là yêu cầu một kích thước cụ thể.

## Kiểm chứng bằng model và Supabase thật

`2026-10-19-context-fix-live.jsonl` lưu 5 câu qua route công khai trong app test. Bốn câu sau đều trả `answered` và “Bulong có tán: 47 quy cách”; planner trích `productText: bulong`, `requestedFields: products`:

1. tôi muốn mua bulong, giới thiệu cho tôi
2. tôi muốn mua bulong và hãy giới thiệu cho tôi
3. giới thiệu cho tôi các mặt hàng bulong
4. tôi muốn mua bulong, bạn có những sản phẩm nào

Câu thứ năm “Tắc kê sắt 8 ly x 3F có quy cách gì?” vẫn không trả nhầm bulong, và đưa các quy cách tắc kê cùng nhóm như 8x60, 8x80.

`2026-10-19-context-followups-live.json` có 6 ca đối chiếu tự động, tất cả đạt:

| Câu hiện tại / ngữ cảnh | Kết quả |
|---|---|
| Giới thiệu bulong sau câu giá bulong 8×3F | Đủ 47 quy cách, không bị giữ điều kiện 8 ly |
| Giới thiệu tắc kê sắt sau câu giá bulong | Đúng 31 quy cách tắc kê |
| Hỏi quy cách bulong 8 ly sau câu bulong 8×3F | 12 quy cách cỡ 8 ly; không giữ chiều dài 3F |
| “loại đó giá sỉ bao nhiêu?” sau bulong 8×3F | Đúng variant 47, giá sỉ 70.000 đ |
| Giá Bulong 8 mm × 3 cm | Đúng variant 47, giá lẻ 9.000 đ |
| Tắc kê sắt 8×3F | Không đủ dữ liệu cho đúng mẫu; không đổi loại hàng |

Đây là các ca kiểm thử cụ thể, không phải chứng minh model hiểu đúng mọi câu tiếng Việt. Lượt kiểm tra thật dùng dữ liệu công khai; luồng staff và ngữ cảnh được kiểm tra thêm bằng fixtures và các bài regression, không đăng nhập phiên staff thật của người dùng.

## Kiểm tra mã và giao diện

- Backend: 411 unit/integration tests đạt; lint, typecheck và build đạt.
- Frontend: 84 unit tests và 40 Playwright tests liên quan RAG đạt trên desktop/mobile; lint, typecheck và build đạt.
- Regression đã quan sát thất bại trước khi sửa: yêu cầu đọc lại câu thiếu tên hàng, ba cách nói giới thiệu nhiều vế, bỏ kích thước cũ, và truyền toàn câu vào model tạo trả lời.
- Rà soát độc lập phát hiện hai ca cần bảo vệ thêm và đã có regression: (1) model bỏ màu đỏ mận hoặc đánh dấu nhầm màu đó là từ hội thoại vẫn không được trả bánh xe xanh và giá có thể mua; (2) planner giữ `8x30` mà model hiểu từ “đường kính 8 dài 30” khi tách khỏi lịch sử, thay vì xóa bằng regex. Ca thứ hai xác minh tầng planner, chưa chứng minh mọi diễn đạt kích thước bằng văn nói đã được hỗ trợ xuyên suốt retrieval.
- Reviewer kiểm tra lại hai ca trên sau bản sửa, chạy riêng 33 regression tests và xác nhận hai lỗi đã được chặn; không còn phát hiện quan trọng cụ thể trong phạm vi rà soát này.

Không thay đổi dữ liệu, migration, model cấu hình hoặc tiến trình backend người dùng. Cần khởi động lại backend đang chạy để nạp mã mới.
