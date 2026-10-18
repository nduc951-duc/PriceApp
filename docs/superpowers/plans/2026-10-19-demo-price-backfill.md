# Demo Price Backfill Implementation Plan

> Status: Complete in the current workspace. This plan records the implemented owner-only in-app workflow; no CLI was added.

**Goal:** Fill eligible variants that have no current real price with visibly labeled demo prices that cannot be used for orders.

**Design:** Keep demo prices marked as sample/demo in a dedicated price list. Generate deterministic prices from current same-group/package retail references, using a documented fallback only when no reference exists. Do not use the LLM to invent prices. Provide owner-only preview, apply, retry, and rollback through `/staff/prices`; apply in batches of at most 100 after a locked snapshot recheck.

## Completed work

- Added migration `supabase/migrations/202610190001_demo_price_backfill.sql` for demo-price storage, audit batches, owner-only preview/apply/rollback RPCs, stale-preview checks, idempotency, and bounded batch results.
- Added read-contract changes so valid demo prices can appear in staff/public catalog and RAG output with `isDemo` and `purchasable` metadata. A real current price takes precedence; legacy samples without the demo marker stay hidden.
- Added UI controls on `/staff/prices`, explicit demo labels in storefront/RAG/staff views, and guards preventing demo prices from entering customer or staff order flows.
- Added unit, API/repository, SQL regression, and Playwright coverage. Added `docs/DEMO_PRICE_BACKFILL.md` with the test-database runbook.
- Generated and checked OpenAPI artifacts.

## Safety and behavior

- Create a price only for an active, verified variant with a valid smallest package and no current real price.
- Generate retail prices only; keep the amount in VND and the minimum quantity at one package.
- Never change a real price to manufacture a demo amount. A later valid real price hides the demo price.
- Label demo amounts as simulated in all customer-facing displays and RAG responses. Never offer an order action for them; server-side order validation also rejects demo prices.
- Restrict mutation RPCs to owners, write audit history, recheck the snapshot before apply, cap each batch at 100 rows, and refuse rollback if a price changed or was used.
- Run migrations and SQL tests only against a dedicated test database. No production migration or demo-price apply was performed during this task.

## Verification

See `docs/reports/2026-10-19-demo-price-backfill-validation.md` for commands and outcomes. The focused demo-price E2E suite passed on desktop and mobile. The full legacy E2E suite still has unrelated POS/layout failures documented in the report.
