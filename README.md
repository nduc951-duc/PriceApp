# Giá Chuẩn

PriceApp là ứng dụng quầy hàng mobile-first để tìm vật tư, xem giá theo quy cách, lập báo giá và đọc snapshot khi mất mạng. Repository có hai workspace chạy độc lập: `frontend/` (Next.js) và `backend/` (Fastify API). Supabase Auth, PostgreSQL, Storage và RLS vẫn là nguồn dữ liệu.

## Chạy local

Yêu cầu Node.js 20.9+ và npm. Cài dependency một lần ở thư mục gốc:

```powershell
npm ci
Copy-Item frontend/.env.example frontend/.env.local
Copy-Item backend/.env.example backend/.env.local
```

Điền URL và publishable key của Supabase vào cả hai tệp local. Cấu hình `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000` ở frontend và `FRONTEND_ORIGINS=http://localhost:3000` ở backend. Không dùng secret/service-role key. Giữ khóa nhà cung cấp RAG trong `backend/.env.local`; không đưa chúng vào biến `NEXT_PUBLIC_*`.

Khởi động hai tiến trình bằng một lệnh:

```powershell
npm run dev
```

Frontend mặc định chạy ở `http://localhost:3000`, backend ở `http://localhost:4000`. Nếu một tiến trình dừng, runner sẽ dừng tiến trình còn lại. Dùng `Ctrl+C` để kết thúc cả hai. Kiểm tra API tại `http://localhost:4000/api/v1/health`.

Có thể chạy riêng từng workspace trong hai terminal:

```powershell
npm run dev --workspace backend
npm run dev --workspace frontend
```

Khi cần API tự khởi động lại sau mỗi lần sửa file, dùng `npm run dev:watch --workspace backend` riêng. Root runner dùng tiến trình backend trực tiếp để lỗi cấu hình/khởi động thoát mã lỗi và dừng frontend cùng lúc.

Trên Windows, root runner dừng đúng tiến trình con do nó tạo và đợi chúng thoát trước khi kết thúc. Trên Unix, runner dùng `concurrently`. Có thể chạy `npm run test:dev-runner` để kiểm tra dừng tiến trình con khi một dịch vụ lỗi hoặc khi nhấn Ctrl+C.

Các lệnh kiểm tra ở root áp dụng cho cả hai workspace: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`. `npm run openapi:check` phát hiện contract API đã sinh bị cũ; `npm run check` chạy toàn bộ gates đó. Lệnh `npm run test:e2e` chỉ bật server trên port riêng khi có đủ secrets cho project Supabase test biệt lập. Nếu chưa cấu hình, Playwright đánh dấu các case authenticated là skipped; nó không dùng tệp `.env.local` của ứng dụng làm tài khoản test.

## Cấu hình và vận hành

- Biến frontend: xem [frontend/.env.example](frontend/.env.example). Chỉ Supabase URL/publishable key và URL API được phép xuất hiện trong browser.
- Biến API và RAG: xem [backend/.env.example](backend/.env.example). Backend xác thực bearer token, dùng client theo token gọi Supabase để giữ RLS.
- Cấu hình local, CORS, triển khai tách rời, xử lý lỗi đăng nhập và rollback: [docs/workspace-runbook.md](docs/workspace-runbook.md).
- Luồng RAG, migrations, mô hình và quy trình duyệt nội dung: [RAG_SETUP.md](RAG_SETUP.md).
- Ranh giới hệ thống: [docs/architecture.md](docs/architecture.md).

Không commit `.env.local`, mật khẩu, access token, service-role key hay khóa provider. Trước khi thử luồng ghi, dùng project/account thử nghiệm riêng. Giá gốc `prices.amount` luôn giữ nguyên; mọi cập nhật giá phải đi qua RPC có audit và `expected_version`. Khi offline, ứng dụng chỉ đọc snapshot.
