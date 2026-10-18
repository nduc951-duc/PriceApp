# Demo Price Backfill Validation — 2026-10-19

## Result

The demo-price backfill feature is implemented and verified in the workspace. Demo values have not been applied to a live customer database. The migration and SQL regression were exercised in a separate temporary Supabase project; existing local Supabase stacks were left untouched.

## Checks

- `npm run check` — passed: lint, typecheck, unit tests, OpenAPI consistency check, and production builds. Unit test totals: frontend 84/84, backend 357/357, dev runner 2/2.
- `npm run test:e2e --workspace @price-app/frontend -- --workers=1 tests/customer-order.spec.ts tests/customer-rag-query.spec.ts tests/staff-price-management.spec.ts` — passed, 58/58 across Chromium and mobile. Covers demo labels, refusal to add demo prices to orders, RAG display, and owner preview/apply/rollback UI.
- `supabase/tests/demo_price_backfill.sql` — passed against the isolated local Supabase database. Exercises owner-only access, sample/demo rules, max-100 batching, stale snapshot rejection, retry, next-batch preview, real-price precedence, rollback, and version conflicts. The SQL test rolls back its fixture transaction.
- Full browser E2E run — 92 passed, 18 failed, 12 skipped. After correcting the new RAG test's assertion, the remaining 16 failures are existing POS/layout cases: 14 in `workspace-mocked.spec.ts` around quote-panel selection state and 2 in `ui-layout-reliability.spec.ts` around selectors. They are outside the demo-price flow; the focused suite above passes.
- `git diff --check` — passed.

## Database boundaries

The migration and SQL test ran on a separate Supabase project with isolated ports and a temporary project directory. No production database was linked, migrated, or populated. The demo-price workflow requires an owner to explicitly preview and apply each batch in the target test environment before any rows are created.

## Follow-up for manual app testing

Apply the migration to a dedicated test Supabase project, start the app against that project, sign in as an owner, and open `/staff/prices`. Preview a batch, inspect proposed rows and amounts, apply only the reviewed batch, verify the storefront and chatbot labels, confirm that demo prices cannot be added to an order, then test rollback. See `docs/DEMO_PRICE_BACKFILL.md` for the step-by-step runbook.
