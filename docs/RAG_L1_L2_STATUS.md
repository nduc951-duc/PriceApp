> Cập nhật 2026-10-18: tài liệu này ghi lại thiết kế/trạng thái cũ có luồng OCR. Ứng dụng hiện chỉ dùng catalog Supabase đã xác minh; xem [RAG_SETUP.md](../RAG_SETUP.md) và migration 202610180009_catalog_only_rag.sql để biết hành vi hiện hành.

# Trạng thái triển khai L1–L2

## Đã thực hiện trong code

- Thêm migration revision cho bản chép; chunk OCR ghi `source_revision`. RLS và RPC chỉ trả chunk OCR còn `approved` đúng revision; chunk catalog cần biến thể còn `active`, `verified` và còn liên kết trang nguồn. Trạng thái `rejected` hoặc trang `unreadable` ẩn toàn bộ chunk gắn trang đó. Đường tìm lexical cũng lọc biến thể theo RPC `current_rag_variant_sources` để không trả giá từ nguồn đã thu hồi.
- Index xử lý cả tập nguồn rỗng; generation mới chỉ được publish khi đủ chunk, rồi dọn generation cũ. Lần index trả số chunk thêm/giữ/xóa, hash nội dung và model. Sửa giá SQL không nằm trong hash nội dung.
- API `/api/rag/health` kiểm tra Supabase, embedding 1.024 chiều, chat model và mã fingerprint cấu hình. Trang `/rag-admin` hiển thị ba kết quả riêng.
- API RAG trả `Cache-Control: private, no-store`; service worker v6 cache HTML shell chung của `/` cùng các asset build tĩnh để tải lại POS khi mất mạng, không cache API hay response theo phiên. Đăng xuất xóa cache và snapshot; vai trò được kiểm tra theo token ở từng request.
- Query trả dấu vết câu hỏi → chunk IDs → variant IDs → price IDs → câu trả lời; mặt hàng không có giá hiện hành nhận câu trả lời cố định “chưa có giá”.
- Có 20 [câu hỏi ứng viên](RAG_L1_CASES.md) cho tập L1 và kiểm thử tự động cho vai trò, index rỗng, cache, giá động và không có giá.

## Bằng chứng từ môi trường hiện tại

- Supabase project trong `.env.local` trả HTTP 200 cho các bảng `source_pages`, `rag_page_texts`, `rag_chunks` và các cột `revision`, `source_revision` khi kiểm tra bằng publishable key. Gọi RPC `rag_chunk_is_current` bằng anon trả 401 do thiếu quyền thực thi, phù hợp với việc hàm tồn tại và đã thu hồi quyền anon. Các phép kiểm tra này **chưa chứng minh** trigger và policy đã hoạt động với owner/viewer.
- Không có access token owner hoặc thông tin kết nối DB quản trị trong môi trường này. Vì vậy chưa đọc được số trang được duyệt, chưa chạy index/query có quyền, chưa kiểm tra giá đổi qua RPC trên database thật.
- Ollama hiện có `bge-m3:latest` và `qwen2.5:3b`; `/api/embed` trả vector 1.024 chiều và `/v1/chat/completions` trả lời. Đây là phép thử provider trực tiếp, chưa phải health check có owner trong ứng dụng.
- Kiểm tra lại ngày 04/10/2026: lint, TypeScript, 9 file/32 unit tests và production build qua; lint còn một cảnh báo font ở `layout.tsx`. API `/api/rag/pages` và `/api/rag/health` trả 401 kèm `private, no-store` khi không có phiên đăng nhập. E2E smoke desktop/mobile không qua vì hiện màn hình đăng nhập, không có phiên test. Các case L1 hiện chưa phải kết quả đo accuracy.

## Cần xác nhận để hoàn tất nghiệm thu

### Kiểm tra tiếp ngày 04/10/2026

- Chạy `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run build`: tất cả thành công; 7 file test, 29 test pass. Lint còn một cảnh báo font trong `src/app/layout.tsx`; build có cảnh báo Turbopack bỏ qua lockfile ở thư mục cha.
- Ở lần kiểm tra đầu, Ollama CLI gặp lỗi quyền ghi log và local API hết thời gian chờ. Sau đó API chạy được, đã pull hai model, thử embedding 1.024 chiều và chat thành công. Vẫn chưa chạy pipeline trên Supabase với owner.
- `.env.local` có tên biến kết nối Supabase và cấu hình RAG, nhưng phiên này không có owner token hay kết nối DB quản trị. Chưa áp migration, duyệt nguồn, index, hoặc đổi giá trên database thật. Không đánh dấu T01.1–T01.4 hoàn tất.

1. Trong Supabase SQL Editor, đối chiếu các migration `202609290002_rag_source_freshness.sql` và `202609290003_rag_reject_entire_source.sql` với schema thực tế hoặc chạy migration còn thiếu. Không sửa migration đã áp dụng.
2. Đăng nhập owner, đối chiếu ảnh và duyệt 1–2 trang; không tự gán `verified` cho biến thể chưa kiểm tra.
3. Chạy health check và index; lưu số chunk, revision/hash/model. Hỏi ít nhất một câu xuyên suốt pipeline rồi chạy bộ 20 câu.
4. Bỏ duyệt trang đã thử và xác nhận chunk OCR biến mất ngay; đổi phiên owner → viewer/anon, kiểm tra API và cache. Sửa một giá bằng RPC audited có `expected_version`, hỏi lại và xác nhận vector/hash không đổi.

## Cập nhật sau khi đồng bộ Supabase

Các mục “chưa áp migration” ở trên là ghi chú lịch sử ngày 04/10. Tại lần rà soát 10/10, migration `202610130001_harden_price_rpc_guards.sql` và `202610130002_reject_nonfinite_price_values.sql` đã hiện diện trong remote history. Regression SQL xác nhận profileless caller bị từ chối, update/undo/batch từ chối version thiếu, update/batch từ chối `NaN`/vô cực, và catalog từ chối số lượng/giá không hữu hạn; toàn bộ script chạy trong transaction rollback. Chưa có corpus được duyệt hoặc phiên owner/viewer thật để nghiệm thu indexing và độ đúng câu trả lời.
