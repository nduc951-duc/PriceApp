# Automatic RAG indexing worker implementation plan

## Goal

Automatically index the verified catalog through an isolated, least-privilege worker identity with durable queue state, safe diagnostics, retries, and idempotent duplicate handling. Do not run or deploy a production index.

## Tasks

1. Add unit tests first for coalesced queue revisions, retry/backoff, stale lease reclaim, terminal failures, and duplicate corpus/index retries.
2. Add Supabase migrations for the custom worker DB role, registered worker identity/access-token hook, worker-scoped RLS/grants, verification-transition trigger, singleton job schema, and guarded claim/ack/fail functions.
3. Add backend worker configuration and an isolated worker process that authenticates with worker credentials, claims jobs, runs indexing to completion, records safe diagnostic errors, and retries bounded failures.
4. Refactor indexing to return stable completion information and expose safe error classification without leaking provider credentials or raw upstream responses.
5. Add migration/security tests for role separation and verification-trigger behavior; run backend tests, typecheck, lint, and migration/static checks. Do not connect to or index production.
6. Update setup docs with the exact Supabase Auth Hook, worker account, backend secrets, deployment command, and staging verification required before enabling production.

## Constraints

- No impersonation of owner, no `service_role`, no service credential search or output.
- RLS remains active for the worker's Data API requests; the custom role receives only explicit worker policies and table privileges.
- Production indexing waits until the job and permissions have been verified in a disposable/staging project.
- Preserve all unrelated dirty workspace changes.
