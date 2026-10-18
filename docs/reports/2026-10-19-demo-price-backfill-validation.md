# Demo Price Backfill Validation — 2026-10-19

## Result

The demo-price backfill feature is implemented, tested, and its schema/read-contract migrations are applied to the linked Supabase project **App Price**. No demo prices have been created; the remote database currently has zero rows in demo price lists.

## Checks

- `npm run check` — passed: lint, typecheck, unit tests, OpenAPI consistency check, and production builds. Unit totals: frontend 84/84, backend 357/357, dev runner 2/2.
- `npm run test:e2e --workspace @price-app/frontend -- --workers=1 tests/customer-order.spec.ts tests/customer-rag-query.spec.ts tests/staff-price-management.spec.ts` — passed, 58/58 across Chromium and mobile. Covers demo labels, refusal to add demo prices to orders, RAG display, and owner preview/apply/rollback UI.
- `supabase/tests/demo_price_backfill.sql` — passed against an isolated local Supabase database. Exercises owner-only access, sample/demo rules, max-100 batching, stale snapshot rejection, retry, next-batch preview, real-price precedence, rollback, and version conflicts. The SQL test rolls back its fixtures.
- Full browser E2E run — 92 passed, 18 failed, 12 skipped. After correcting the new RAG test assertion, the remaining 16 failures were POS/layout cases: 14 in `workspace-mocked.spec.ts` around quote-panel selection state and 2 in `ui-layout-reliability.spec.ts` around selectors. The focused demo-price suite passed.
- Supabase CLI 2.121.0: a dry run listed four pending migrations. `npx supabase db push --linked --include-all --yes` then applied them successfully to App Price: `202610180011`, `202610180012`, `202610190001`, and `202610190002`.
- Remote read-only verification confirmed those four migration records, the demo batch table and preview/apply/rollback RPCs, no remaining `rag_page_texts` table, and `demo_price_rows = 0`.
- Before deployment, `rag_page_texts` contained 13 rows and the retired OCR chunk query returned zero. Migration `202610180012` removed the legacy table and those 13 rows as designed.
- `git diff --check` — passed.

## Manual app test

Run the app against App Price, sign in as an owner, and open `/staff/prices`. Preview the batch and inspect the proposed amounts before choosing to apply it. Verify the storefront and chatbot labels, confirm demo values cannot be added to orders or POS quotes, and test rollback. No demo values will appear until an owner applies a preview batch. See `docs/DEMO_PRICE_BACKFILL.md` for the workflow.
