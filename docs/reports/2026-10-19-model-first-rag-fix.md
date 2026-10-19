# Sửa luồng tra catalog bằng model-first hybrid RAG

Ngày kiểm tra: 2026-10-19. Thực hiện trực tiếp trong thư mục dự án hiện tại.

## Thay đổi

- Planner gọi model trước cho câu hỏi catalog; các mẫu regex cũ chỉ còn phục vụ tra SQL dự phòng khi provider không sẵn sàng. Chuẩn hóa các trường tùy chọn rỗng do model nhỏ sinh ra trước khi kiểm tra schema.
- Câu ngắn và câu hỏi đầy đủ dùng cùng pipeline tra catalog: kế hoạch đã kiểm tra → SQL phân trang và embedding chạy song song → đối chiếu tên hàng, vật liệu, quy cách → câu dẫn do model sinh từ bằng chứng → số liệu hiển thị nguyên từ SQL.
- Quy cách được chuẩn hóa chỉ khi tìm kiếm: `8 ly x 3F`, `8x30`, `8 mm x 3 cm` có cùng kích thước. Không sửa quy cách lưu trong database, không tạo thêm sản phẩm, quy cách, giá hoặc migration.
- Tên hàng người dùng đã nêu phải khớp tên/alias catalog. Model nhận nhầm tên hàng hoặc vector trả nhóm khác không được phép thay tắc kê bằng bulong, kể cả khi nhóm hàng người dùng hỏi không có kết quả SQL.
- Khi thiếu đúng quy cách, trả các lựa chọn cùng nhóm/cùng đường kính tìm được, không đưa các lựa chọn đó vào `items` như một kết quả mua hàng đúng yêu cầu.
- Câu hỏi tìm nhóm sản phẩm được tổng hợp theo sản phẩm cha; danh sách chưa đọc hết được ghi rõ. Thông tin đóng gói, các thuộc tính hiển thị phù hợp và quyền xem giá được giữ lại.
- Câu văn catalog có schema riêng, giới hạn đầu ra và kiểm chứng bằng chứng. Không chấp nhận giá, quy cách bịa, tên hàng lạ hoặc suy diễn chịu tải/công dụng từ tên catalog. Nếu đầu ra không đạt kiểm chứng, dùng phần trả lời an toàn từ dữ liệu đã truy xuất.
- Khắc phục trường bắt buộc `verificationStatus` ở từng dòng giá để HTTP response tương thích hợp đồng API.

Luồng tư vấn/so sánh tài liệu và thực thi nhiều yêu cầu tiếp tục dùng cơ chế bằng chứng hiện có. Bản sửa này tập trung vào sự thiếu nhất quán của luồng hỏi sản phẩm, quy cách và giá; không phải đánh giá toàn bộ chất lượng tư vấn.

## Kiểm tra thật qua HTTP handler

Chạy `backend/scripts/smoke-catalog-rag.ts` qua Fastify `app.inject` với Ollama `qwen2.5:3b`, embedding `bge-m3` và catalog Supabase công khai thật. Không khởi động thêm server, không cần tài khoản nhân viên và không ghi database.

| Câu hỏi | HTTP | Kết quả | Vector liên quan |
|---|---:|---|---:|
| tắc kê sắt 8 ly x 3f | 200 | Không có đúng cỡ; nêu `8x60`, `8x80`, `8x100`, `8x120`; không trả bulong | 4 |
| Tắc kê sắt 8 ly x 3F có quy cách gì? | 200 | Cùng kết quả về quy cách như câu ngắn | 4 |
| Bulong 8 ly x 3F có quy cách gì? | 200 | Biến thể #47, quy cách gốc `8 ly x 3F` | 1 |
| Thông tin Bulong 8x30 | 200 | Cùng biến thể #47 | 1 |
| Giá Bulong 8 mm x 3 cm? | 200 | Cùng biến thể #47; 9.000 đ/gói 10 bộ và 70.000 đ/gói 100 bộ lấy nguyên từ SQL | 1 |

Mỗi trường hợp có hai lần gọi chat (planner và sinh câu dẫn), một lần gọi embedding và truy xuất SQL. Thời gian của lượt xác nhận khoảng 2–3 giây/câu. Log JSONL dùng trong đợt chẩn đoán này đã được xóa khi dọn dự án theo yêu cầu; phần tổng kết được giữ trong báo cáo này.

Model nhỏ vẫn có thể sinh câu văn bị kiểm chứng từ chối; lời văn có thể khác giữa các lần chạy. Dữ liệu thiếu đúng quy cách vẫn phải được báo thiếu, dù model hoặc vector tìm thấy mặt hàng gần giống. Không xem năm câu kiểm tra này là bằng chứng mọi cách hỏi đều đã được xử lý hoàn hảo.

## Kiểm tra tự động

- Lint, typecheck và production build của cả frontend/backend đạt trong lượt kiểm tra toàn dự án.
- Frontend: 84 test đạt; dev runner: 2 test đạt.
- Backend: chạy lại toàn bộ sau khi bổ sung kiểm tra HTTP, bảo vệ tên hàng và chuẩn hóa đơn vị; mọi test đạt.
- Regression mới kiểm tra tương đương đơn vị, câu ngắn/câu đầy đủ đều gọi planner, JSON model có trường rỗng, tên hàng model sai, nhóm yêu cầu không tồn tại, lỗi RPC vector, số tiền SQL không đổi, nhóm sản phẩm và HTTP serialization.
- Các test tra SQL cũ gọi riêng operation dự phòng; các test mới gọi entry point `queryRag` và HTTP API thật để bảo đảm đường chạy model-first không bị bỏ qua.

## Chạy lại

Backend `npm run dev` hiện không watch file. Dừng bằng Ctrl+C rồi chạy lại trong `price-app/backend` để nạp mã mới. Không cần chạy migration hay lập chỉ mục lại cho bản sửa này.

Chạy smoke test chỉ đọc từ thư mục backend:

```powershell
node --env-file-if-exists=.env.local --import tsx scripts/smoke-catalog-rag.ts
```
