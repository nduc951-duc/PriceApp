# PriceApp Frontend/Backend Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tách PriceApp thành `frontend/` Next.js và `backend/` Fastify có thể chạy, kiểm thử, triển khai độc lập trong cùng repository.

**Architecture:** Dùng npm workspaces ở root; giữ Supabase Auth/PostgreSQL/RLS làm hệ thống dữ liệu. Frontend chỉ gọi Supabase Auth và HTTP API; backend xác minh bearer token, giữ RLS bằng access token người gọi, chia lớp routes/controllers/services/repositories và sở hữu toàn bộ data API.

**Tech Stack:** Next.js 16, React 19, Fastify 5, TypeScript, Zod 4, `fastify-type-provider-zod` 7+, `@fastify/swagger`, Supabase JS, Vitest, Playwright, npm workspaces.

**Spec:** [2026-10-05-priceapp-separate-web-api-design.md](../specs/2026-10-05-priceapp-separate-web-api-design.md)

## Global Constraints

- `public.prices.amount` luôn là số tiền chuẩn. Không chia/chuẩn hóa số tiền để suy giá.
- Chỉ quy đổi số lượng/bao bì khi có dữ liệu và quy tắc nghiệp vụ đã được xác nhận; chọn dòng giá hợp lệ rồi tính số gói được chọn × amount nguyên bản.
- Price writes must use audited RPCs with `expected_version`; offline behavior is read-only.
- Không dùng service-role để bỏ qua RLS trong luồng người dùng.
- Supabase schema/data/Auth user ID/profile role/price history/source giữ nguyên; migration mới chỉ khi có yêu cầu cụ thể và phải dùng timestamp mới.
- Browser chỉ dùng Supabase Auth/session; không gọi bảng, Storage hay RPC nghiệp vụ trực tiếp.
- Không đưa access token, password, secret key hoặc nội dung OCR nguyên văn vào log.

## Review Focus

- Token rỗng, hết hạn, sai project issuer hoặc Auth network timeout phải thành status/code đúng, không gom lỗi cấu hình/mạng thành 401.
- Owner/editor/viewer/anon phải giữ đúng quyền qua API và RLS; đổi tài khoản không giữ cache dữ liệu người trước.
- Version conflict và undo phải dùng `expected_version`, không thay đổi `prices.amount` sai, không ghi offline.
- Catalog rỗng, inactive/sample variants, nested joins null, nhiều hơn 1.000 variants và source path không hợp lệ không được làm mất dữ liệu hoặc ký URL ngoài quyền.
- Provider embedding/chat timeout, vector sai count/dimension hoặc OCR chứa chỉ dẫn không được làm lộ bí mật, publish generation dở dang hay sinh giá ngoài SQL.

---

## File map

- `frontend/`: toàn bộ `src/`, `public/`, `tests/` và cấu hình Next/Vitest/Playwright/Tailwind hiện ở repository root.
- `backend/src/routes/`: ghép route/version prefix và schema HTTP.
- `backend/src/controllers/`: nhận request đã validate, gọi service, map kết quả sang HTTP.
- `backend/src/services/`: use cases catalog, price, source image, RAG query/index/admin.
- `backend/src/repositories/`: Supabase reads, Storage signed URL và RPC calls theo request token.
- `backend/src/middleware/`: authenticate, load profile role, request ID, error response.
- `backend/src/schemas/` + `backend/openapi/`: Zod 4 là nguồn contract; OpenAPI sinh từ route schema.
- `backend/src/rag/`: provider, chunking, ranking, deterministic price answer và RAG domain code hiện ở `src/lib/rag/`.
- Root `package.json`: npm workspace orchestration; `supabase/`, `docs/`, SQL audit files giữ vị trí.
- `.env.example`, `README.md`, `RAG_SETUP.md`, `docs/architecture.md`: cập nhật cách chạy và cấu hình theo hai app.

## Task 1: Chuyển Next.js sang workspace `frontend/`

**Files:**
- Move: root `src/`, `public/`, `tests/`, `next.config.ts`, `tsconfig.json`, `next-env.d.ts`, `eslint.config.mjs`, `postcss.config.mjs`, `playwright.config.ts`, `vitest.config.ts` → `frontend/`.
- Create: `frontend/package.json`, root `package.json` workspace manifest.
- Modify: root `package-lock.json`, `.gitignore`, `.env.example`.
- Keep: root `supabase/`, `docs/`, `RAG_SETUP.md`, `README.md`, `AGENTS.md`, `CLAUDE.md`.

**Interfaces:** Frontend giữ nguyên route/component exports trong task này; scripts có thể chạy từ `frontend/` bằng npm workspace. Không tạo backend hoặc đổi API ở task này.

- [ ] **Step 1: Chụp baseline** — chạy `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`; lưu số test và cảnh báo hiện có trong plan execution notes.
- [ ] **Step 2: Tạo frontend workspace manifest** — khai báo scripts `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`; khai báo `next`/React runtime và dependency frontend hiện có.
- [ ] **Step 3: Di chuyển app và cấu hình** — chuyển đúng các file trong Files map; giữ nguyên relative config/path aliases, cập nhật Playwright `baseURL`/webServer path để chạy từ `frontend/`.
- [ ] **Step 4: Đặt workspace root và đồng bộ lockfile** — khai báo tạm `workspaces: ["frontend"]` ở root; Task 2 sẽ thêm `backend` vào workspace khi `backend/package.json` đã tồn tại.
- [ ] **Step 5: Kiểm chứng refactor** — chạy từ root `npm run lint --workspace frontend`, `npm run typecheck --workspace frontend`, `npm test --workspace frontend`, `npm run build --workspace frontend`; kết quả phải tương ứng baseline.
- [ ] **Step 6: Commit** — `refactor: move Next.js app into frontend workspace`.

## Task 2: Tạo Fastify backend và xác thực request

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/src/app.ts`, `backend/src/server.ts`, `backend/src/config/env.ts`.
- Create: `backend/src/routes/health.routes.ts`, `backend/src/routes/auth.routes.ts`, `backend/src/controllers/auth.controller.ts`, `backend/src/services/auth.service.ts`, `backend/src/repositories/supabase-client.ts`.
- Create: `backend/src/middleware/authenticate.ts`, `backend/src/middleware/require-role.ts`, `backend/src/middleware/errors.ts`, `backend/src/middleware/request-id.ts`.
- Create: `backend/vitest.config.ts`.
- Create: `frontend/src/lib/api/client.ts` as the minimal authenticated transport required by the API feature tasks; Task 6 adds generated contract types and final error handling.
- Test: `backend/src/middleware/authenticate.test.ts`, `backend/src/middleware/errors.test.ts`, `backend/src/app.test.ts`.
- Modify: root `package.json`, root lockfile; move safe auth diagnostics from `frontend/src/lib/rag/auth-diagnostics.ts` to backend diagnostic module.

**Interfaces:**
- `buildApp(options: { env: AppEnv; supabaseFactory: SupabaseFactory }): FastifyInstance` in `backend/src/app.ts`.
- `authenticate(request): Promise<{ user: User; client: SupabaseClient; role: AppRole }>` decorates request only after Supabase `auth.getUser(token)` and profile lookup pass.
- `GET /api/v1/health` returns `{ status: "ok" }`; `GET /api/v1/me` returns `{ userId: string; role: AppRole }`.
- `requestApi<T>(path: string, init?: RequestInit): Promise<T>` reads the current Supabase session and calls `NEXT_PUBLIC_API_BASE_URL`; it never logs tokens or bodies.

- [ ] **Step 1: Test auth outcomes first** — add Fastify `inject` tests named `rejects missing bearer token`, `rejects expired or wrong-project token`, `loads owner role for a valid token`, `denies viewer on owner route`, `returns 503 when Supabase Auth is unreachable`; assert status and response schema.
- [ ] **Step 2: Verify red** — run `npm test --workspace backend -- authenticate.test.ts`; expected failures because routes/middleware do not exist.
- [ ] **Step 3: Implement request-scoped auth** — validate config with Zod; create Supabase client from URL/publishable key and caller JWT; call `getUser(token)` rather than trusting decoded claims; query `profiles.role`; never use service-role.
- [ ] **Step 4: Add error/CORS/request ID plugins** — use an exact configured origin allowlist; map invalid token to 401, role denial to 403, upstream Auth timeout to 503; log only request ID and safe status/code fields.
- [ ] **Step 5: Verify green** — run backend focused tests, lint, typecheck and build; assert error logs do not include token, email, or user ID.
- [ ] **Step 6: Commit** — `feat: add Fastify API and Supabase request auth`.

## Task 3: Chuyển RAG API/domain sang backend

**Files:**
- Move: `frontend/src/app/api/rag/{health,index,pages,query}/route.ts` behavior to `backend/src/routes/v1/rag.routes.ts` and focused controllers.
- Move: `frontend/src/lib/rag/*.ts` domain/provider files and tests to `backend/src/rag/` and `backend/src/rag/*.test.ts`; exclude client-only auth gate code.
- Create: `backend/src/controllers/rag-query.controller.ts`, `rag-admin.controller.ts`; `backend/src/services/rag-query.service.ts`, `rag-index.service.ts`, `rag-pages.service.ts`, `rag-health.service.ts`; repositories for chunks/pages/catalog retrieval.
- Create: `backend/src/routes/v1/rag.routes.test.ts`, `backend/src/routes/v1/rag-preview.test.ts`.
- Modify: `frontend/src/components/price-question-assistant.tsx`, `frontend/src/components/rag-admin.tsx`, their API client imports.
- Keep temporarily: `frontend/src/app/api/rag/**` as a rollback path until Task 7 parity/E2E gate passes; Task 7 deletes them after cutover.

**Interfaces:**
- `POST /api/v1/rag/query`: body `{ question: string }`; response retains answer/items/sources/retrieval shape.
- `GET|PUT /api/v1/admin/rag/pages`, `GET|POST /api/v1/admin/rag/index`, `GET /api/v1/admin/rag/health`: owner-only.
- `POST /api/v1/admin/rag/preview`: `{ extractedText: string }` → normalized chunk list `{ index, content, start, end }`; does not call embedding provider or write data.

- [ ] **Step 1: Test preview and role boundary** — assert normalized offsets slice back to chunk content for indentation/repeated lines, empty text returns no chunks, non-owner cannot preview/admin, and preview makes zero provider/repository writes.
- [ ] **Step 2: Verify red** — run the focused Fastify route tests; expected 404/route-not-found or missing-service failures.
- [ ] **Step 3: Move RAG logic without changing algorithms** — preserve RRF, deterministic SQL-price response, provider validation/fingerprint, source freshness, generation checkpoint/resume/publish behavior and existing unit cases.
- [ ] **Step 4: Register RAG routes through auth and service layers** — use bearer-token Supabase clients; preserve owner-only admin, current SQL price reads, no-store responses, and safe client errors.
- [ ] **Step 5: Switch question/admin components to `NEXT_PUBLIC_API_BASE_URL`** — use shared frontend `apiClient`; call preview endpoint rather than importing backend chunker code into browser.
- [ ] **Step 6: Verify green** — run all moved RAG unit tests, route tests, lint, typecheck and build for both workspaces.
- [ ] **Step 7: Commit** — `feat: move RAG API into Fastify backend`.

## Task 4: Đưa catalog reads và ảnh nguồn qua backend

**Files:**
- Create: `backend/src/routes/v1/catalog.routes.ts`, `backend/src/controllers/catalog.controller.ts`, `backend/src/services/catalog.service.ts`, `backend/src/repositories/catalog.repository.ts`, `backend/src/schemas/catalog.schema.ts`.
- Create: `backend/src/routes/v1/source-files.routes.ts`, source-file controller/service/repository and tests.
- Create: `frontend/src/lib/api/catalog.ts`, `frontend/src/lib/api/source-files.ts`.
- Modify: `frontend/src/components/price-app.tsx`, `frontend/src/features/offline/cache.ts` only where response DTO/cache mapping requires.
- Test: backend catalog/source route and repository tests; frontend API mapping tests.

**Interfaces:**
- `GET /api/v1/catalog` returns `{ entries: CatalogEntry[]; prices: CatalogPrice[]; syncedAt: string }` using existing UI fields.
- Repository preserves current active=true, verification_status != sample filters, nested category/product/package/active prices, supplier and source page/file fields, and current result cap until pagination is explicitly implemented and tested.
- `POST /api/v1/source-files/signed-url` body `{ storagePath: string }`; response `{ signedUrl: string; expiresIn: 300 }`; request-scoped Storage client enforces bucket policy.

- [ ] **Step 1: Test catalog mapping** — add cases for empty results, missing nested category/supplier/source joins, inactive prices, sample/inactive variants and rows at the current maximum; assert no price amount transformation.
- [ ] **Step 2: Verify red** — run the focused API tests before adding repository/controller implementations.
- [ ] **Step 3: Implement repository/service/controller** — move the existing Supabase select and DTO mapping server-side; map Supabase errors to safe API codes.
- [ ] **Step 4: Test signed source URL access** — owner/viewer policy respects Supabase Storage RLS; reject blank, malformed, and path traversal-like inputs; never return an unbounded public URL.
- [ ] **Step 5: Switch frontend catalog and source image flow** — retain current IndexedDB snapshot behavior and local static image fallback; online data comes through backend only.
- [ ] **Step 6: Verify green** — run the related workspace tests, lint, typecheck and build.
- [ ] **Step 7: Commit** — `feat: serve catalog and source files through API`.

## Task 5: Chuyển các thao tác ghi giá/catalog sang audited RPC backend

**Files:**
- Create: `backend/src/routes/v1/prices.routes.ts`, `backend/src/controllers/prices.controller.ts`, `backend/src/services/prices.service.ts`, `backend/src/repositories/prices.repository.ts`, `backend/src/schemas/prices.schema.ts`.
- Modify: `frontend/src/components/price-app.tsx`, `frontend/src/features/pricing/validation.ts` only for API response/error mapping.
- Test: service/controller/repository tests for update price, catalog update and undo.

**Interfaces:**
- `POST /api/v1/prices/:priceId/update`: `{ amount: number; expectedVersion: number; reason: string }` → `{ amount: number; version: number; historyId: number }`.
- `POST /api/v1/catalog/update`: validated catalog fields plus `priceId` and `expectedVersion` → updated catalog/price DTO.
- `POST /api/v1/prices/undo`: `{ historyId: number; expectedVersion: number }` → `{ amount: number; version: number }`.

- [ ] **Step 1: Test audited write behavior** — assert each use case calls only `update_price_with_history`, `update_catalog_item`, or `undo_price_change`; assert exact `p_expected_version` forwarding; assert zero writes while request is offline at frontend boundary.
- [ ] **Step 2: Test conflict/error mapping** — RPC `version_conflict` maps to 409 and no optimistic client amount mutation occurs; owner-required maps to 403; duplicate data maps to 409/422 per agreed error contract.
- [ ] **Step 3: Verify red** — run focused price API tests; expected failing assertions for absent endpoints/services.
- [ ] **Step 4: Implement repository and service** — do not add direct table updates; read latest history ID after price RPC under same request token where current UI requires it.
- [ ] **Step 5: Switch UI edit/undo actions** — preserve offline guards, expected-version capture, server-returned amount/version and quote total as selected package count × unchanged amount.
- [ ] **Step 6: Verify green** — price logic/API tests plus lint, typecheck and build.
- [ ] **Step 7: Commit** — `feat: route audited price writes through backend`.

## Task 6: Hoàn tất API client, xóa truy cập dữ liệu từ browser và sửa cấu hình env

**Files:**
- Modify: `frontend/src/lib/api/client.ts`; create generated API client/types under `frontend/src/lib/api/generated/`.
- Create/update: `backend/openapi/openapi.json` generation command and frontend type generation script.
- Modify: all frontend components/services to remove Supabase `.from()`, `.rpc()`, and `.storage` calls; keep only `.auth` operations.
- Modify: root `.env.example`, `frontend/.env.example`, `backend/.env.example`, `.gitignore`; update `.env.local` handling without printing or committing values.
- Test: `frontend/src/lib/api/client.test.ts`; API contract generation test.

**Interfaces:**
- `apiRequest<T>(path: string, init?: RequestInit): Promise<T>` obtains the current Supabase access token, sets bearer/content headers, uses `cache: "no-store"`, and maps typed OpenAPI responses/errors (401/403/409/422/503) safely. Generated OpenAPI types are the frontend contract; Fastify validates request/response schemas.
- Frontend env: `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- Backend env: `API_PORT`, `FRONTEND_ORIGINS`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, existing RAG provider/model/base URL/API key values.

- [ ] **Step 1: Test API client** — assert bearer token is attached, refresh/missing session behavior is explicit, error codes map to readable Vietnamese messages, and token/body are not logged.
- [ ] **Step 2: Generate OpenAPI/client contract** — Fastify route schemas use Zod 4 provider compatible with installed Zod; add `openapi:generate` and `api:types` scripts; fail generation if checked-in output is stale.
- [ ] **Step 3: Replace all direct data access** — search `frontend/src` for `.from(`, `.rpc(`, `.storage`; only Supabase `.auth` calls may remain.
- [ ] **Step 4: Split local environment files safely** — derive frontend/backend examples from existing names; copy actual local values programmatically to ignored per-workspace files without displaying values; retain previous root file until both apps boot.
- [ ] **Step 5: Verify green** — run generated contract check, frontend/backend unit tests, lint, typecheck and build; inspect logs/output to ensure no secret values were printed.
- [ ] **Step 6: Commit** — `refactor: route frontend data access through typed API client`.

## Task 7: Root orchestration, integration/E2E, CI and runbooks

**Files:**
- Modify: root `package.json`, root `package-lock.json`, `frontend/package.json`, `backend/package.json`, `frontend/playwright.config.ts`.
- Create: root `.github/workflows/ci.yml`, `docs/architecture.md` updates and workspace runbook.
- Modify: root `README.md`, `RAG_SETUP.md`, `.gitignore`; remove obsolete frontend `/api/rag/*` routes after cutover.
- Test: root workspace smoke script if needed; Playwright integration spec for frontend + backend.

**Interfaces:**
- Root `npm run dev` starts frontend on `3000` and backend on `4000`, stops both when either exits, and propagates failure status.
- Root `npm run lint|typecheck|test|build` runs the corresponding checks in both workspaces.
- Playwright starts API then frontend, uses an isolated test account/project configured only through CI secrets, and never prints credentials.

- [ ] **Step 1: Test root orchestration** — verify both health endpoints are reachable from one root dev command and child process shutdown leaves no listener.
- [ ] **Step 1a: Add root process runner** — add `concurrently` as a root development dependency and configure `dev` to stop both workspaces if either process exits; preserve independent workspace commands.
- [ ] **Step 2: Test CORS and request ID** — allowed frontend origin passes preflight; unknown origin is denied; each backend error response has a request ID without exposing provider/auth secrets.
- [ ] **Step 3: Add integration/E2E coverage** — login/session restore, owner admin gate, employee catalog read, price edit conflict, quote total invariant, RAG query, and offline read-only. Use test environment credentials, not the production owner account.
- [ ] **Step 4: Remove legacy Next API routes and direct browser data clients** — only after API parity and E2E checks pass; preserve rollback tag/commit and document reversion command.
- [ ] **Step 5: Update CI and docs** — separate frontend/backend lint/typecheck/test/build jobs; document local env split, one-command dev, individual commands, CORS, independent deploy, health and auth troubleshooting.
- [ ] **Step 6: Final verification** — run root lint/typecheck/test/build, Playwright desktop/mobile, OpenAPI drift check, `git diff --check`, and scan browser bundles/logs for secrets.
- [ ] **Step 7: Commit** — `chore: verify and document split frontend backend workspace`.

## Plan self-review

- **Spec coverage:** Sections 1–3 are Tasks 1–6; request/auth/error/CORS flow is Task 2; API groups are Tasks 3–5; run/config is Tasks 1/6/7; rollback is Tasks 3–7; acceptance and runbook/CI are Task 7; non-goals/global business constraints appear in every relevant task.
- **Step scan:** Every code task has a named test, a focused red command, implementation boundary, green verification and commit. Task 1 is a relocation/refactor and is guarded by baseline-vs-workspace parity rather than a new implementation-mirroring test.
- **Type consistency:** `CatalogEntry`, `CatalogPrice`, `AppRole`, `apiRequest`, and write response names are defined in their owning task before later tasks consume them; OpenAPI is generated from backend Zod schemas.
- **Review focus coverage:** token/role/CORS cases are Task 2/7; price/version/offline cases Task 5/7; catalog and Storage cases Task 4; provider/corpus/chunk cases Task 3/7.
- **Proportion:** Seven tasks group changes by independently testable boundary; no database schema migration or hosting vendor is added without a requirement.
