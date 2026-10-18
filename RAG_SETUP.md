# RAG catalog cho PriceApp

## Nguồn dữ liệu và cách trả lời

```text
Câu hỏi giá ───────────────> bảng giá Supabase / SQL ──> giá hiện hành
Câu hỏi quy cách ──────────> catalog Supabase ─────────> thuộc tính, đóng gói
Câu hỏi tìm mặt hàng ──────> tìm tên + embedding catalog ──> dòng catalog đã xác minh
```

RAG chỉ dùng các dòng `product_variants`, `products`, `categories`, `product_aliases`, `packaging_options` và giá hiện hành liên quan trong Supabase. Với mỗi biến thể đã xác minh, indexer tạo văn bản từ nhóm hàng, tên và mô tả sản phẩm, bí danh, quy cách, thuộc tính và đóng gói; văn bản dài được chia thành các chunk có chồng lấp nhỏ trước khi embedding. Chỉ biến thể đang hoạt động, có trạng thái `verified`, thuộc sản phẩm và danh mục đang hoạt động mới đủ điều kiện. Giá không được đưa vào embedding. Câu hỏi giá và câu hỏi quy cách phổ biến được trả lời trực tiếp từ SQL, nên không cần dịch vụ embedding hoặc chat hoạt động.

OCR, đọc ảnh để tạo nội dung, sửa bản chép, preview trang và các API trang OCR đã bị gỡ khỏi ứng dụng. Migration `202610180012_delete_retired_ocr_data.sql` xóa transcript OCR, các chunk/embedding OCR còn lưu và bảng `rag_page_texts`. Ảnh nguồn cùng liên kết provenance của danh mục vẫn được giữ; chúng không được đọc thành văn bản hay đưa vào embedding.

## Triển khai trong 5 bước

1. **Áp dụng migration.** Chạy các migration theo thứ tự trên project Supabase đã chọn, bao gồm `202610180009_catalog_only_rag.sql`, `202610180011_rag_products_description.sql` và `202610180012_delete_retired_ocr_data.sql`. Migration 009 chuyển RAG sang catalog; migration 011 đưa mô tả từ `products` vào tìm kiếm; migration 012 xóa transcript và embedding OCR đã lưu.

2. **Kiểm tra dữ liệu catalog.** Mỗi mặt hàng cần có sản phẩm và danh mục đang hoạt động, biến thể `active = true`, `verification_status = 'verified'`, cùng `raw_specification` hoặc `display_name` rõ ràng. Điền `attributes` và `packaging_options` ngay trên các bảng catalog. Giá phải nằm ở bảng giá Supabase với ngày hiệu lực và trạng thái hiện hành.

3. **Cấu hình embedding trên backend.** Cài Ollama cạnh backend rồi tải model tương thích:

   ```sh
   ollama pull bge-m3
   ollama pull qwen2.5:3b
   ```

   Trong `backend/.env.local`, cấu hình `RAG_AI_PROVIDER=ollama`, `RAG_AI_BASE_URL=http://localhost:11434`, `RAG_EMBEDDING_MODEL=bge-m3` và `RAG_CHAT_MODEL=qwen2.5:3b`. Embedding phải trả về 1.024 chiều. Chỉ backend giữ cấu hình provider. Không còn biến `RAG_OCR_MODEL`.

4. **Dựng lại catalog index.** Chạy API và worker:

   ```sh
   npm run dev
   npm run dev:worker --workspace backend
   ```

   Sau khi cập nhật backend và áp dụng migration 011, vào `/rag-admin` chọn **Tạo lại embedding catalog** để tạo generation mới theo chunker v5. Mỗi chunk gắn với một biến thể đã xác minh và mang mô tả sản phẩm cùng quy cách/thuộc tính/đóng gói từ Supabase; giá vẫn đọc trực tiếp, không embedding. Worker xử lý các revision được xếp hàng do thay đổi catalog và nút quản trị báo rõ nếu revision đang chờ.

5. **Kiểm tra kết quả thật.** Ở `/rag-admin`, xác nhận Supabase kết nối được, `embeddedVariants` bằng `catalogVariants`, không còn `missingVariants`, và model có 1.024 chiều. Trong `/questions` hoặc quầy bán hàng, hỏi thử một giá hiện hành và một quy cách/đóng gói. Trace của hai câu hỏi này phải có `embeddingModel: not_used`; kết quả giá phải khớp hàng giá Supabase. Hỏi một thuộc tính không có trong catalog phải báo thiếu dữ liệu, không tự đoán.

## Khi câu hỏi vẫn chưa trả lời được

- **Không thấy sản phẩm:** kiểm tra đúng tên/biệt danh, biến thể đã `verified`, và sản phẩm/danh mục đều `active`.
- **Thiếu quy cách hoặc đóng gói:** bổ sung `raw_specification`, `attributes` hoặc `packaging_options` cho biến thể trong Supabase rồi chờ worker xử lý revision mới.
- **Giá không khớp:** kiểm tra `prices.active`, `valid_from`, `valid_to`, loại giá, bảng giá không phải dữ liệu mẫu và nhà cung cấp còn hoạt động. Sửa giá không cần dựng lại embedding.
- **`missingVariants` lớn hơn 0:** xem worker/job trong `/rag-admin`, kiểm tra embedding provider và chạy lại indexing sau khi provider sẵn sàng.
- **Embedding không sẵn sàng:** tìm theo tên và tra giá SQL vẫn hoạt động; semantic search cần backend embedding và index cùng model.
- **Chat không sẵn sàng:** câu hỏi giá và quy cách được hỗ trợ trực tiếp vẫn hoạt động. Câu hỏi tư vấn/so sánh cần bằng chứng catalog và model chat.

Nguồn trả lời có thể chỉ rõ trang ảnh gắn với dòng catalog nếu tồn tại. Khi không có trang ảnh, ứng dụng hiển thị mã `product_variants` của dòng Supabase làm nguồn đối chiếu. Trang ảnh chỉ còn là provenance tùy chọn, không cấp nội dung cho RAG.

## Kiểm tra trong repository

```sh
npm run lint
npm run typecheck
npm test
npm run openapi:check
npm run build
npm run test:e2e
```

Unit/E2E mock xác nhận luồng trong ứng dụng, không thay thế việc áp dụng migration hay xác minh dữ liệu trực tiếp trên project Supabase. Hướng dẫn môi trường và E2E có đăng nhập ở [workspace runbook](docs/workspace-runbook.md).
