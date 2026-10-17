# Staff Price and Catalog Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Work sequentially in the current repository and preserve unrelated working-tree changes.

**Goal:** Give staff a dedicated price and catalog maintenance screen that uses verified catalog data, displays packaging and minimum-order units accurately, and distinguishes loading, cached, failed, and genuinely empty results.

**Architecture:** Add a focused `/staff/prices` route and screen that reuse the existing catalog and price APIs. Keep `prices.amount` as the authoritative value, use the existing versioned/audited write path, and centralize package/minimum quantity presentation so it does not depend on product-specific rules.

**Tech Stack:** Next.js App Router, React, TypeScript, Flowbite React, existing backend REST APIs, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-staff-price-and-catalog-operations-design.md`

## Global constraints

- SQL `prices.amount` remains the sole source of truth for current prices; do not derive or rewrite amounts in the UI.
- Preserve existing owner/editor/viewer permissions, RLS, audit records, and optimistic concurrency through `expectedVersion`.
- Do not add offline price writes. Cached data may be shown only with a clear stale/offline state.
- Keep catalog search and price editing on existing API contracts unless a tested gap requires a narrowly scoped change.
- Do not run migrations, seed, reindex, or write to a remote database. Any SQL verification must use an isolated local database.

## Review focus

1. Confirm minimum quantity is labeled with its actual unit and is not confused with package contents.
2. Confirm package names and counts come from catalog data rather than product-specific hard-coded mappings.
3. Confirm stale cached results, request errors, no catalog data, and no filtered matches have distinct messages.
4. Confirm edits submit the selected price ID and current `expectedVersion`, preserving audit and conflict handling.
5. Confirm viewers and unauthenticated users cannot reach or invoke write operations.

## Task 1: Centralize package and minimum-quantity display

**Files:** Create `frontend/src/features/pricing/package-display.ts`; create `frontend/src/features/pricing/package-display.test.ts`; inspect/reuse `frontend/src/features/pricing/validation.ts`.

1. Add failing tests for a price per item, a price per package with known package quantity, a minimum quantity using a different unit, and missing packaging metadata.
2. Implement a pure formatter that renders only supplied catalog facts. It must not infer a package count, convert units, or calculate a new price.
3. Ensure absent metadata produces a neutral omission or explicit unknown label instead of a guessed value.
4. Run `npm.cmd run test --workspace @price-app/frontend -- package-display`.

## Task 2: Add the dedicated staff price screen

**Files:** Create `frontend/src/app/staff/prices/page.tsx`; create `frontend/src/components/staff-price-management.tsx`; modify `frontend/src/components/price-app.tsx`; reuse `frontend/src/lib/api/catalog.ts` and existing price API modules.

1. Add a failing component/browser test showing staff can search by name, alias, SKU, or specification and select the exact catalog/price record.
2. Implement `/staff/prices` with the shared catalog search, selected item details, current verified prices, and the existing edit action.
3. Route the current “Cập nhật & sửa giá” entry point to the dedicated screen while preserving other staff navigation and RAG access.
4. Keep update requests on the existing versioned price API and display conflicts without silently overwriting a newer price.
5. Run focused frontend unit and browser tests for staff catalog search and price selection.

## Task 3: Make data states explicit and preserve access controls

**Files:** `frontend/src/components/staff-price-management.tsx`; `frontend/src/lib/api/catalog.ts`; focused tests in `frontend/tests/staff-price-management.spec.ts`; existing API tests in `backend/src/routes/v1/prices.routes.test.ts` and `backend/src/repositories/catalog.repository.test.ts`.

1. Add failing tests for loading, request failure with cached data, request failure without cache, a truly empty catalog, and a search with no matches.
2. Implement separate messages/actions for each state. Never present cached data as freshly loaded.
3. Verify role-gated writes remain owner/editor only and catalog reads preserve the current staff authentication contract. Add a regression test only if an existing contract is not covered.
4. Confirm no new endpoint bypasses the current permission checks or RLS.
5. Run the focused API/unit tests and `npm.cmd run check`.

## Task 4: Browser verification and completion

**Files:** `frontend/tests/staff-price-management.spec.ts`; implementation files from Tasks 1–3.

1. Verify the screen at desktop and narrow mobile widths, including long product names and package descriptions.
2. Verify selecting a result, editing a price, receiving a version conflict, and navigating back to staff tools.
3. Run the relevant Playwright tests and `npm.cmd run check`.
4. Run `git diff --check`; inspect the diff to confirm the change is limited to staff price/catalog operations.
5. Commit only this plan's implementation files when executing the plan; leave unrelated working-tree changes untouched.
