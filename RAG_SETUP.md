# RAG cho PriceApp

## Luồng dữ liệu

`Câu hỏi -> embedding truy vấn -> pgvector + tìm tên/quy cách -> lấy giá hiện hành bằng SQL -> LLM trả lời có nguồn`.

Chỉ văn bản OCR/bản chép **đã được chủ cửa hàng duyệt** và biến thể catalog có trạng thái `verified` được chunk và embedding. Giá không nằm trong nội dung chunk; `prices.amount`, ngưỡng số lượng, loại giá và hiệu lực luôn được truy vấn riêng từ PostgreSQL bằng ID sau khi tìm ra biến thể. Cập nhật giá vì vậy không cần tạo lại embedding.

## Cấu hình Supabase và mô hình

1. Áp dụng theo thứ tự migration `202609290001_rag_chunks_and_vectors.sql`, `202609290002_rag_source_freshness.sql`, `202609290003_rag_reject_entire_source.sql` và `202610040001_rag_index_generations.sql` trong `supabase/migrations` qua `npx supabase db push` hoặc SQL Editor. Migration thứ hai thêm revision/trigger; migration thứ ba bảo đảm thu hồi cả trang ẩn cả chunk OCR lẫn catalog. Migration thứ tư thêm index run/checkpoint và chỉ publish generation khi đã hoàn tất. Chunk OCR cũ chưa có revision sẽ bị ẩn cho đến khi index lại.
2. Cài Ollama trên máy chạy backend, sau đó tải model embedding đa ngôn ngữ và model chat:

   ```sh
   ollama pull bge-m3
   ollama pull qwen2.5:3b
   ```

3. Sao chép `backend/.env.example` thành `backend/.env.local` và đặt biến RAG ở đó. Địa chỉ mặc định là `http://localhost:11434`. Nếu backend chạy trong container, dùng địa chỉ host/service mà container truy cập được. Frontend chỉ cần `NEXT_PUBLIC_API_BASE_URL` trỏ đến backend; không đưa provider key vào frontend.
4. Đăng nhập bằng tài khoản Supabase có role `owner`, mở `/rag-admin`, đối chiếu từng ảnh với bản chép trang, sửa OCR rồi bấm **Duyệt bản chép**. Dữ liệu trang chưa duyệt không được index.
5. Bấm **Kiểm tra kết nối** ở `/rag-admin` để xem riêng trạng thái Supabase, embedding 1.024 chiều và chat model. Chỉ sau khi cả ba sẵn sàng mới bấm **Tạo lại embedding**. Pipeline lưu chunk kèm trang nguồn, revision, hash, chunker version và model artifact. Nếu bị gián đoạn, mở lại trang và bấm **Chạy tiếp** để tiếp tục từ checkpoint.
6. Mở `/questions`, hỏi thử; kết quả kết hợp semantic retrieval, PostgreSQL full-text/trigram catalog search, truy vấn giá SQL, LLM và dẫn chứng trang.

Chạy cả hai workspace bằng `npm run dev` từ root; backend mặc định ở port `4000`, frontend ở `3000`. Health API là `/api/v1/health`. Cấu hình origin web chính xác trong `FRONTEND_ORIGINS`. Xem [workspace runbook](docs/workspace-runbook.md) về deploy tách rời, đăng nhập, CI và E2E test an toàn.

Có thể dùng API tương thích OpenAI thay cho Ollama bằng `RAG_AI_PROVIDER=openai-compatible`, đặt `RAG_AI_BASE_URL` đến API có `/embeddings` và `/chat/completions`, đặt `RAG_AI_API_KEY`, `RAG_EMBEDDING_MODEL` và `RAG_CHAT_MODEL`. Model embedding phải trả đúng 1.024 số cho mỗi văn bản để khớp migration.

## Phạm vi và giới hạn hiện tại

- App chưa tự OCR ảnh. Màn hình `/rag-admin` cung cấp quy trình nhập/soát bản chép bằng tay cho 13 trang để đảm bảo nội dung được duyệt trước khi embedding.
- Catalog chỉ index các biến thể `verified`; những mặt hàng chưa duyệt không được xem là bằng chứng chuẩn.
- Mỗi câu trả lời trả về số chunk vector, số kết quả lexical, trang nguồn và giá chính xác lấy từ bảng SQL.
- Thay nội dung OCR hoặc catalog đã xác minh thì chạy lại index. Chỉ sửa giá thì không cần.
- Lưu bản nháp làm chunk OCR của revision cũ biến mất ngay. **Thu hồi cả trang** ẩn mọi chunk OCR/catalog gắn trang đó; biến thể inactive/unverified cũng không còn dùng làm chunk tìm kiếm. Service worker chỉ giữ tài nguyên tĩnh, xóa cache ứng dụng cũ và không cache API theo phiên đăng nhập.
- Bộ [20 câu hỏi L1](docs/RAG_L1_CASES.md) là ứng viên cho vòng thử đầu tiên; cần đối chiếu trang nguồn và khóa đáp án trước khi tính độ đúng.

## Đề xuất đánh giá đồ án

Lập tập câu hỏi có đáp án chuẩn gồm tên có dấu/không dấu, biệt danh, quy cách gần giống nhau, hỏi giá sỉ/lẻ, hỏi trang nguồn và câu không có trong dữ liệu. So sánh keyword-only với hybrid RAG bằng Recall@k/MRR cho retrieval, độ đúng giá và citation accuracy cho câu trả lời, cùng latency và số token/chi phí của LLM. Giữ nguyên tập câu hỏi khi thay model hoặc cách chunk để kết quả so sánh được.
