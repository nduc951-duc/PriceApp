# Dọn cấu trúc và kiểm chứng — 19/10/2026

Đã chuyển 80 file test/hỗ trợ, giữ phân cấp module và cập nhật import, mock, đường dẫn fixture, cấu hình Vitest/Playwright, lint và script chạy test:

- `backend/tests`: 53 file unit/HTTP test, cùng `live/customer-rag.ts` để thử provider thật.
- `frontend/tests/unit`: 12 file unit test.
- `frontend/tests/e2e`: 13 file Playwright test cùng fixture/setup dùng chung.
- `tests/scripts`: test bộ giám sát tiến trình dev.
- `supabase/tests`: giữ nguyên SQL test đã nằm riêng.

Không còn file `.test`/`.spec` trong mã nguồn `backend/src`, `frontend/src` hoặc `scripts`. Production backend tiếp tục chỉ biên dịch `src`; các mock test được Vitest thực thi theo cấu hình cũ. Không thay đổi hành vi ứng dụng trong đợt dọn này.

Đã xóa 8 file log runtime, 9 log JSONL, 4 script chẩn đoán/smoke dùng một lần, output tạm của Playwright và 4 bản ghi JSON cũ đã được người dùng xác nhận riêng. Giữ báo cáo tổng kết Markdown, bản tổng hợp JSON có giá trị (`post-index-rag-summary.json`), dữ liệu kiểm thử, migration và cấu hình môi trường. Thêm ignore cho log runtime và thư mục artifact. Thư mục build/dependency là output vận hành cần thiết, không xóa trong lúc ứng dụng đang dùng.

## Kết quả tự động

`npm run check`: **đạt**, gồm lint, production source typecheck, dev runner 2/2, frontend unit 84/84, backend 436/436, OpenAPI và production build.

Toàn bộ Playwright sau khi chuyển thư mục: **100 đạt, 20 lỗi, 12 bỏ qua** trên desktop/mobile. 12 bài integration cần cấu hình dự án Supabase riêng. Các lỗi thực tế được ghi nhận, không bỏ bài hoặc hạ kỳ vọng để tạo kết quả xanh:

| Nhóm | Bài lỗi (mỗi bài ở cả desktop/mobile) | Bằng chứng |
| --- | --- | --- |
| Catalog RAG admin | 1 | Mong đợi dòng `Danh mục đã thay đổi` trong khi giao diện đã chuyển sang tiến độ lập chỉ mục |
| Quản lý giá | 1 | Mong đợi nút `Tạo 1 giá demo`; giao diện hiện tại dùng nhãn khác |
| Nhãn catalog | 1 | Mong đợi `.pos-eyebrow` khi chưa chọn chi tiết, phần tử không hiện |
| Báo giá quầy | 7 | Chọn mặt hàng làm ẩn panel báo giá tổng; test vẫn tìm `.pos-open-invoice`, `.pos-invoice-empty` hoặc `.pos-invoice-total` trong panel đó. Cần điều chỉnh bước điều hướng rồi kiểm tra lại quyền sửa/chép, đăng xuất và focus, trước khi kết luận đây chỉ là selector cũ |

Không kết luận 20 lỗi trên là hồi quy do chuyển thư mục, cũng không khẳng định chúng đã tồn tại từ trước bằng một baseline chưa chạy. Bằng chứng hiện có cho thấy các lỗi ở kỳ vọng/trạng thái giao diện, không phải module import hoặc test discovery. Không khôi phục nội dung UI cũ chỉ để làm các bài test này đạt.

## Kiểm thử khách hàng thật

Xem [đánh giá khách hàng](2026-10-19-customer-rag-evaluation.md). Câu giới thiệu tự nhiên trả lời được; câu hỏi thiếu chiều dài còn quá dài dòng. Phần còn lại bị giới hạn quota Gemini ngày; chưa thể chấm chất lượng toàn bộ 12 lượt.

Hướng dẫn chạy: [tests/README.md](../../tests/README.md).
