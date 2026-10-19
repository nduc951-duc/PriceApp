# Test layout

| Location | Purpose | Command from project root |
| --- | --- | --- |
| `tests/scripts` | Development process supervisor | `npm run test:dev-runner` |
| `backend/tests` | Backend unit and HTTP contract tests, mirrored by module | `npm test --workspace backend` |
| `backend/tests/live/customer-rag.ts` | Read-only customer RAG checks with configured Supabase and AI services | See below |
| `frontend/tests/unit` | Frontend unit tests, mirrored by module | `npm test --workspace frontend` |
| `frontend/tests/e2e` | Playwright browser tests and fixtures | `npm run test:e2e` |
| `supabase/tests` | SQL tests | Run against the isolated test database |

Run `npm run check` for lint, production source typecheck, unit tests, API contract and builds. Backend Vitest uses two workers to avoid false HTTP timeouts under heavy parallelism. Backend test mocks run through Vitest; the production TypeScript build excludes tests, matching the prior behavior.

For live customer tests, from `backend` run:

```powershell
node --env-file=.env.local --import tsx tests/live/customer-rag.ts
```

This sends questions and permission-filtered catalog evidence to the configured chat API. It reads data only, does not create orders, and respects the public limit of five questions/minute. Requires working embeddings, Supabase and available chat quota. The runner writes one readable report to `docs/reports/2026-10-19-customer-rag-evaluation.md`; it is excluded from automatic unit test discovery.

Runtime logs and generated browser reports are ignored. Keep reusable tests and readable evaluation reports; do not add one-off debug dumps or provider secrets.
