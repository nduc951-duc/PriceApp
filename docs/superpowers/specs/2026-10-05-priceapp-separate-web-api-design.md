# PriceApp: thiết kế tách frontend và backend

**Trạng thái:** Bản thiết kế để người dùng duyệt
**Ngày:** 2026-10-05
**Phạm vi:** Tách ứng dụng thành frontend và backend có thể chạy, kiểm thử, triển khai độc lập trong cùng một Git repository.

## 1. Mục tiêu

- Giữ một repository duy nhất với hai thư mục ứng dụng dễ nhận biết: `frontend/` và `backend/`; `supabase/` tiếp tục chứa migration/seed ở root.
- Frontend và backend chạy riêng, có port, lệnh test/build và cấu hình triển khai riêng. Một lệnh tại repository root vẫn khởi chạy cả hai trong development.
- Chuyển mọi truy vấn catalog, giá và thao tác quản trị từ browser sang backend. Browser chỉ dùng Supabase Auth để đăng nhập/duy trì session và gọi HTTP API.
- Giữ Supabase Auth, PostgreSQL, RLS, Storage và các migration hiện có làm nền tảng dữ liệu; không di chuyển database khi tách ứng dụng.
- Giữ nguyên quy tắc nghiệp vụ giá, offline read-only, audit và kiểm tra phiên bản.

## 2. Phương án được chọn

Monorepo dùng npm workspaces:

```text
price-app/
  frontend/              # Next.js UI và PWA, không chứa API nghiệp vụ
    src/
    package.json
  backend/               # Fastify + TypeScript REST API
    src/
      routes/            # Khai báo endpoint và nối controller
      controllers/       # HTTP input/output, gọi service
      services/          # Luồng nghiệp vụ và điều phối
      repositories/      # Supabase queries và RPC
      middleware/        # Auth, role, error handling, request ID
      schemas/           # Zod request/response validation
      config/            # Environment/config validation
      app.ts
      server.ts
    openapi/             # API contract xuất từ schemas/routes
    package.json
  supabase/
    migrations/
    seed.sql
  package.json           # npm workspaces và lệnh điều phối ở root
```

Frontend tiếp tục dùng Next.js App Router. Backend dùng Fastify vì các API hiện hữu đã viết bằng TypeScript/Node và có thể chuyển dần sang server độc lập. Controller chỉ điều phối HTTP; service giữ luồng use case; repository gom Supabase reads/RPC để từng lớp có ranh giới kiểm thử rõ.

Schema Zod trong backend là nguồn chuẩn cho request/response và được xuất thành OpenAPI. Frontend sinh kiểu/client từ OpenAPI vào `frontend/src/lib/api/generated`; không duy trì hai định nghĩa hợp đồng thủ công và không thêm thư mục ứng dụng thứ ba.

Repository mẫu được cung cấp không tải được trong môi trường khảo sát (GitHub và raw README đều trả cache miss; kết nối GitHub trực tiếp bị chặn). Cấu trúc trên vì vậy dựa trên yêu cầu một repo và khảo sát PriceApp hiện có, không khẳng định sao chép chính xác repo mẫu.

## 3. Ranh giới thành phần

### Frontend (`frontend/`)

- Hiển thị giao diện bán hàng, hỏi giá, quản trị nguồn và trạng thái đăng nhập.
- Dùng Supabase client chỉ cho Auth/session; lấy access token hiện hành để gửi `Authorization: Bearer <token>` tới API.
- Đọc snapshot offline từ IndexedDB. Khi offline, ẩn/vô hiệu mọi thao tác ghi; không xếp hàng RPC để gửi sau.
- Không truy cập trực tiếp các bảng Supabase, Storage hoặc gọi RPC nghiệp vụ.
- Báo giá tạm vẫn tính phía giao diện từ số gói đã chọn nhân `prices.amount` nguyên bản; không ghi báo giá vào database trong phạm vi tách này.

### Backend (`backend/`)

- Xác minh access token với Supabase Auth bằng `getUser(token)`; không chỉ giải mã JWT rồi tin claims.
- Đọc profile/role và áp quyền owner/editor/viewer theo endpoint.
- Dùng Supabase client theo request với publishable key và access token của người gọi để RLS vẫn áp dụng. Không dùng service-role để bỏ qua RLS trong luồng người dùng.
- Nhận toàn bộ truy vấn catalog/giá, lịch sử, ảnh nguồn, RAG, trang quản trị nguồn và indexing.
- Chỉ ghi/sửa/hoàn tác giá qua RPC audit hiện có, truyền `expected_version`; không viết trực tiếp vào `prices`.
- Giữ cấu hình embedding/chat ở backend. Không trả provider key, prompt nội bộ hay lỗi upstream thô cho browser.

### Hợp đồng API (`backend/src/schemas`, `backend/openapi`)

- Định nghĩa schema đầu vào/đầu ra, mã lỗi và phiên bản API; xuất OpenAPI để frontend sinh client/kiểu.
- Không chứa truy cập database, secrets hoặc logic giá có thẩm quyền.
- Response không thay thế kiểm tra quyền, RLS hoặc kiểm tra lại giá ở thời điểm ghi.

## 4. Luồng request và xác thực

1. Người dùng đăng nhập qua Supabase Auth ở frontend.
2. Frontend lấy access token từ session hiện hành và gọi API trên host backend.
3. Backend xác minh token với đúng project Supabase, truy vấn role, rồi thực thi request bằng token đó để giữ RLS.
4. Với cập nhật/hoàn tác giá, backend gọi RPC audit hiện có với price ID và `expected_version`; database vẫn là nơi quyết định xung đột phiên bản.
5. Backend trả response đã kiểm tra theo schema hợp đồng. Mã lỗi phân biệt `401` (session không hợp lệ), `403` (thiếu role), `409` (version conflict), `422` (input/nghiệp vụ không hợp lệ), `503` (dịch vụ phụ thuộc tạm không sẵn sàng) và `500` (lỗi nội bộ có request ID).

Log không ghi access token, mật khẩu, secret key, email, nội dung OCR nguyên văn hoặc response chứa dữ liệu cá nhân. Log chẩn đoán xác thực ở development chỉ được ghi host kỳ vọng, issuer host, trạng thái hết hạn và status/code từ Auth; phải được gỡ hoặc giới hạn rõ trước production.

CORS backend chỉ cho phép origin frontend được cấu hình cụ thể. Giao thức dùng bearer token, không dùng cookie phiên backend; vì vậy không mở wildcard origins.

## 5. API cấp cao

Base path đề xuất: `/api/v1`.

- `GET /health`: trạng thái tối thiểu, không trả cấu hình bí mật.
- `GET /me`: user và role hiện hành sau xác thực.
- `GET /catalog/search`, `GET /catalog/variants/:id`: tìm kiếm và chi tiết catalog.
- `GET /prices`: các mức giá hiện hành theo biến thể/bao bì.
- `POST /prices/:id/update`, `POST /prices/:id/undo`: gọi RPC audit có `expected_version`.
- `POST /rag/query`: retrieval, kiểm tra variant/price ID, giá SQL và citation.
- `GET|PUT /admin/rag/pages`, `GET|POST /admin/rag/index`, `GET /admin/rag/health`: quyền owner.

Tên và payload chính xác sẽ được khóa trong implementation plan sau khi duyệt spec và rà lại chữ ký RPC/schema hiện hành.

## 6. Chạy và cấu hình

- Giữ npm làm package manager trong lần tách đầu; khai báo `frontend` và `backend` trong npm workspaces, tránh đổi lockfile/package manager cùng lúc.
- Frontend dev server mặc định cổng `3000`; backend cổng `4000`.
- Root có `npm run dev`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; từng workspace vẫn chạy được độc lập.
- Frontend cấu hình `NEXT_PUBLIC_API_BASE_URL`; publishable key chỉ phục vụ Auth. Backend cấu hình Supabase URL/publishable key, CORS allowlist và provider RAG.
- `RAG_AI_API_KEY` và endpoint provider chỉ tồn tại ở môi trường backend.
- Provider triển khai chưa bị khóa: mỗi workspace có build/start riêng và biến môi trường riêng; chọn Vercel/Render/Railway hoặc provider khác ở bước triển khai.

## 7. Kế hoạch chuyển đổi và rollback

1. Chụp baseline hiện tại: lint, typecheck, unit tests, build; ghi nhận API/contract và xác minh lỗi 401 hiện tại bằng test/integration có token thật mà không ghi token vào log.
2. Tạo workspace và di chuyển Next.js sang `frontend/` cùng cấu hình/test; giữ hành vi hiện tại.
3. Tạo Fastify `backend/` với routes/controllers/services/repositories, health/auth/role middleware, OpenAPI và integration tests với Supabase test project.
4. Chuyển RAG API trước; thêm base URL và CORS; kiểm tra owner/viewer/invalid-token/expired-token.
5. Chuyển catalog, giá và lịch sử đọc từ browser qua API.
6. Chuyển cập nhật/undo sang API gọi đúng RPC audit; kiểm tra `expected_version`, offline read-only và tổng báo giá không đổi.
7. Chuyển admin pages/indexing; xác nhận generation, RLS, nguồn bị thu hồi và provider lỗi/resume.
8. Chỉ xóa Next route handler và Supabase data client phía browser sau khi parity, E2E desktop/mobile và rollback window đạt yêu cầu.

Trong giai đoạn chuyển đổi, frontend chỉ đổi sang route backend khi route mới qua test; route cũ được giữ trong cùng nhánh cho tới khi cắt chuyển được xác nhận. Không duy trì song song lâu dài sau cutover.

Không tạo/đổi schema Supabase trừ khi implementation phát hiện một yêu cầu cụ thể; mọi migration mới dùng timestamp mới. Dữ liệu, Auth user ID, profile role, price history và nguồn hiện tại phải giữ nguyên.

## 8. Nghiệm thu

- Một lệnh tại root chạy cả frontend và backend; từng service có thể chạy/build/test riêng.
- Frontend production gọi đúng backend origin qua cấu hình và CORS.
- Backend xác minh token đúng project; test token hợp lệ, thiếu, hết hạn, sai project và role khác nhau.
- RLS tiếp tục giới hạn dữ liệu; browser không còn truy cập bảng Supabase hay gọi RPC nghiệp vụ trực tiếp.
- Mọi ghi giá gọi audited RPC với `expected_version`; conflict được trả rõ; `prices.amount` không bị biến đổi.
- Offline chỉ đọc; báo giá tính theo số gói đã chọn × `prices.amount`.
- RAG index/retrieval, citation, quyền owner và thu hồi nguồn giữ nguyên hành vi sau chuyển.
- Lint, typecheck, unit, integration, E2E, build qua cho hai app và root orchestration.
- Runbook giải thích local dev, cấu hình, test, deploy độc lập, CORS, health và xử lý lỗi auth.

## 9. Ngoài phạm vi

- Chuyển Supabase sang database riêng hoặc tự viết lại Auth.
- Dùng service-role key trong frontend hoặc bỏ RLS.
- Thay đổi giá, công thức tính tiền, phân cấp bán lẻ/bán sỉ, quy cách hoặc audit nghiệp vụ.
- Đưa LLM vào quyết định giá hoặc tự duyệt OCR/biến thể.
- Chọn vendor hosting trước khi người dùng quyết định.
- Chuyển thành microservices riêng lẻ; phạm vi là một backend API có module rõ ràng.

## 10. Tự rà soát

- Mục tiêu một repo với hai thư mục ứng dụng `frontend/` và `backend/`, triển khai độc lập, được mô tả nhất quán.
- Ranh giới browser/backend/Supabase và xử lý token được nêu rõ; không yêu cầu service-role.
- Quy tắc giá, RPC audit, `expected_version`, RLS và offline read-only được giữ nguyên.
- Repo tham khảo được ghi nhận là chưa truy cập được; không tuyên bố đã xem cấu trúc của repo đó.
- Provider hosting và payload API còn mở có ghi rõ; các quyết định implementation cụ thể sẽ được khóa trong plan sau khi spec được duyệt.
