# Demo Price Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tự động bổ sung giá giả cho quy cách thiếu giá và hiển thị có nhãn ngay trong app hiện tại.

**Architecture:** Bảng giá demo riêng trong SQL; công cụ preview/apply có audit và chống chạy trùng. Catalog/RAG truyền nguồn gốc giá tới UI; luồng giao dịch thật tiếp tục loại giá mẫu. Thuật toán xác định, không gọi LLM để sinh giá.

**Tech Stack:** TypeScript, Fastify, Supabase/PostgreSQL RPC/RLS, Next.js, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-19-demo-price-backfill-design.md`

**Status:** Bản kế hoạch đề xuất theo lựa chọn hiển thị ngay trong app. Chưa triển khai, chưa kiểm kê database và chưa nhập giá. Việc viết kế hoạch không cho phép chạy apply trong lượt này.
> Implementation update (2026-10-19): The feature is implemented in the current workspace through owner-only preview/apply/rollback controls on `/staff/prices` (the shipped interface replaces the planned CLI). Backend and frontend typechecks pass. No automated tests were run and no Supabase migration or demo rows have been applied; use a test database for the test steps.

## Global Constraints

- Giá demo luôn có `is_sample=true, is_demo=true`.
- Chỉ bổ sung khi quy cách không có bất kỳ giá thật hiện hành hợp lệ nào.
- Mỗi quy cách đủ điều kiện tạo một giá retail, minimum_quantity=1, VND, trên đóng gói nhỏ nhất đang có.
- Không tự tạo giá sỉ/đại lý, chiết khấu, tồn kho hoặc gói hàng giả.
- Contract giá có `isDemo: boolean`, `purchasable: boolean`; demo luôn purchasable=false.
- Không sửa migration đã áp dụng. Mọi ghi giá qua RPC có audit và expected_version.
- Giữ nguyên `prices.amount` khi hiển thị/tính tiền. Không cập nhật source giá thật để sinh số giả.
- Không thêm secret vào mã, manifest, report hoặc log. Không triển khai thay đổi RAG ngoài phạm vi giá demo.

## Review Focus

- Giá bằng 0 hoặc giá chỉ hết hạn/tương lai: phân loại chính xác, không tự sửa (Task 1).
- Nhân viên nhập giá thật trong khi apply: kiểm tra lại dưới khóa, abort lô khi snapshot đổi (Task 2).
- Một sample cũ bị lộ qua public RPC hoặc nhân viên: chỉ sample có is_demo được đọc (Task 3).
- Giá demo bị đưa trực tiếp vào đơn hàng hoặc khôi phục từ cache: server từ chối, UI vẫn giữ nhãn (Task 4).
- Giá mới được sửa sau khi seed, hoặc crash giữa các lô: retry không trùng, rollback không đè sửa đổi (Task 2 và 5).

## Task 1: Kiểm kê và tạo preview xác định

**Files:** Create `backend/src/demo-prices/types.ts`, `backend/src/demo-prices/preview.ts`, `backend/src/demo-prices/preview.test.ts`, `backend/src/demo-prices/repository.ts`, `backend/src/demo-prices/cli.ts`; modify `backend/package.json`.

**Interfaces:**
- `loadDemoPriceSnapshot(client: SupabaseClient, asOf: string): Promise<DemoPriceSnapshot>`: đọc phân trang toàn bộ catalog cần thiết dưới quyền owner, cả hàng thiếu giá.
- `buildDemoPricePreview(snapshot: DemoPriceSnapshot, rules: DemoPriceRules): DemoPriceManifest` là hàm thuần.
- Snapshot chứa asOf và các ID, trạng thái, version, amount, hiệu lực, gói, product/category, supplier và cờ sample/demo. Rules chứa version, fallbackAmount=50000 và bảng override category/unit/quantity.
- Manifest chứa batchId, snapshotHash, ruleVersion, asOf, proposedRows và skippedRows. Proposed row chứa variantId, packagingId, amount, tier=retail, minimumQuantity=1, currency=VND, expectedVersion=0, inputHash, method và referencePriceIds. Skipped row chứa variantId và reason.

- [ ] Viết test `keeps_existing_zero_price`, `classifies_expired_future_and_inactive_supplier`, `skips_unverified_or_inactive`, `chooses_smallest_same_unit_package`, `reports_missing_or_mixed_units`, `uses_only_real_same_package_references`, `generates_stable_rounded_amount`. Assert fallback ID=10 cho 50.000 VND, ID=0 cho 45.000 VND; giá nguồn không đổi; tier luôn retail.
- [ ] Chạy `npm --prefix backend test -- src/demo-prices/preview.test.ts`; xác nhận test mới thất bại do chưa có chức năng.
- [ ] Implement interfaces và công thức trong spec; pagination có order ID ổn định, số tiền phải hữu hạn và dương. Hash snapshot theo JSON canonical, ID tăng dần; batchId gắn với hash + ruleVersion.
- [ ] Thêm lệnh `demo-prices` chạy `node --env-file-if-exists=.env.local --import tsx src/demo-prices/cli.ts`; subcommand `preview --out <path>` chỉ xuất JSON/CSV, không ghi DB. CLI dùng phiên owner cấu hình ngoài repo, không in token.
- [ ] Chạy lại test; fixture có 1 hàng có giá, 1 hàng thiếu giá có gói, 1 hàng thiếu gói phải cho đúng một proposal và hai lý do loại riêng biệt.

## Task 2: RPC ghi theo lô, lịch sử và hoàn tác

**Files:** Create `supabase/migrations/202610190001_demo_price_backfill.sql`, `supabase/tests/demo_price_backfill.sql`, `backend/src/demo-prices/apply.ts`, `backend/src/demo-prices/apply.test.ts`; modify CLI/repository từ Task 1. Kiểm tra tên migration chưa tồn tại trước khi tạo.

**Interfaces:**
- `applyDemoPriceManifest(client, manifest): Promise<DemoPriceApplyReport>` trả batchId, created IDs/versions, resumed rows và conflicts.
- RPC `apply_demo_price_batch(p_batch_id text, p_rows jsonb, p_reason text)`; mỗi row theo manifest, tối đa 100. Owner only; expected_version=0 là precondition tạo mới.
- RPC `deactivate_demo_price_batch(p_batch_id text, p_expected_versions jsonb, p_reason text)` ngừng hiệu lực và audit, không xóa.
- Bổ sung `price_lists.is_demo` với check constraint; bảng `demo_price_batches` và `demo_price_batch_items` lưu key/hash/price IDs/versions/method phục vụ retry và provenance, bật RLS owner-only. RPC dùng fixed search_path và quyền execute rõ ràng.

- [ ] Viết SQL test cho quyền owner, sample/demo constraint, không ghi đè giá thật, snapshot đổi, amount không hữu hạn/âm, gói không thuộc variant, expected_version khác 0, duplicate batch, cùng key khác payload và rollback conflict.
- [ ] Chạy test SQL trên DB local bằng `psql "$env:LOCAL_TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/demo_price_backfill.sql`; database URL này chỉ trỏ local test. Xác nhận test thất bại trước migration.
- [ ] Implement migration: khóa variant theo ID tăng dần; kiểm tra lại active/verified, package, supplier/price validity tại thời gian server và fingerprint. Các writer giá thật cập nhật vẫn được đọc lại; nếu race tạo giá thật sau commit, ưu tiên giá thật ở lớp đọc (Task 3). Tạo bảng giá demo có supplier riêng có nhãn demo; ghi price_history operation=create và actor thật. Một lô atomic, batch/item unique ngăn trùng.
- [ ] Implement apply chia lô 100 và báo cáo lô đã commit; retry đối chiếu hash trước khi trả lại IDs cũ. Rollback kiểm tra từng version và mọi tham chiếu giao dịch trước khi ngừng hiệu lực, báo conflict không thay hàng đó.
- [ ] Áp dụng migration chỉ local; chạy lại SQL tests và `npm --prefix backend test -- src/demo-prices/apply.test.ts` cho retry sau mất kết nối và hồi phục batch dở.

## Task 3: Catalog và RAG đọc giá demo có nguồn gốc

**Files:** Create `backend/src/demo-prices/visibility.ts`, `backend/src/demo-prices/visibility.test.ts`, `supabase/migrations/202610190002_demo_price_read_contract.sql`, `supabase/tests/demo_price_visibility.sql`; modify `backend/src/repositories/catalog.repository.ts`, `backend/src/repositories/rag-catalog.repository.ts`, `backend/src/schemas/catalog.schema.ts`, `backend/src/services/rag-query.service.ts`, `backend/src/rag/evidence.ts`, `backend/src/rag/price-answer.ts`, `backend/src/openapi/contract.ts` và tests tương ứng.

**Interfaces:**
- Mọi price DTO thêm required `isDemo:boolean`, `purchasable:boolean`.
- `selectVisiblePrices(rows, asOf): PriceRow[]`: lọc hiệu lực/supplier; loại sample không demo; nếu variant có giá thật hợp lệ thì loại demo của variant đó, trước bộ lọc tier theo câu hỏi.
- SQL public/staff trả cùng quy tắc và metadata. Danh sách hàm phải cập nhật trong migration mới: `get_public_customer_catalog`, `search_catalog`, `search_public_rag_catalog`, `get_public_rag_catalog`, `list_public_rag_catalog_page`, `list_staff_rag_catalog_page`. Giữ nguyên phân quyền và đầy đủ dữ liệu/count của từng hàm.

- [ ] Viết tests visibility/evidence/RAG: sample cũ bị loại; demo được hiển thị có nhãn; amount giữ nguyên; giá thật mới loại demo; hết hạn và supplier inactive không lọt; count và list nhất quán; không gắn nguồn tài liệu thật cho giá demo.
- [ ] Chạy unit tests liên quan và SQL visibility test local, xác nhận fail trước thay đổi.
- [ ] Implement helper, RPC migration và toàn bộ nhánh giá trong service (list, reference, lookup, comparison). Evidence phân biệt giá synthetic với fact verified; không thay đổi fact về sản phẩm. `price-answer` thêm câu nhãn do app tạo, không dựa vào LLM.
- [ ] Đồng bộ schemas/OpenAPI bằng `npm --prefix backend run api:types`; không sửa tay `frontend/src/lib/api/generated/api-types.ts`. Sửa mapping public catalog/customer orders nếu contract đọc catalog nằm ở repository đó; giữ nguyên RPC ghi đơn loại sample.
- [ ] Chạy lại tests và `npm --prefix backend run openapi:check`; kiểm tra cả đọc catalog nhân viên trực tiếp và public RPC.

## Task 4: Nhãn UI và ngăn giao dịch thật dùng giá demo

**Files:** Create `frontend/src/components/demo-price-label.tsx` và test tương ứng; modify `frontend/src/components/customer-storefront.tsx`, `frontend/src/components/price-question-assistant.tsx`, `frontend/src/components/staff-price-management.tsx`, `frontend/src/components/price-app.tsx`, `frontend/src/components/customer-cart-panel.tsx`, `frontend/src/components/staff-customer-order-form.tsx` và nơi mapping/cache CatalogPrice bị typecheck chỉ ra; tests API tại `backend/src/routes/v1/customer-orders.routes.test.ts`, SQL ACL/order tests hiện có.

**Interfaces:** `DemoPriceLabel({isDemo:boolean})` hiển thị đúng copy của spec; hành động mua dựa trên purchasable từ server, không suy luận bằng tên bảng giá. Dòng demo không cho sửa thành giá thật bằng chỉnh amount; nhập giá chính thức qua luồng giá thật riêng.

- [ ] Viết test label trên catalog/chat/staff, cache roundtrip giữ nguồn gốc, và request API tự tạo chứa price ID demo bị từ chối. Thử cả request hỗn hợp giá thật + demo.
- [ ] Chạy test mới để xác nhận fail; implement nhãn và thông báo `Chưa có giá bán chính thức` tại vị trí hành động mua của demo. Giữ hiển thị toàn bộ giá thật và hành động mua cũ của chúng.
- [ ] Kiểm tra mọi luồng báo giá/hóa đơn/order dùng CatalogPrice hoặc price ID trong repo; thêm guard server/RPC nếu đường nào chưa loại sample, bổ sung regression test tại chính đường đó. Không coi disable nút là đủ.
- [ ] Chạy tests liên quan; kiểm tra desktop/mobile, danh sách có cả giá thật/demo, chatbot một hàng và nhiều hàng, offline cache. Không để badge verified của sản phẩm che nguồn gốc giá demo.

## Task 5: Kiểm thử đầu cuối và runbook nhập dữ liệu

**Files:** Create `docs/reports/2026-10-19-demo-price-backfill-validation.md`, `docs/DEMO_PRICE_BACKFILL.md`, `frontend/tests/demo-price-backfill.spec.ts`; modify CLI thêm `apply --manifest <path>` và `rollback --batch <id>`.

- [ ] Viết E2E fixture gồm hàng có giá thật, hàng thiếu giá có gói, sample cũ, hàng thiếu gói và giá demo đã bị sửa. Assert preview/apply/retry, nhãn chat/catalog, từ chối mua, nhập giá thật làm demo biến mất và rollback báo conflict đúng.
- [ ] Chạy unit/SQL fixture local từ snapshot giả lập; đối chiếu số lượng eligible/proposed/created/skipped/conflict và hash dữ liệu thật trước/sau. Browser test mock dùng cấu hình test hiện có; E2E kết nối thật phải dùng Supabase test project riêng theo guard của `frontend/playwright.config.ts`, không dùng database hiện tại của người dùng và không bỏ guard để chạy local.
- [ ] Chạy `npm --prefix backend run lint`, `typecheck`, `test`, `build`, `openapi:check`; tương tự `npm --prefix frontend run lint`, `typecheck`, `test`, `build`, `test:e2e`. Ghi rõ blocker môi trường nếu có, không coi chưa chạy là đạt.
- [ ] Viết runbook: preview từ môi trường đích -> xem JSON/CSV -> apply theo batch -> xác nhận API/chat/UI -> lưu báo cáo -> rollback theo batch/version nếu cần. Báo cáo không chứa credential hoặc thông tin khách hàng.
- [ ] Chỉ khi chuyển sang giai đoạn triển khai dữ liệu mới chạy preview trên môi trường thực; trình bày số lượng và manifest cụ thể trước apply. Lượt brainstorming/planning này dừng ở tài liệu.

## Self-review

Thiết kế đã phủ: không đè giá thật, phạm vi variant thiếu giá, package/unit, số 0, sample cũ, label xuyên suốt, race/retry/rollback, RAG không bịa nguồn, cache và kiểm tra server. Không đổi model/embedding hay tái cấu trúc hội thoại. Chưa có số lượng thiếu giá hoặc kết quả test thực; mọi tên file mới ở trên là kế hoạch, không phải chức năng đã tồn tại.
