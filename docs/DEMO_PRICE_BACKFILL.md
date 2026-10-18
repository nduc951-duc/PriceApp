# Demo price backfill test runbook

This workflow creates clearly labeled, non-purchasable fixture prices for verified active variants that have no current real price. It uses the median current retail price from the same product group and package quantity when available; otherwise it uses the documented deterministic fixture fallback. It does not call the LLM to set prices.

## Test database

Use a dedicated local or isolated Supabase test database. Do not point these steps at a production project. Applying the migrations adds the demo list and owner-only preview/apply/rollback RPCs; it does not populate product prices until an owner applies a preview batch.

Apply pending migrations to the local test database:

```powershell
npx supabase migration up --local
```

Run the SQL regression file against that same local database. `LOCAL_TEST_DATABASE_URL` must point to the isolated test database, never a linked production database. The file wraps its fixtures and mutations in a transaction and rolls them back.

```powershell
psql $env:LOCAL_TEST_DATABASE_URL -v ON_ERROR_STOP=1 -f supabase/tests/demo_price_backfill.sql
```

Run the app with the backend configured to use that test project, then sign in as an owner and open `/staff/prices`.

## Preview and apply

1. Choose **Xem trước** and review the total eligible count, the first batch (at most 100 rows), each proposed amount, and whether the amount uses a same-package reference or the fixture fallback.
2. Choose **Tạo N giá demo** to apply that batch. Apply rechecks the snapshot under a lock, writes an audit history row, and creates sample/demo prices atomically.
3. If `remainingCount` is nonzero, choose **Xem trước** again and review/apply the next batch. Repeat until the preview reports no remaining eligible rows.
4. Check the public storefront, chatbot answer, and staff price screen. Each demo value must say it is simulated; it must not be offered for customer orders or POS/invoices. If a real price is added for the same variant, the real price takes precedence.
5. **Hoàn tác lô gần nhất** deactivates the most recently applied batch only when its prices remain unchanged and unused by customer orders. A conflict is reported for manual review; the rollback does not overwrite edits.

## Verification commands

```powershell
npm test
npm run lint
npm run typecheck
npm run openapi:check
npm run build
npm run test:e2e
```

The browser E2E suite uses mocked Supabase data by default. Live E2E must use the separate project guard in `frontend/playwright.config.ts`; never disable that guard or use the production project.
