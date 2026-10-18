# Demo Price Backfill Implementation Plan

> Status: Complete. The owner-only in-app workflow is implemented, tested, and its migrations are applied to the linked Supabase project App Price. No CLI was added for price creation.

**Goal:** Fill eligible variants that have no current real price with visibly labeled demo prices that cannot be used for orders.

**Design:** Keep demo prices marked as sample/demo in a dedicated price list. Generate deterministic prices from current same-group/package retail references, using a documented fallback only when no reference exists. Do not use the LLM to invent prices. Provide owner-only preview, apply, retry, and rollback through `/staff/prices`; apply in batches of at most 100 after a locked snapshot recheck.

## Completed work

- Added migration `supabase/migrations/202610190001_demo_price_backfill.sql` for demo-price storage, audit batches, owner-only preview/apply/rollback RPCs, stale-preview checks, idempotency, and bounded batch results.
- Added read-contract changes so valid demo prices can appear in staff/public catalog and RAG output with `isDemo` and `purchasable` metadata. A real current price takes precedence; legacy samples without the demo marker stay hidden.
- Added UI controls on `/staff/prices`, explicit demo labels in storefront/RAG/staff views, and guards preventing demo prices from entering customer or staff order flows.
- Added unit, API/repository, SQL regression, and Playwright coverage. Added `docs/DEMO_PRICE_BACKFILL.md` with the test-database runbook.
- Generated and checked OpenAPI artifacts.
- Applied the required remote migrations to App Price. This also applied the two earlier pending migrations identified by CLI dry-run; `202610180012` removed 13 rows from the retired OCR table before dropping it.
- Verified that all four migration records and the demo RPCs exist remotely. No demo-price rows have been created.

## Safety and behavior

- Create a price only for an active, verified variant with a valid smallest package and no current real price.
- Generate retail prices only; keep the amount in VND and the minimum quantity at one package.
- Never change a real price to manufacture a demo amount. A later valid real price hides the demo price.
- Label demo amounts as simulated in all customer-facing displays and RAG responses. Never offer an order action for them; server-side order validation also rejects demo prices.
- Restrict mutation RPCs to owners, write audit history, recheck the snapshot before apply, cap each batch at 100 rows, and refuse rollback if a price changed or was used.
- Migration deployment adds schema and read behavior; actual demo prices are created only after an owner reviews and applies a preview batch.

## Verification

See `docs/reports/2026-10-19-demo-price-backfill-validation.md` for test results and remote deployment details. The focused demo-price E2E suite passed on desktop and mobile; the full legacy E2E suite still has unrelated POS/layout failures documented in the report.
