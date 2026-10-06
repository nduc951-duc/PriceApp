# Kiến trúc PriceApp

PriceApp dùng npm workspaces trong một repository. `frontend/` chứa Next.js App Router, giao diện mobile, Supabase Auth client và IndexedDB snapshot. `backend/` chứa Fastify API với các lớp routes, controllers, services, repositories và schemas. Hai workspace lint, typecheck, test và build độc lập; root scripts gọi các workspace tương ứng.

```text
Browser ── Supabase Auth ── Supabase Auth
   │
   └── bearer token ── Fastify API ── PostgreSQL / Storage (RLS)
                              └────── provider RAG (server only)
```

Browser chỉ dùng Supabase cho đăng nhập/khôi phục phiên; catalog, Storage, RAG và thao tác nghiệp vụ đi qua API. API xác minh token với Auth, lấy role, rồi dùng Supabase client mang token người gọi để giữ RLS. Không có service-role trong luồng người dùng. CORS dùng danh sách origin chính xác do `FRONTEND_ORIGINS` cấu hình; mọi phản hồi lỗi có request ID.

## Quy tắc giá và offline

`prices.amount` là giá chuẩn. Số lượng được chọn nhân với `prices.amount` nguyên bản để ra thành tiền; không chia hoặc quy đổi giá. Thao tác cập nhật/undo giá gọi RPC có audit và chuyển tiếp `expected_version`. Khi mất mạng, UI chỉ đọc snapshot IndexedDB; không gửi ghi.

## API và vận hành

- Backend mặc định nghe port `4000`; frontend mặc định nghe `3000`.
- `npm run dev` chạy cả hai tiến trình; nếu một tiến trình dừng, tiến trình còn lại cũng bị dừng. Mỗi workspace vẫn có thể chạy riêng.
- `/api/v1/health` là health check không yêu cầu đăng nhập. Route nghiệp vụ yêu cầu bearer session và role phù hợp.
- OpenAPI được sinh từ Zod schemas ở backend; `npm run openapi:check` kiểm tra file contract đã commit.
- Frontend và backend triển khai độc lập. Khai báo `NEXT_PUBLIC_API_BASE_URL` phía frontend và đưa chính xác origin web vào `FRONTEND_ORIGINS` phía API.
- Chi tiết setup, auth/CORS troubleshooting, E2E và rollback nằm ở [workspace runbook](workspace-runbook.md).
