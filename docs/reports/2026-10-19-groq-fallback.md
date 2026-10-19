# Groq dự phòng cho RAG — 19/10/2026

Đã cấu hình Gemini chính và Groq dự phòng cho `retrieval_first`. Groq dùng `openai/gpt-oss-120b`, endpoint `https://api.groq.com/openai/v1`, JSON Schema strict theo [tài liệu Groq](https://console.groq.com/docs/structured-outputs). Khóa đã có trong `.env.local`, không in ra hoặc đưa vào `.env.example`.

Khi primary lỗi 429, 5xx, timeout hoặc mất kết nối, thử Groq một lần. Khi primary trả lời được thì không gọi Groq. Không chuyển dự phòng để che lỗi 401 hoặc schema/cấu hình sai; không tự đổi embedding hoặc index. Giá vẫn đọc lại từ SQL và kiểm tra quyền/ID/quan hệ trước khi hiển thị. Probe chat quản trị và các hàm planner legacy vẫn kiểm tra primary; không dùng trạng thái probe primary để kết luận nhánh Groq hỏng.

Các biến mới: `RAG_CHAT_FALLBACK_PROVIDER`, `RAG_CHAT_FALLBACK_BASE_URL`, `RAG_CHAT_FALLBACK_API_KEY`, `RAG_CHAT_FALLBACK_MODEL`. Khởi động lại backend để nạp cấu hình. Chưa tự khởi động lại tiến trình của người dùng.

## Kiểm chứng thực tế

- Với sản phẩm giả XYZ: Gemini thật trả 429, Groq thật trả 200 và diễn giải đúng gói 10 cái.
- Lượt catalog đầu tiên bị Groq trả 413 vì yêu cầu 9.304 token vượt mức 8.000 TPM của tài khoản. Đã chuyển payload Groq thành bảng có tên cột và bỏ bản sao chunk SQL trùng chính xác catalog. Giữ toàn bộ ID, thuộc tính, mô tả, quy cách, gói, giá và văn bản độc lập; không thêm bộ lọc câu hỏi hoặc cắt bớt danh sách sản phẩm. Có test khôi phục dữ liệu từ bảng, đối chiếu bằng nhau với đầu vào.
- Một lượt thử sau đó Gemini thật trả 200 và giới thiệu 47 quy cách bulong; lượt này không được tính là kiểm chứng Groq.
- Để xác nhận nhánh Groq, đã giả lập riêng Gemini 429 rồi gọi Supabase và Groq thật: “Cho mình hỏi giá lẻ và giá sỉ bulong 8 ly x 3F?” trả `answered`, quy cách ID 47, giá lẻ 9.000đ và sỉ 70.000đ, khoảng 4,1 giây. Giá cuối cùng được đọc lại từ SQL.

## Kiểm tra tự động và giới hạn

9 test về dự phòng, 2 test về mã hóa bảng và các test routing đã đạt. Toàn bộ `npm run check` đạt sau thay đổi: backend 447/447, frontend 84/84, dev runner 2/2, lint, typecheck, OpenAPI và production build. Không thay giao diện nên không lặp toàn bộ E2E đang có các lỗi được ghi ở báo cáo dọn dự án.

Groq cũng có quota. [Giới hạn chính xác tùy tài khoản](https://console.groq.com/docs/rate-limits); bảng tài liệu tại thời điểm kiểm tra ghi GPT-OSS 120B free tier 8.000 TPM. Mã hóa bảng giảm payload, không bảo đảm mọi danh mục 200 quy cách đều vừa mọi quota. Khi cả hai provider không khả dụng, API vẫn trả RAG_UNAVAILABLE. Chất lượng tiếng Việt và ngữ cảnh trên Groq cần thêm bộ đánh giá khách hàng; một câu tra giá thành công không chứng minh mọi tình huống.
