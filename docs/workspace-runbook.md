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

Set `FRONTEND_ORIGINS` to a comma-separated list of exact browser origins, including scheme and port, with no path (for example `https://price.example.com`). Wildcard origins are not supported. Configure the deployed frontend with `NEXT_PUBLIC_API_BASE_URL` pointing at the API. The active PriceApp UI sends catalog, price, source-file, and RAG traffic to the independently deployed Fastify API. Legacy Next RAG handlers are still present as a temporary rollback path while isolated authenticated E2E is pending; the UI does not call them. If rolling back to that path, the frontend deployment must also provide its prior server-side RAG environment settings. Keep Supabase Auth/PostgreSQL/Storage RLS enabled. The backend forwards the caller session to Supabase and does not use a service-role key.

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

The authenticated cases have not passed in this environment because no isolated test project/account is configured. Keep the legacy Next RAG routes and helpers until the isolated desktop and mobile E2E suite passes against the backend path. Do not use the application's configured production Supabase project for this gate.

## Customer order requests

Apply `supabase/migrations/202610160002_customer_order_requests.sql` to the intended Supabase project before enabling the public customer flow. The migration creates the anonymous-safe verified retail/wholesale catalog RPC, the pending order-request tables, and owner/editor-only inbox reads and status updates. It also requires an HMAC secret shared between the backend environment (`CUSTOMER_ORDER_HMAC_SECRET`, at least 32 characters) and the private database table. After applying the migration, insert the same generated random secret into `private.customer_order_security` using the Supabase SQL editor or another trusted database administrator session; never put it in frontend variables, browser code, logs, or source control. Without both values, order submissions fail closed. The database validates a short timestamp window and consumes each signed nonce once, so direct anonymous RPC calls cannot bypass the API's IP rate limit. It does not collect payment, set delivery fees, decrement stock, or write sales revenue. Review and apply it from a controlled non-production project first; do not paste service-role credentials into the frontend or browser.

In a private terminal, generate a secret with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`. Save that value in the backend host's `CUSTOMER_ORDER_HMAC_SECRET` setting and use the same value in this SQL Editor statement, replacing the placeholder:

```sql
insert into private.customer_order_security(singleton, hmac_secret)
values (true, 'PASTE_THE_SAME_SECRET_HERE')
on conflict (singleton) do update set hmac_secret = excluded.hmac_secret;
```

After deployment, check `GET /api/v1/public/catalog` without an Authorization header and confirm the response includes only verified retail/wholesale data without supplier/source fields. Submit a small test request with `POST /api/v1/public/order-requests`, then confirm `GET /api/v1/customer-order-requests` returns 401 without staff login, returns 403 for a viewer, and shows the request for owner/editor. The API limits anonymous submissions to five per source IP per ten minutes per API process, and the database requires a backend-only signature plus a one-time nonce; deployments with multiple API replicas should also configure a shared gateway/WAF rate limit.

## Legacy RAG cutover gate and rollback point

The legacy Next handlers, server-only helpers, and tests remain in the worktree. Their removal is pending successful authenticated E2E on an isolated Supabase test project; backend parity alone does not satisfy that gate. The rollback source is commit `e8260d2` (the Task 7 base). After the E2E gate and parent review, create a local annotated tag pointing at that commit before deleting the old surface:

```powershell
git tag -a priceapp-pre-rag-cutover e8260d2 -m "PriceApp before removing legacy Next RAG routes"
```

If a later cutover needs to be reverted, restore the complete legacy surface on a recovery branch, including imported helpers and tests:

```powershell
git restore --source=priceapp-pre-rag-cutover --staged --worktree -- frontend/src/app/api/rag frontend/src/lib/rag
```

Review the restored diff and run frontend tests before committing the rollback. The API implementation remains available under `backend/src`; this file restore is intended to restore the old Next path during a controlled rollback.

## Dependency audit status

On 2026-10-10, the dependency set was updated to Next.js and `eslint-config-next` 16.4.0, Vitest and coverage 4.1.11, and `concurrently` 10.0.6. The last successful advisory response reported zero critical and moderate findings and five high findings, all in the development-only `eslint-config-next` / `@next/eslint-plugin-next` transitive lint chain (`fast-glob`, `micromatch`, `braces`). The available compatible Next 16.4 lint graph still resolves the affected transitive versions; `npm audit fix --force` proposed downgrading `eslint-config-next` to 14.2.35, which does not match the installed Next 16 app, so that breaking downgrade was rejected. A fresh `npm audit` and `npm audit --omit=dev` attempt currently fails because the registry advisory endpoint returns an error; refresh both commands when it is available. Runtime and development advisories must be reported separately, and do not use `--force` without confirming framework compatibility.
