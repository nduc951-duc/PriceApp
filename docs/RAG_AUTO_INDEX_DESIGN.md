# RAG indexing after verification

## Architecture findings

- The Fastify backend authenticates with a Supabase publishable key and the caller's user JWT. It has no worker identity, service credential, queue consumer, or worker deployment command.
- Catalog APIs are read-only. `product_variants.verification_status` can be changed outside the app, so a database trigger is needed to capture every transition regardless of which client performs it.
- The current indexer is owner-only. Its generation RPCs check for `profiles.role = 'owner'`, `rag_index_runs.started_by` requires an Auth user, and staged chunk RLS allows owner writes. There is no `queued` state or durable retry record.
- The indexer already creates stable chunk keys and content/model fingerprints, upserts by `(generation_id, chunk_key)`, and reuses unchanged embeddings. A worker can build on that behavior, but retries must resume from durable job state and must not publish partial generations.
- Current configuration examples contain only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY`; there is no configured least-privilege worker identity. Production indexing is therefore not authorized or runnable yet.

## Proposed design

1. Add a durable singleton job for the verified catalog. A trigger queues/coalesces work when a variant is inserted as verified or changes into verified. The job stores requested/completed revisions, `queued | running | completed | failed`, attempt count, lease, retry time, and a safe diagnostic code/message. Repeated transitions while a job runs increase its requested revision; the worker performs another pass before marking it complete.
2. Give the worker a dedicated Supabase Auth account and a custom Postgres role `rag_index_worker`. A Custom Access Token Hook grants that database role only to the account explicitly registered as the worker. The backend signs in with the publishable key and worker account credentials; its token is server-only. It never uses `service_role`, never changes a user's identity, and never receives owner rights.
3. Add narrowly scoped RLS and table grants for the custom role: read only active verified catalog rows and approved/rejected page metadata needed by indexing; read the active generation and the worker's own staged run; write only chunks for that worker's running generation; claim/finish only the singleton job. Index-generation functions run as `SECURITY INVOKER`; RLS remains in force, and the caller JWT must identify either an owner or `rag_index_worker`. Direct access to unrelated tables remains unavailable.
4. Run a backend worker loop separately from HTTP request handling. It atomically claims with a lease, calls the existing indexer until a full generation completes, and acknowledges only the claimed revision. Transient failures use bounded exponential retry; exhausted jobs become `failed`. A new verification event re-queues a failed job. Identical corpus/fingerprint retries reuse existing chunks and embeddings.
5. Test queue coalescing, lease/retry, terminal diagnostics, duplicate verified events, and repeat indexing of unchanged corpus. Validate the migration and worker role using a disposable Supabase database before enabling the hook or worker in production.

## Required production configuration

The repository and inspected config examples do not contain a worker credential or worker role. Before production indexing can run, configure all of the following:

- Apply the worker-role and queue migrations to Supabase.
- Create one dedicated, confirmed Supabase Auth user for the worker. Add its Auth user UUID to `private.rag_worker_identities` with `insert into private.rag_worker_identities (user_id) values ('<worker-auth-user-uuid>');`; leave its app profile at the default non-owner role.
- In Supabase Auth Hooks, enable `public.rag_worker_access_token_hook` as the Custom Access Token Hook so only that registered user's JWT has `role = rag_index_worker`.
- Set `RAG_WORKER_EMAIL` and `RAG_WORKER_PASSWORD` in the backend's server-side secret store. Do not place either in frontend variables or logs.
- Deploy the backend API and a separate worker process (`npm run start:worker`); the owner-only `GET /api/v1/admin/rag/index-job` route reports queue state and the last safe diagnostic. Verify its JWT database role, RLS access, queue claim, idempotent retry, and job status transitions against a disposable/staging database before production indexing.
- Existing rows that were already `verified` before the trigger was installed do not create a new transition event. After the worker and permissions pass staging verification, queue the one-time initial build with `npm run request:rag-reindex --workspace @price-app/backend` (or the built `start:request:rag-reindex` command). This command only queues work; the worker processes it asynchronously.

This change does not apply migrations to production or execute a production index job. Supabase's custom access-token hook can issue a custom Postgres role claim, and RLS still governs that role; see [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook), [Custom Roles](https://supabase.com/docs/guides/storage/schema/custom-roles), and [Database Functions](https://supabase.com/docs/guides/database/functions).
