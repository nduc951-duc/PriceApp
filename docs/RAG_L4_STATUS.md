# L4 · Trạng thái lập chỉ mục ổn định

## Kiểm tra remote ngày 05/10/2026

- Project đã link: `tvznrmnxrgxdwukjsgon`. Lịch sử CLI thiếu bốn migration RAG dù schema của `202609290001`, `202609290002` và `202610040001` đã hiện diện. `db push` đầu tiên dừng tại `rag_page_texts already exists`; không có migration mới nào được áp từ lần thử đó.
- Đã xác minh cột, trigger, RPC và policy bằng truy vấn PostgreSQL chỉ đọc. Đã dùng `migration repair --status applied` cho ba migration đã hiện diện. Dry run sau đó chỉ còn `202609290003_rag_reject_entire_source.sql`; đã áp file này bằng `db push --include-all` và xác nhận lịch sử local/remote khớp cả bốn migration.
- Bộ SQL `docs/RAG_L4_VERIFY.sql` chạy thành công dưới vai trò `postgres`: bảng run/state/chunk, năm RPC liên quan index, policy L4 đều có. Sau khi áp migration nguồn, RPC `current_rag_variant_sources` xuất hiện và hàm kiểm tra chunk đã xét nguồn bị từ chối.
- Database hiện có 13 bản chép `draft` với 0 ký tự, 0 chunk và 0 variant `verified`. 692 variant còn `needs_review`; không tự duyệt bản chép hoặc variant. Chưa thể nghiệm thu index generation, resume và reuse trên nguồn thật.
- Ban đầu auto-review từ chối gán `owner` vì chưa có chấp thuận rõ. Người dùng sau đó đã chấp thuận đúng tài khoản Auth; đã tạo một profile `owner` cho tài khoản đó. Kiểm tra read-only với claims owner thấy 13 bản nháp và index state; claims không có profile thấy 0 bản nháp và 0 index run. Đây là kiểm tra policy SQL, chưa thay thế E2E qua phiên đăng nhập thật.
- `db push --dry-run` hiện báo remote đã cập nhật đầy đủ. Ollama có `bge-m3` và `qwen2.5:3b`; `/api/embed` trả vector 1.024 chiều.

## Đã có trong code

- Migration `202610040001_rag_index_generations.sql` thêm `rag_index_runs`, checkpoint, một run đang chạy, generation staging và publish nguyên tử. Retrieval chỉ dùng generation đang active; policy hiện hành vẫn loại nguồn bị thu hồi.
- API index đọc nguồn/chunk theo trang 500 dòng, xử lý 16 chunk mỗi request, retry embedding và ghi batch tối đa ba lần, dùng content hash + chunker version + provider/model artifact fingerprint để tái sử dụng vector. Giá SQL không tham gia văn bản embedding.
- Embedding kiểu OpenAI được sắp lại theo `data[].index`; sai count, index, dimension hoặc số không hữu hạn đều bị từ chối.
- `/rag-admin` hiển thị run, checkpoint, số chunk mới/tái sử dụng/loại bỏ, lỗi an toàn và nút chạy tiếp sau khi reload.

## Bằng chứng và phần còn thiếu

- Ngày 04/10/2026: lint (một cảnh báo font đã có), typecheck, 32 unit tests và build đã qua. Unit test xác nhận chạy lại cùng text dùng 0 embedding mới, đổi text chỉ tạo embedding cho chunk đổi, và lỗi batch sau giữ generation cũ tới khi resume thành công.
- Ngày 04/10/2026, Supabase REST từng trả 404 cho `rag_index_runs` và `rag_index_state`. Kiểm tra PostgreSQL ngày 05/10/2026 cho thấy schema L4 đã có từ trước nhưng lịch sử CLI chưa ghi; phần lịch sử đã được sửa như ghi ở đầu tài liệu.
- Ollama local API đã chạy. Đã pull `bge-m3` và `qwen2.5:3b`; gọi `/api/embed` với `bge-m3` trả 1 vector 1.024 chiều. Endpoint `/v1/chat/completions` với `qwen2.5:3b` trả lời thành công. Chưa có kết quả thử đầy đủ với 13 trang và lỗi giữa batch trên database thật.
- E2E smoke desktop/mobile không qua: test cần UI tra cứu ngay ở `/`, nhưng phiên test dừng ở màn hình đăng nhập. Đây là blocker cho kiểm tra UI sau đăng nhập, không phải lỗi được chứng minh ở index L4.

## Nghiệm thu cần chạy trên môi trường thật

1. Đăng nhập bằng owner qua ứng dụng và kiểm tra `/rag-admin` health trên UI.
2. Đối chiếu/duyệt nguồn bằng mắt; hiện 13 trang draft rỗng và 692 biến thể `needs_review`, nên chưa có corpus RAG hợp lệ.
3. Với nguồn đã duyệt: chạy index trọn vẹn; chạy lại cùng text và sau sửa giá bằng audited RPC phải có `indexed = 0`; sửa một đoạn chỉ embed chunk liên quan.
4. Ngắt provider giữa hai batch, xác nhận `active_generation` và kết quả truy vấn vẫn là generation cũ; chạy tiếp từ checkpoint rồi xác nhận publish nguyên tử. Thu hồi trang phải ẩn chunk ngay cả khi run staging chưa xong.

Migration đã đồng bộ và model local đã xác nhận. Các bước còn lại cần phiên owner đăng nhập và nội dung đã được người có trách nhiệm cửa hàng duyệt.

Chưa đánh dấu T04.1–T04.5 hoàn tất cho tới khi migration và luồng thật được kiểm chứng.
