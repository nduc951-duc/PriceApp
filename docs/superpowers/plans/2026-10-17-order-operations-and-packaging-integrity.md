# Vận hành đơn khách và tính đúng bao bì — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Keep each task independently reviewable and testable.

**Goal:** Khách gửi được một yêu cầu mua có snapshot giá/bao bì đúng và nhân viên xử lý được yêu cầu đó theo trạng thái backend cho phép.

**Architecture:** Giữ API/RPC hiện tại làm nguồn quyết định giá và trạng thái. Bổ sung idempotency bền cho public checkout, hoàn thiện hợp đồng snapshot bao bì và làm cho UI khách/nhân viên trình bày lỗi, đơn vị, retry theo cùng hợp đồng.

**Tech Stack:** TypeScript, Fastify, Zod, Supabase/PostgreSQL migrations và RLS, Next.js/React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-order-operations-and-packaging-integrity-design.md`

## Global Constraints

- `public.prices.amount` là authoritative; không chia, quy đổi hoặc thay giá gốc.
- Server xác minh lại giá/phiên bản/điều kiện bán; client không tự quyết định tổng cuối.
- Không cấp thêm quyền; public không được đọc/sửa đơn; employee inbox tiếp tục yêu cầu xác thực và role hiện có.
- Đơn là yêu cầu chờ cửa hàng xác nhận; không thu tiền, không chốt phí giao, không trừ tồn kho.
- Chỉ chạy migration/SQL regression trên Supabase local hoặc database cô lập; không kết nối production, không seed/reindex giá thật.
- Không chạy `supabase db reset`; nếu cần database mới, dừng và giải thích rõ thao tác reset trước.

## Review Focus

- Checkout đã commit nhưng response bị mất: cùng khóa/payload phải trả đúng biên nhận cũ, không tạo đơn thứ hai. (Task 1)
- Cùng idempotency key nhưng khác nội dung giỏ/liên hệ phải bị từ chối, không trả biên nhận sai. (Task 1)
- Giá đổi/hết hạn/biến thể bị bỏ duyệt trong lúc checkout phải chặn ghi đơn và giữ dữ liệu form. (Task 1, Task 2)
- Bao bì thiếu hoặc tên bao bì khác `gói` phải được hiển thị đúng; không suy nhãn từ tên hàng. (Task 2)
- Lỗi tải inbox phải khác với danh sách rỗng và không xác nhận trạng thái khi server chưa thành công. (Task 3)

---

### Task 1: Idempotency bền cho yêu cầu đặt hàng công khai

**Files:**
- Create: `supabase/migrations/202610180007_customer_order_idempotency.sql`
- Create: `supabase/tests/customer_order_idempotency.sql`
- Modify: `backend/src/schemas/customer-orders.schema.ts`
- Modify: `backend/src/controllers/customer-orders.controller.ts`
- Modify: `backend/src/repositories/customer-orders.repository.ts`
- Modify: `backend/src/openapi/contract.ts` and generated OpenAPI/type artifacts
- Test: `backend/src/repositories/customer-orders.repository.test.ts`
- Test: `backend/src/routes/v1/customer-orders.routes.test.ts`

**Interfaces:**
- Consumes: current `CustomerOrderInput`, `CustomerOrderSubmissionProof`, and `create_customer_order_request` RPC.
- Produces: request field `idempotencyKey: string` validated as UUID; repository submission returns the same `CustomerOrderReceipt` for same key and canonical payload; key reuse with a different payload maps to a conflict.

- [ ] **Step 1: Add failing repository and route tests** for first submit, retry after simulated committed response loss, and same key with changed payload.
- [ ] **Step 2: Run the focused tests and confirm failure.**

Run: `npm.cmd test --workspace @price-app/backend -- src/repositories/customer-orders.repository.test.ts src/routes/v1/customer-orders.routes.test.ts`

Expected: retry is not yet replayed as the original receipt and the body does not yet validate the idempotency key.

- [ ] **Step 3: Add failing SQL regression cases** proving one stored order per idempotency key, receipt replay for the same payload, rejection for a different payload, and independent keys for separate submissions.
- [ ] **Step 4: Run only the SQL regression on the isolated local database and confirm failure.**

Run: `npx.cmd supabase test db supabase/tests/customer_order_idempotency.sql --local`

Expected: the new RPC/storage contract is absent. Do not reset the local database.

- [ ] **Step 5: Implement the additive migration and API contract.** Persist a unique checkout key, a keyed fingerprint of the normalized payload, and the created request ID atomically with order creation; retain the key for at least 24 hours. Same key/same fingerprint returns the saved receipt; same key/different fingerprint returns conflict. Keep nonce/HMAC verification and all current price/role checks.
- [ ] **Step 6: Run focused API and isolated SQL tests; confirm all cases pass.** Regenerate OpenAPI/types only with the repository generator and run `npm.cmd run openapi:check`.
- [ ] **Step 7: Commit only Task 1 files.**

### Task 2: Đúng đơn vị bán, kiểm tra checkout và giữ giỏ khi lỗi

**Files:**
- Modify: `frontend/src/features/orders/customer-cart.ts`
- Modify: `frontend/src/features/orders/customer-cart.test.ts`
- Modify: `frontend/src/components/customer-cart-panel.tsx`
- Modify: `frontend/src/components/customer-storefront.tsx`
- Modify: `frontend/src/lib/api/customer-orders.ts` and generated API types as required
- Modify: `backend/src/schemas/customer-orders.schema.ts`, `backend/src/repositories/customer-orders.repository.ts`, and order response contract if the snapshot lacks package quantity
- Test: `frontend/tests/customer-order.spec.ts`

**Interfaces:**
- Consumes: catalog fields `packaging`, `packageQuantity`, `unit`, `priceId`, `version`, `minimumQuantity`, and Task 1's `idempotencyKey` contract.
- Produces: checkout summary rows that keep selling-package quantity separate from contained base quantity; error responses leave cart/contact draft intact.

- [ ] **Step 1: Add failing cart/component tests** for `bịch`, `hộp`, and `cuộn`; correct line total; threshold labels in selling packages; missing package label; 10,000/10,001 quantity and 50/51 lines; stale price conflict preserving the form.
- [ ] **Step 2: Run `npm.cmd test --workspace @price-app/frontend -- src/features/orders/customer-cart.test.ts` and the focused Playwright test; confirm the new cases fail.**
- [ ] **Step 3: Implement shared display/validation helpers** so no component hardcodes `/gói`; render package name and contained quantity from catalog/snapshot fields. Keep quantity in the server's sales unit and total as package count × unchanged price.
- [ ] **Step 4: Implement checkout key lifecycle.** Create one key when the customer begins submission, reuse it for retries with unchanged payload, rotate it only after payload edits or a new checkout, and clear it only after a confirmed receipt.
- [ ] **Step 5: Run unit and browser tests; confirm package labels, exact limits, price conflict review and retry behavior pass.**
- [ ] **Step 6: Commit only Task 2 files.**

### Task 3: Hoàn thiện hộp thư và chi tiết đơn cho nhân viên

**Files:**
- Modify: `backend/src/repositories/customer-orders.repository.ts`
- Modify: `backend/src/schemas/customer-orders.schema.ts` and API contract/types if needed
- Modify: `frontend/src/components/customer-order-inbox.tsx`
- Test: `backend/src/repositories/customer-orders.repository.test.ts`
- Test: `backend/src/routes/v1/customer-orders.routes.test.ts`
- Test: `frontend/tests/customer-order.spec.ts`

**Interfaces:**
- Consumes: `CustomerOrderRequest` and immutable item snapshots; statuses `pending_confirmation | contacted | confirmed | cancelled`.
- Produces: inbox views with loading/error/empty/success states and actions reflecting only a server-confirmed transition.

- [ ] **Step 1: Add failing tests** for snapshot package quantity/unit display, API failure vs empty list, legal/illegal status transitions, retry, and unauthorized role denial.
- [ ] **Step 2: Run focused backend/browser tests and confirm the new assertions fail.**
- [ ] **Step 3: Extend the staff response only with fields already stored in the order snapshot** (including package quantity if needed); do not recalculate historical prices from current catalog.
- [ ] **Step 4: Implement distinct inbox loading/error/empty/success states, row-level retry, detail presentation and pending-action feedback.** Keep status authority in the RPC.
- [ ] **Step 5: Run focused repository/route tests and `npm.cmd run test:e2e --workspace @price-app/frontend -- tests/customer-order.spec.ts`; confirm all pass on local fixtures.**
- [ ] **Step 6: Run `npm.cmd run check`, `git diff --check`, and the SQL regression on the isolated database; inspect that only intended files are staged.**
- [ ] **Step 7: Commit Task 3 files and report whether SQL ran on local or was blocked.**

## Plan Acceptance

- Every acceptance criterion in the order/packaging spec maps to a task above.
- Repeated submission, price races, package labels, boundary limits, staff status changes and role boundaries have explicit regression tests.
- Full end-to-end evidence is local/isolated only; no production database is part of this plan.
