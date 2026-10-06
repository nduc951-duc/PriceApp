# Workspace runbook

## Local setup

Run commands from the repository root with Node.js 20.9+:

```powershell
npm ci
Copy-Item frontend/.env.example frontend/.env.local
Copy-Item backend/.env.example backend/.env.local
```

Set Supabase project URL and publishable key in each local file. In `frontend/.env.local`, set `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`. In `backend/.env.local`, set `FRONTEND_ORIGINS=http://localhost:3000`. Put RAG provider/model settings and provider keys only in the backend file. Both `.env.local` files are ignored by Git.

Run `npm run dev` to start the API on port 4000 and Next.js on port 3000. On Windows, the root runner owns the two child PIDs and uses `taskkill /PID <pid> /T /F` only for those children, waits for their exit, and then exits when either service stops or Ctrl+C is pressed. Unix uses `concurrently` for the same two-service lifecycle. To run one service alone, use `npm run dev --workspace backend` or `npm run dev --workspace frontend`. For backend watch/restart during development, use `npm run dev:watch --workspace backend` in its own terminal. The root runner uses the non-watch backend process so configuration/startup errors propagate and stop the frontend. The API liveness endpoint is `http://localhost:4000/api/v1/health`.

The Windows process test can be run with `npm run test:dev-runner`; it verifies first-failure cleanup and Ctrl+C cleanup using dummy child processes. The process runner does not search by port or terminate unrelated processes.

Root gates run both workspaces: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run build`. `npm run openapi:check` validates the checked-in API contract, and `npm run check` runs all gates together. Workspace-specific commands remain available with `--workspace frontend` or `--workspace backend`.

## CORS, auth and deployment

Set `FRONTEND_ORIGINS` to a comma-separated list of exact browser origins, including scheme and port, with no path (for example `https://price.example.com`). Wildcard origins are not supported. Configure the deployed frontend with `NEXT_PUBLIC_API_BASE_URL` pointing at the API. Deploy `frontend/` and `backend/` independently from the same repository; the frontend build does not host API routes. Keep Supabase Auth/PostgreSQL/Storage RLS enabled. The backend forwards the caller session to Supabase and does not use a service-role key.

The liveness check does not validate Supabase. For login problems, verify both apps use the same Supabase project URL and publishable key, confirm the Auth user exists, check that `FRONTEND_ORIGINS` exactly matches the browser origin, then inspect the API response request ID and Supabase Auth logs. A 401 indicates a missing/invalid session, 403 a role/policy denial, and 503 an unavailable Auth/upstream service. Never paste access tokens or passwords into issue reports.

## Authenticated E2E

E2E is deliberately disabled unless `PRICEAPP_E2E_ENABLED=true` and all isolated owner secrets are present. Local runs without them report skipped authenticated tests and do not start application servers. CI E2E credentials belong in GitHub Actions secrets and must identify a separate test Supabase project/account, never a production owner. Configure:

- `PRICEAPP_E2E_ENABLED=true`
- `PRICEAPP_E2E_PROJECT_REF`
- `PRICEAPP_E2E_SUPABASE_URL`
- `PRICEAPP_E2E_SUPABASE_PUBLISHABLE_KEY`
- `PRICEAPP_E2E_OWNER_EMAIL` and `PRICEAPP_E2E_OWNER_PASSWORD`
- optionally `PRICEAPP_E2E_EMPLOYEE_EMAIL` and `PRICEAPP_E2E_EMPLOYEE_PASSWORD`

The project ref must match the Supabase URL hostname. The known production project ref is rejected by the Playwright config. E2E servers use isolated ports 3210/4210 by default, never reuse an existing server, and suppress Playwright traces so credential entry is not retained in artifacts. Quote tests use an in-memory catalog fixture. Price conflict requests are intercepted before reaching Supabase; offline edits assert that no write request is sent. The RAG UI test stubs its query response so it does not call a provider. The employee role test performs only catalog and admin reads. Auth sign-in is the only Supabase Auth operation performed by these tests.

## Legacy RAG rollback point

The legacy Next handlers and their server-only helper/tests were kept through backend parity testing. The rollback source is commit `e8260d2` (the Task 7 base). After Task 7 has been reviewed, create a local annotated tag pointing at that commit:

```powershell
git tag -a priceapp-pre-rag-cutover e8260d2 -m "PriceApp before removing legacy Next RAG routes"
```

To restore the complete legacy surface on a recovery branch, including imported helpers and their tests:

```powershell
git restore --source=priceapp-pre-rag-cutover --staged --worktree -- frontend/src/app/api/rag frontend/src/lib/rag
```

Review the restored diff and run frontend tests before committing the rollback. The API implementation remains available under `backend/src`; this file restore is intended to restore the old Next path during a controlled rollback.
