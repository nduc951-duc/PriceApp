# Automatic RAG indexing after verification

## Implemented in this repository

- `202610160003_rag_index_worker_identity.sql` creates the dedicated `rag_index_worker` database role, registers eligible Auth user IDs in `private.rag_worker_identities`, and defines the Custom Access Token Hook. The role is `NOBYPASSRLS`; the worker does not use `service_role` or owner impersonation.
- `202610160004_rag_index_jobs.sql` creates a singleton verified-catalog job with `queued`, `running`, `completed`, and `failed` states; requested/completed revisions; a lease; a five-attempt limit; backoff; and bounded diagnostic fields. A database trigger queues work when a variant is inserted as `verified` or transitions into `verified`. Repeated updates that leave it verified do not enqueue duplicates.
- `202610160005_rag_catalog_change_queue.sql` extends queueing to verified variant edits, verification removal, active price edits, package and unit edits, source-link/page/OCR edits, and product/category/alias edits. The worker can read packaging metadata only for active verified variants under RLS. It does not receive `public.prices` access.
- `202610160006_rag_worker_run_sequence_grant.sql` grants the dedicated worker only `USAGE` and `SELECT` on the index-run ID sequence so its invoker RPC can insert `rag_index_runs` rows under RLS.
- `202610160007_rag_worker_auth_schema_usage.sql` records the attempted minimal `auth` schema grant. The managed Supabase project did not retain the grant, so worker-callable SQL was subsequently changed to use the private request-identity helper instead of querying `auth.uid()`.
- `202610160008_rag_request_identity_without_auth_schema.sql` adds `private.rag_request_user_id()` as `SECURITY INVOKER`. It reads the authenticated subject from request JWT settings, is executable only by `authenticated` and `rag_index_worker`, and supports worker RLS policies and invoker RPCs without granting access to the managed `auth` schema.
- `202610170001_rag_worker_vector_schema_usage.sql` grants only `USAGE` on `extensions` to `rag_index_worker`, required to write the `extensions.vector` embedding column.
- Worker-callable index and queue RPCs use `SECURITY INVOKER`. RLS and explicit grants constrain catalog reads, staged chunks, index runs, and queue operations. The token hook only assigns the custom role to an Auth user explicitly listed in the private worker identity table.
- `backend/src/rag-worker.ts` runs separately from the HTTP API. It signs in as the dedicated Auth user, verifies that the access token contains the expected database role, claims work, heartbeats its lease between batches, records safe diagnostics, and retries according to the database job policy.
- `backend/src/services/rag-index.service.ts` stages and publishes complete generations. Stable chunk keys and fingerprints allow unchanged embeddings to be reused; publishing replaces the active generation only after all chunks have been staged.
- Price amounts are not embedded. Each question joins only active, currently valid price rows from `public.prices`, so price edits affect the next answer immediately; the queue refreshes package/unit/search metadata and cleans up chunks after source or verification changes. Package quantity and unit are included in catalog chunks and displayed with the unchanged authoritative price amount.
- Price questions with multiple matching variants and no explicit size/specification return a clarification request instead of listing candidate prices as if the match were certain. Price answers name the active price list/supplier and linked source pages; no-current-price and no-evidence cases use deterministic no-price responses.
- `backend/src/routes/v1/admin.routes.ts` exposes the owner-only job status endpoint. `backend/src/request-rag-reindex.ts` queues a one-time rebuild for already-verified rows; it does not run the index itself.

## Verification coverage

- `backend/src/services/rag-index-worker.test.ts` covers idle jobs, multiple batches, transient retry, safe diagnostics, and coalesced requests.
- `backend/src/rag/index.test.ts` covers retry/resume after a failed batch, unchanged-corpus idempotency (one active chunk and one embedding), package/unit changes replacing the old chunk and embedding, and keeping the old generation active until publish.
- `backend/src/rag/query.test.ts` covers live price reads, source revocation, no-price behavior, and asking the user to choose a size when a query matches multiple variants. `backend/src/rag/price-answer.test.ts` covers amount, package unit, minimum quantity, price list/supplier, and source-page reporting.
- `supabase/tests/rag_auto_index_worker.sql` is a transactional database regression test. It checks `NOBYPASSRLS`, invoker security for worker RPCs, selected grants, request-identity helper access, vector schema usage, trigger queue behavior for new verified variants, verify/unverify, duplicate verification, source-link edits, unit edits, and price edits. A live worker-token probe separately confirmed worker-role access and rejected invalid writes through constraints without inserting rows.

## Verified deployment runbook

The user explicitly authorized the exact Supabase project `tvznrmnxrgxdwukjsgon` after confirming its Dashboard label is `main — PRODUCTION`. It is a production project; this runbook records the narrowly scoped worker/RAG changes made under that authorization and must not be described as staging.

1. Keep the dedicated worker Auth credentials in the ignored `backend/.env.local` or a server-side secret store. Never place them in frontend config, source control, command arguments, or logs.
2. The applied worker/RAG migrations are `202610160003` through `202610170001`. The Auth Custom Access Token hook is enabled as `public.rag_worker_access_token_hook`; the dedicated worker UUID is registered in `private.rag_worker_identities`.
3. The worker signs in with the dedicated account and verifies `role = rag_index_worker`. It is `NOBYPASSRLS`, has no owner profile, cannot read `public.prices`, and uses only invoker RPCs under RLS. The hook returns ordinary user claims unchanged for a non-worker UUID.
4. Run SQL regression tests with `npx.cmd supabase db test --linked` only after checking the linked ref is exactly `tvznrmnxrgxdwukjsgon`; do not use service-role credentials or owner impersonation. The regression test has passed on the authorized project.
5. To process a later catalog revision, start the separate worker with `npm.cmd run dev:worker --workspace @price-app/backend`; queue requests are idempotent and the worker uses bounded retries. Do not run the initial full-corpus reindex again unless intentionally rebuilding the catalog.

## Deployment history

Before the user authorized this exact production ref, migrations and indexing had not run remotely. The deployment status and verification results below supersede any earlier staging-only status notes in this document.

## Local application/demo

For local development or a project the operator has authorized, point frontend and backend at the same Supabase URL. The frontend needs `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_API_BASE_URL`; the backend needs `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, RAG provider settings, and server-only worker credentials. Keep `.env.local` ignored.

1. Start the web app and API with `npm.cmd run dev` from the repository root.
2. In a second terminal, start the indexing worker with `npm.cmd run dev:worker --workspace @price-app/backend`.
3. Sign in through the app, open `/questions`, and ask a question with a specific size and tier, for example `Giá sỉ tắc kê sắt 8 ly là bao nhiêu?`. The answer shows the active price, packaging unit, source price list/supplier, and linked source page. Asking `Giá tắc kê sắt?` should ask which size; a missing active price/evidence should return a no-price/no-evidence response.
4. New verified variants and edits to indexed catalog fields queue automatically. Previously verified rows were reindexed once on the user-authorized project as part of this deployment.

The `.env.local` files are developer-managed and must not be committed. Check the project reference and authorization before any remote worker or reindex command.

## Customer price questions

The customer storefront uses `POST /api/v1/public/rag/query` without a login. This route has a small per-IP request limit and uses only the anonymous Supabase client. Its catalog, current-price, source-page, and vector-search calls are backed by the narrow RPCs in `202610180001_public_customer_rag_query.sql`; those functions expose only active, verified catalog variants, current retail/wholesale prices, non-sample price lists, and current verified-catalog chunks. They do not grant anonymous access to the underlying tables. The staff endpoint and conversation/feedback flow remain authenticated and unchanged.

The customer-query migration is code-only until explicitly applied to the intended Supabase project. The local Playwright flow mocks the API and verifies guest rendering, source display, dark-mode contrast, and adding the exact current price to an order; it does not establish that an unapplied remote migration or live provider is working.

## Current verification status (2026-10-17)

- Target: `tvznrmnxrgxdwukjsgon` (`main — PRODUCTION` in Dashboard, explicitly authorized by the user for this task).
- Auth hook enabled and pointed at `public.rag_worker_access_token_hook`; worker UUID `fe06deaf-c9cc-4b2e-aea1-957415329c7d` is registered idempotently.
- SQL regression test passed after migrations. Worker sign-in returned the `rag_index_worker` role; RLS remained enabled, worker was `NOBYPASSRLS`, had no owner profile, and could not read `public.prices`. A normal non-worker UUID retained ordinary claims.
- One-time initial reindex completed: 654 verified variants, 654 active chunks, and 654 embeddings in active generation 4 using `bge-m3` (1024 dimensions). Latest queue job completed with 0 attempts and no error; its run reports 654/654 chunks completed. No failed jobs remain after the successful requeue.
- Clean-copy `npm.cmd run check` passed, including lint, typecheck, unit suites (frontend 109, backend 190, dev runner 2), OpenAPI check, and production build. The Playwright UI test for clicking “Hỏi giá” and rendering a cited price passed against mocked API data. The full manual authenticated Q&A against Supabase was not completed; this document does not claim that the RAG answer path has been verified against live data.
