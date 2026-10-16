# RAG L5–L9 · trạng thái triển khai

Rà soát ngày 10/10/2026. Checklist trong [roadmap](PRICEAPP_RAG_ROADMAP.md) chỉ chuyển sang hoàn tất sau khi có bằng chứng nghiệm thu; unit test không thay cho corpus, RLS cloud hoặc E2E.

## Đã có trong workspace

- **L5:** parser tiếng Việt giữ bề mặt kích thước/mã quy cách, không tự đổi đơn vị; thuộc tính hỏi rõ được lọc riêng theo variant, gói và loại giá đang hiệu lực. Câu hỏi có nhiều loại giá xung đột được yêu cầu làm rõ.
- **L6:** phản hồi có trạng thái `answered` / `clarify` / `insufficient_evidence`; giá trả từ SQL kèm `priceId`, `packagingId`, `version` và định dạng giữ tối đa hai số lẻ; citation giữ từng chunk cùng trang và có revision/span. Migration provenance đã áp dụng, RPC remote đã xác nhận trả revision/span.
- **L7:** API conversation dùng caller JWT và RLS; public API chỉ nhận câu hỏi user, assistant metadata do server ghi; lưu câu hỏi cùng trạng thái/IDs, không lưu câu trả lời hoặc đơn giá. Follow-up chỉ nối lại tên mặt hàng từ câu trước. POS loại giá chưa duyệt khỏi gợi ý/tổng tiền, tải lại catalog trước khi thêm/sao chép, bắt xác nhận khi phiên bản giá hoặc bao bì thay đổi và xóa bản báo giá khi đăng xuất kể cả lỗi revoke. Ba bảng hội thoại/feedback đã bật `FORCE ROW LEVEL SECURITY` trên remote.
- **L8:** có metric retrieval/answer/citation/abstention/latency, chia tune/test theo nhóm nguồn/câu hỏi, runner JSON, đánh giá hữu ích/chưa đúng với nhóm lỗi, tổng hợp owner và CSV. Candidate labels không góp vào điểm.
- **L9:** setup có luồng, ERD/sequence và hướng dẫn chạy evaluation runner.

## Bằng chứng local

- Backend: toàn bộ **29 test files / 152 tests qua**; typecheck, lint, build và `openapi:check` qua ngày 10/10/2026.
- Frontend: toàn bộ **18 test files / 86 tests qua**; typecheck, lint và production build qua. Lint còn một cảnh báo custom-font có sẵn ở `frontend/src/app/layout.tsx`; Vitest còn cảnh báo cấu hình Vite `configLoader: native`.
- Root runner: **2/2 tests qua**. Playwright desktop/mobile: **18 deterministic tests qua, 12 authenticated tests skipped** vì không có tài khoản/project E2E tách biệt.
- Evaluation runner có smoke run với input rỗng hợp lệ; chưa tạo corpus hoặc điểm giả.
- L4 index/provider đã chạy 13 unit tests tập trung trong cùng ngày; xem [RAG_L4_STATUS.md](RAG_L4_STATUS.md).

## Còn cần môi trường thật

- Đã áp dụng và xác nhận remote history cho migration đến `202610130002_reject_nonfinite_price_values.sql` trên project `App Price` (`tvznrmnxrgxdwukjsgon`); `db push --dry-run` báo không còn migration pending. Regression SQL chạy thành công với transaction rollback, kiểm profileless/version thiếu, `NaN`/vô cực, catalog amount và quantity; truy vấn trước đó xác nhận FORCE RLS trên ba bảng hội thoại/feedback và citation RPC trả revision/span.
- Không có corpus đã được chủ cửa hàng duyệt và test labels đã adjudicate. Vì thế chưa chạy retrieval baseline, chưa công bố Recall@5/MRR/độ đúng giá/citation/latency, và chưa đánh dấu L5–L8 hoàn tất.
- Chưa xác minh RLS conversation qua hai phiên đăng nhập thật, luồng owner/nhân viên, đổi giá đồng thời, thu hồi nguồn cloud hoặc demo E2E.
- Video/slide demo chưa được làm.

Không mở hoặc chép giá trị bí mật môi trường vào báo cáo. Sau khi áp migration, chạy lại test L4/L5–L8 với corpus duyệt, lưu nguyên input/config/revision và nhờ người có trách nhiệm kiểm tra toàn bộ ca tiền sai trước khi công bố kết quả.

## Cập nhật local ngày 16/10/2026

- `npm.cmd run check` qua: lint (còn một cảnh báo font có sẵn), typecheck, root runner 2/2, frontend 19 files/98 tests, backend 29 files/153 tests, OpenAPI và production builds.
- `npm.cmd run test:e2e` qua với 24 test desktop/mobile; 12 test owner/nhân viên được skip vì chưa có project/account E2E riêng. CI giờ chạy bộ mocked E2E trên pull request; job authenticated vẫn phụ thuộc test secrets.
- Catalog API phân trang variant theo ID thay cho giới hạn 1.000; regression test đọc 1.200 dòng qua ba trang. Nhãn giao dịch POS được thống nhất thành “báo giá”.
- Các kết quả trên xác nhận code và luồng giả lập; không thay thế việc xác thực RLS bằng tài khoản thật, index corpus cửa hàng hoặc benchmark RAG đã adjudicate.
