# Workspace runbook

## Local setup

Run commands from the repository root with Node.js 22.12+:

```powershell
npm ci
Copy-Item frontend/.env.example frontend/.env.local
Copy-Item backend/.env.example backend/.env.local
```

Set Supabase project URL and publishable key in each local file. In `frontend/.env.local`, set `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`. In `backend/.env.local`, set `FRONTEND_ORIGINS=http://localhost:3000`. Put RAG provider/model settings and provider keys only in the backend file. Both `.env.local` files are ignored by Git. Backend dev/start loads `backend/.env.local` when it exists; CI and deployments can supply the same values through process environment variables without creating a local file.

Run `npm run dev` to start the API on port 4000 and Next.js on port 3000. On Windows, the root runner owns the two child PIDs and uses `taskkill /PID <pid> /T /F` only for those children, waits for their exit, and then exits when either service stops or Ctrl+C is pressed. Unix uses `concurrently` for the same two-service lifecycle. To run one service alone, use `npm run dev --workspace backend` or `npm run dev --workspace frontend`. For backend watch/restart during development, use `npm run dev:watch --workspace backend` in its own terminal. The root runner uses the non-watch backend process so configuration/startup errors propagate and stop the frontend. The API liveness endpoint is `http://localhost:4000/api/v1/health`.

The Windows process test can be run with `npm run test:dev-runner`; it verifies first-failure cleanup and Ctrl+C cleanup using dummy child processes. The process runner does not search by port or terminate unrelated processes.

Root gates run both workspaces: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. `npm run openapi:check` validates the checked-in API contract, and `npm run check` runs all gates together. Workspace-specific commands remain available with `--workspace frontend` or `--workspace backend`.

## CORS, auth and deployment

Set `FRONTEND_ORIGINS` to a comma-separated list of exact browser origins, including scheme and port, with no path (for example `https://price.example.com`). Wildcard origins are not supported. Configure the deployed frontend with `NEXT_PUBLIC_API_BASE_URL` pointing at the API. The active PriceApp UI sends catalog, price, source-file, and RAG traffic to the independently deployed Fastify API. The old Next RAG handlers and OCR/page-edit routes have been removed. Keep Supabase Auth/PostgreSQL/Storage RLS enabled. The backend forwards the caller session to Supabase and does not use a service-role key.

The liveness check does not validate Supabase. For login problems, verify both apps use the same Supabase project URL and publishable key, confirm the Auth user exists, check that `FRONTEND_ORIGINS` exactly matches the browser origin, then inspect the API response request ID and Supabase Auth logs. A 401 indicates a missing/invalid session, 403 a role/policy denial, and 503 an unavailable Auth/upstream service. Never paste access tokens or passwords into issue reports.

## Authenticated E2E

`npm run test:e2e` builds the backend and frontend, then Playwright starts the built Fastify and Next.js servers as direct child processes on ports 4210/3210. Its global teardown stops only those owned process trees. Deterministic browser tests use mocked Supabase Auth and API responses and run without any Supabase project; their intercepted browser requests do not reach Supabase or an RAG provider. CI runs this mocked desktop/mobile suite on every pull request. Authenticated E2E remains a separate gated workflow job; it runs only when `PRICEAPP_E2E_ENABLED=true` and isolated owner secrets are present. Without them, authenticated tests are reported as skipped; CI E2E credentials belong in GitHub Actions secrets and must identify a separate test Supabase project/account, never a production owner. Configure:

- `PRICEAPP_E2E_ENABLED=true`
- `PRICEAPP_E2E_PROJECT_REF`
- `PRICEAPP_E2E_SUPABASE_URL`
- `PRICEAPP_E2E_SUPABASE_PUBLISHABLE_KEY`
- `PRICEAPP_E2E_OWNER_EMAIL` and `PRICEAPP_E2E_OWNER_PASSWORD`
- optionally `PRICEAPP_E2E_EMPLOYEE_EMAIL` and `PRICEAPP_E2E_EMPLOYEE_PASSWORD`

The project ref must match the Supabase URL hostname. The known production project ref is rejected by the Playwright config. E2E servers use isolated ports 3210/4210 by default, never reuse an existing server, and suppress Playwright traces so credential entry is not retained in artifacts. Quote tests use an in-memory catalog fixture. Price conflict requests are intercepted before reaching Supabase; offline edits assert that no write request is sent. The RAG UI test stubs its query response so it does not call a provider. The employee role test performs only catalog and admin reads. Auth sign-in is the only Supabase Auth operation performed by these tests.

The authenticated cases have not passed in this environment because no isolated test project/account is configured. Deterministic mocked E2E remains available without Supabase. Do not use the application's configured production Supabase project for the authenticated gate.

## Customer order requests

Customers submit from `/shop`. Owners and editors can also open **Đơn khách đặt → Tạo đơn** from `/staff`, select the published product, specification, packaging and price tier, and enter the customer's contact details. Staff submissions use authenticated `POST /api/v1/customer-order-requests`; the anonymous five-per-ten-minute IP quota applies only to the public submission route. Both routes use the same signed, idempotent database RPC, validate current price versions and package minimums, and save immutable order-item snapshots. The inbox reloads after successful creation; contacted, confirmed and cancelled states remain owner/editor operations.

Apply `supabase/migrations/202610160002_customer_order_requests.sql` to the intended Supabase project before enabling the public customer flow. The migration creates the anonymous-safe verified retail/wholesale catalog RPC, the pending order-request tables, and owner/editor-only inbox reads and status updates. It also requires an HMAC secret shared between the backend environment (`CUSTOMER_ORDER_HMAC_SECRET`, at least 32 characters) and the private database table. After applying the migration, insert the same generated random secret into `private.customer_order_security` using the Supabase SQL editor or another trusted database administrator session; never put it in frontend variables, browser code, logs, or source control. Without both values, order submissions fail closed. The database validates a short timestamp window and consumes each signed nonce once, so direct anonymous RPC calls cannot bypass the API's IP rate limit. It does not collect payment, set delivery fees, decrement stock, or write sales revenue. Review and apply it from a controlled non-production project first; do not paste service-role credentials into the frontend or browser.

In a private terminal, generate a secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Save that value in the backend host's `CUSTOMER_ORDER_HMAC_SECRET` setting and use the same value in this SQL Editor statement, replacing the placeholder:

```sql
insert into private.customer_order_security(singleton, hmac_secret)
values (true, 'PASTE_THE_SAME_SECRET_HERE')
on conflict (singleton) do update set hmac_secret = excluded.hmac_secret;
```

After deployment, check `GET /api/v1/public/catalog` without an Authorization header and confirm the response includes only verified retail/wholesale data without supplier/source fields. Submit a small test request with `POST /api/v1/public/order-requests`, then confirm `GET /api/v1/customer-order-requests` returns 401 without staff login, returns 403 for a viewer, and shows the request for owner/editor. The API limits anonymous submissions to five per source IP per ten minutes per API process, and the database requires a backend-only signature plus a one-time nonce; deployments with multiple API replicas should also configure a shared gateway/WAF rate limit.

## Public RAG feedback

Anonymous shoppers can rate a RAG response only when the backend has `RAG_FEEDBACK_HMAC_SECRET` configured and migration `202610180006_rag_feedback_taxonomy_and_public_handles.sql` has been applied. Generate a separate random value of at least 32 characters in a private terminal; store it in the backend secret manager and the singleton row in `private.rag_public_feedback_security`. Keep it separate from `CUSTOMER_ORDER_HMAC_SECRET`; never put it in frontend configuration, logs, source control, or chat. Without both settings, the API omits the response-bound feedback handle and the customer rating controls stay hidden.

The signed handle contains no question, answer, conversation, account, or source IP. It expires after 30 minutes. The public endpoint accepts at most ten submissions per source IP per hour per API process, does not persist IP addresses, and the database accepts only one row per response ID. For multi-replica deployments, configure the same shared gateway/WAF rate limit used for other public endpoints. The owner feedback summary combines these aggregate ratings with authenticated staff feedback; public rows have no user or conversation link and their table is not directly writable by `anon` or `authenticated`.

Run `supabase test db supabase/tests/rag_public_feedback_security.sql --local` after applying migrations to a local or isolated database. Do not apply this migration or its fixture to production as part of local validation.

## Catalog-only RAG

RAG answers now use active, verified Supabase catalog rows, attributes, and packaging data. Current prices are fetched from SQL for each price question. OCR, transcript editing, page preview, and the legacy Next RAG routes are removed. Apply `supabase/migrations/202610180009_catalog_only_rag.sql` to the intended project before expecting the new behavior; then rebuild the active embedding generation with the dedicated worker. Follow [RAG_SETUP.md](../RAG_SETUP.md) for setup and checks. Existing transcript rows are retained for historical integrity, but their API access and indexing trigger are revoked.

## Dependency audit status

On 2026-10-10, the dependency set was updated to Next.js and `eslint-config-next` 16.4.0, Vitest and coverage 4.1.11, and `concurrently` 10.0.6. The last successful advisory response reported zero critical and moderate findings and five high findings, all in the development-only `eslint-config-next` / `@next/eslint-plugin-next` transitive lint chain (`fast-glob`, `micromatch`, `braces`). The available compatible Next 16.4 lint graph still resolves the affected transitive versions; `npm audit fix --force` proposed downgrading `eslint-config-next` to 14.2.35, which does not match the installed Next 16 app, so that breaking downgrade was rejected. A fresh `npm audit` and `npm audit --omit=dev` attempt currently fails because the registry advisory endpoint returns an error; refresh both commands when it is available. Runtime and development advisories must be reported separately, and do not use `--force` without confirming framework compatibility.
