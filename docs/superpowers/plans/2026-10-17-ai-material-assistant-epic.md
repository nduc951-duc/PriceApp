# Flexible Grounded Material Assistant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan. Tasks are ordered because the query contract, evidence model, and UI depend on one another.

**Goal:** Implement the approved material-assistant epic so customers and staff can ask natural-language questions, get complete catalog listings when requested, and receive flexible answers grounded in authorized catalog, current SQL prices, and verified document evidence.

**Architecture:** Keep the existing Fastify RAG route and Supabase security boundaries. Add a validated query plan between the question and retrieval, gather typed evidence from the appropriate source, then compose a typed response whose claims and citations are checked before rendering. SQL remains authoritative for current prices and complete catalog lists; verified hybrid RAG remains the source for document facts. The model interprets and explains evidence but cannot create prices, product IDs, units, or sources.

**Tech Stack:** TypeScript, Fastify, Zod, Supabase/Postgres with RLS and RPCs, the repository's configured Ollama-compatible provider, Next.js/React, Tailwind CSS v4, Flowbite React, Vitest, and Playwright.

**Approved spec:** `docs/superpowers/specs/2026-10-17-ai-material-assistant-epic-design.md`

## Working constraints

- Preserve all current uncommitted changes, especially the catalog and RAG variant-listing work. Do not reset, revert, or stage unrelated files.
- Read and follow root and frontend `AGENTS.md` instructions before implementation. Use Flowbite React for UI primitives already covered by the project; do not add a parallel component system.
- Do not use remote Supabase for this plan's migrations, fixtures, indexing, or smoke tests. Use Supabase local or another explicitly isolated database. Never use `service_role`, bypass RLS, or expose credentials.
- Do not modify price rows or embeddings as part of this epic. Current price retrieval must continue through the existing authorized SQL/RPC paths.
- Retain a deterministic fast path for clear, singular price lookups. Use semantic planning for natural, ambiguous, multi-intent, advice, and comparison questions; measure its latency and preserve a safe fallback if the model is unavailable.
- A complete-list request must use a structured catalog query with an explicit count and pagination. Vector top-k results cannot establish completeness.
- A price can only be shown from a currently valid SQL price row. A variant can only be included if it is currently eligible and verified. Missing evidence must lead to clarification or abstention.

## Review focus

1. No answer or recommendation can introduce an unsupported product fact, price, unit, source, or product identity.
2. List requests return the full matching set through pagination and report the total; they do not silently truncate to vector top-k.
3. Every public query stays within public RPC/ACL rules; staff paths continue to use the authenticated identity and existing RLS. No route widens table access.
4. Follow-up context can resolve references but cannot override current SQL prices or make stale/unauthorized evidence eligible.
5. Customer and staff UI share appropriate interaction patterns without leaking staff controls; chat input supports Enter to send and Alt+Enter for a newline.

## Implementation tasks

### Task 1 — Establish a measurable epic evaluation set

**Files:**

- Modify `backend/src/rag/evaluation.ts` and its existing tests.
- Modify `backend/src/rag/evaluation-runner.ts` and its tests.
- Add `backend/testdata/rag-assistant-cases.json` as a versioned candidate set; promote a case to adjudicated only after its expected facts are independently checked against the approved corpus/current catalog.
- Update `docs/RAG_L1_CASES.md` to map the existing L1-L9 checks to US-01–US-12 and identify already-covered behavior.
- Add an evaluation command to `backend/package.json` if the current runner has no repeatable package script.

**Steps:**

1. Add failing metric tests, then create candidate questions for exact price lookup, accent-insensitive aliases, complete variant listing, ambiguous specification, multi-intent question, supported product facts, unsupported question, explicit comparison, advice with a stated use case, follow-up reference, stale-price reread, and provider failure. Do not invent expected amounts or mark unreviewed facts adjudicated.
2. Extend the case contract to record intent, expected product/variant IDs, required price tier/amount/unit, list total, expected clarification or abstention, required citations, and role. Keep expected answers as adjudicated facts and assertions, not canned response prose.
3. Extend the runner to report per-intent success, exact price/unit match, list precision/recall and completeness, citation validity, abstention quality, and latency percentiles. Preserve current metrics and existing fixture compatibility.
4. Run the evaluation unit tests and verify the command prints a stable, machine-readable summary without secrets.

**Verification:**

```powershell
npm.cmd test --workspace @price-app/backend -- src/rag/evaluation.test.ts src/rag/evaluation-runner.test.ts
npm.cmd run eval:rag --workspace @price-app/backend -- --help
```

### Task 2 — Add a flexible, validated query planner

**Files:**

- Add `backend/src/rag/query-plan.ts` and `backend/src/rag/query-plan.test.ts`.
- Modify `backend/src/rag/provider.ts` and provider tests to support schema-constrained planning with the configured model.
- Adapt `backend/src/rag/query-understanding.ts` and its tests to consume the plan while preserving compatible deterministic helpers.

**Steps:**

1. First add tests for varied Vietnamese phrasing, missing diacritics, colloquial product names, multiple requests in one question, explicit versus implicit comparison, advice questions with missing constraints, references such as “loại thứ hai”, out-of-domain questions, malformed model output, and model timeout.
2. Define a Zod-validated `RagQueryPlan` with one or more requested operations (`price_lookup`, `catalog_list`, `product_info`, `advice`, `comparison`, `clarification`, `out_of_scope`), extracted product/specification/quantity/tier constraints, unresolved fields, context references, and confidence. Plans contain no generated prices or evidence claims.
3. Implement `planRagQuery(question, context)` so the existing high-confidence singular price path remains fast, while natural, uncertain, or multi-intent wording uses the configured semantic model. Reject invalid output and return a safe clarification/fallback plan.
4. Ensure planner prompts request structured JSON only, cap input/context size, and never include credentials or unrelated conversation data.

**Verification:**

```powershell
npm.cmd test --workspace @price-app/backend -- src/rag/query-plan.test.ts src/rag/query-understanding.test.ts src/rag/provider.test.ts
```

### Task 3 — Make catalog listing complete and pageable

**Files:**

- Add `supabase/migrations/202610180005_rag_catalog_search_pagination.sql` after the current `202610180004` migration.
- Add or extend `supabase/tests/public_customer_catalog_search_terms.sql` and `supabase/tests/public_catalog_and_rag_acl.sql`.
- Modify `backend/src/repositories/rag-catalog.repository.ts` and repository tests.
- Modify `backend/src/openapi/contract.ts` and relevant controller/service tests for list metadata.

**Steps:**

1. Add failing SQL and repository tests showing that an all-types query cannot be considered complete when only top-k/vector results are returned.
2. Add `list_public_rag_catalog_page` for anon and `list_staff_rag_catalog_page` for authenticated staff. The public function returns only eligible verified variants and current retail/wholesale prices; the staff function is `SECURITY INVOKER`, so existing RLS applies and permitted dealer prices remain available. Both match accent-insensitive names/aliases/SKUs/specifications and an optional user-stated category phrase, use deterministic variant-ID keyset pagination, and return `total_count` plus `next_cursor`.
3. Grant `EXECUTE` on each function only to its intended role and keep direct table ACL, existing public RPC grants, and worker permissions unchanged. The public function is `SECURITY DEFINER` only to provide a narrowly filtered public projection; the staff function must remain invoker.
4. Add a repository method with the contract `searchCatalogPage(query, cursor, limit, categoryText?) -> { items, total, nextCursor }`. Keep category text in the validated query plan and apply it as a text filter in SQL; never let a model-generated database ID select a category.
5. Verify no duplicates or gaps across pages on a stable fixture, correct total counts, accent-insensitive search, alias/SKU/category matching, current role-appropriate prices, and exclusion of inactive or unverified variants.

**Verification:**

```powershell
supabase test db supabase/tests/public_customer_catalog_search_terms.sql --local
supabase test db supabase/tests/public_catalog_and_rag_acl.sql --local
npm.cmd test --workspace @price-app/backend -- src/repositories/rag-catalog.repository.test.ts
```

Do not run `supabase db reset` without first explaining that it deletes and recreates the local database. If local Supabase is unavailable, run repository/unit checks and stop before database operations.

### Task 4 — Build typed evidence packets and validated response blocks

**Files:**

- Add `backend/src/rag/evidence.ts` and `backend/src/rag/evidence.test.ts`.
- Add `backend/src/rag/grounded-response.ts` and its tests.
- Modify `backend/src/rag/provider.ts`, `backend/src/openapi/contract.ts`, and backend response-schema tests.
- Update generated OpenAPI artifacts only through the repository's established generator.

**Steps:**

1. Add failing tests for missing evidence, wrong-role evidence, stale price evidence, mismatched citation IDs, fabricated variant IDs, unsupported product claims, and provider JSON with invented amounts/units.
2. Define typed evidence entries for catalog matches, current SQL prices, verified document chunks, and source pages. Each item must retain provenance and eligibility metadata needed for validation.
3. Define a typed response with `blocks` (`narrative`, `clarification`, `comparison`, `recommendation`), each tied to allowed evidence IDs, plus structured catalog items, pagination metadata, citations, and next actions. Keep the existing `answer` field during migration for clients that have not moved to blocks.
4. Implement a validator that rejects unknown IDs and removes any model-produced price, unit, source label, or variant identity from narrative output. Render those facts only from validated SQL/catalog fields. A block with unsupported claims becomes a clarification or abstention rather than being returned as fact.
5. Keep citations tied to evidence returned by the current request and expose page/source links only when the evidence has those fields.

**Verification:**

```powershell
npm.cmd test --workspace @price-app/backend -- src/rag/evidence.test.ts src/rag/grounded-response.test.ts src/rag/citations.test.ts
npm.cmd run openapi:check
```

### Task 5 — Orchestrate P0 intents through authorized evidence sources

**Files:**

- Modify `backend/src/services/rag-query.service.ts` and `backend/src/rag/query.test.ts`.
- Modify `backend/src/repositories/rag-catalog.repository.ts` only through the catalog contract from Task 3.
- Modify route/controller tests under `backend/src/routes/v1` and `backend/src/controllers` as needed.

**Steps:**

1. Add failing end-to-end service tests for price lookup, catalog list, product fact lookup, mixed price-and-list requests, clarification, and out-of-scope questions.
2. Route each planned operation to its evidence source: catalog RPC/repository for identity and complete lists, live SQL/RPC for price, and verified hybrid retrieval for document facts. Do not use vector retrieval to answer a complete-list request.
3. Re-read current price rows at answer time, join by validated variant ID, and ensure price tier, amount, and unit come from that row. Filter inactive/unverified variants before composing any result.
4. Assemble evidence packets, invoke grounded response generation only when natural explanation is useful, validate response blocks, and preserve deterministic answers for exact price lookups.
5. Implement safe partial responses for multi-intent questions: answer supported parts, explicitly mark unsupported parts, and ask one focused follow-up when a required attribute is ambiguous.
6. Add model-unavailable behavior: exact SQL/catalog lookup still works; unsupported semantic/document questions clarify or abstain without generating a price.

**Verification:**

```powershell
npm.cmd test --workspace @price-app/backend -- src/rag/query.test.ts src/routes/v1/rag.routes.test.ts
```

### Task 6 — Add evidence-grounded advice, comparison, and follow-up context

**Files:**

- Modify `backend/src/rag/query-plan.ts`, `backend/src/services/rag-query.service.ts`, and related tests.
- Modify `backend/src/controllers/rag-query.controller.ts`, `backend/src/routes/v1/rag.routes.ts`, and conversation schema/service tests only where required.
- Modify the existing customer query-context code and its tests without persisting guest conversations unless the current product contract already does so.

**Steps:**

1. Add tests for comparison of two explicitly resolved variants, ambiguous comparison, recommendation with enough use-case constraints, recommendation with missing constraints, and follow-ups that use “cái đó/loại kia” after a prior result.
2. Resolve follow-up references against the last validated result IDs, but re-query current catalog eligibility and SQL price before responding. Never treat old answer text as evidence.
3. For advice, ask for missing application constraints rather than inventing compatibility. Recommend only items whose relevant attributes are supported by verified evidence; explain the evidence and disclose unsupported attributes.
4. For comparison, compare only requested or explicitly resolved variants and show only dimensions present in evidence. Never infer that a missing dimension is equal or better.
5. Keep staff conversations owner-scoped and customer context ephemeral/size-limited; preserve public RPC restrictions and per-IP rate limits.

**Verification:**

```powershell
npm.cmd test --workspace @price-app/backend -- src/rag/query-plan.test.ts src/rag/query.test.ts src/services/rag-conversation.service.test.ts
```

### Task 7 — Present one coherent customer/staff experience

**Files:**

- Reuse the existing customer catalog/RAG components and adapt employee search screens identified by `frontend/AGENTS.md`.
- Modify frontend API response types and the customer/staff search and assistant components.
- Modify `frontend/tests/customer-rag-query.spec.ts` and `frontend/tests/rag-query-ui.spec.ts`; add focused coverage for staff if no current browser test covers that screen.

**Steps:**

1. Add failing browser tests proving catalog filtering and AI asking are separate controls: typing in catalog search filters products; sending an AI question leaves the catalog filter unchanged.
2. Render validated response blocks, exact catalog totals/pages, clarification choices, price cards, and available evidence links. Keep all price/unit/specification values sourced from API fields rather than parsing generated prose.
3. Apply shared search and response presentation across customer and staff where workflows match; preserve employee-only controls and never show them to guests.
4. Make chat readable in light/dark themes, keyboard accessible, and responsive. Enter submits; Alt+Enter inserts a newline. Include empty, loading, error, clarification, insufficient-evidence, and result states.
5. Keep Vietnamese typography and punctuation consistent with existing app fonts; verify no missing glyphs or unstyled fallback controls. Follow the Flowbite React component conventions in `frontend/AGENTS.md`.

**Verification:**

```powershell
npm.cmd run test:e2e --workspace @price-app/frontend -- tests/customer-rag-query.spec.ts tests/rag-query-ui.spec.ts
```

Run browser tests against local app services and fixture/local data; do not silently use production.

### Task 8 — Complete feedback and final quality gate

**Files:**

- Modify `backend/src/schemas/rag-feedback.schema.ts`, `backend/src/services/rag-feedback.service.ts`, and feedback route/controller tests.
- Modify `frontend` feedback controls and browser tests.
- Add a narrowly scoped migration only if the existing feedback constraints cannot represent the approved reasons; add the matching isolated SQL regression.
- Update `docs/RAG_L1_CASES.md`, `docs/PRICEAPP_RAG_ROADMAP.md`, and a short local demonstration section in the relevant RAG docs.

**Steps:**

1. Add failing tests for feedback on helpfulness, missing data, wrong product/specification, wrong price/unit, missing/incorrect citation, and retrieval/provider failure. Keep staff feedback user-owned and the owner-only aggregate view restricted.
2. Add customer feedback only through a response-bound opaque handle with expiry and rate limiting; do not expose conversation internals, permit arbitrary message IDs, or persist IP addresses. Preserve the current authenticated feedback flow.
3. Update evaluation cases with observed outcomes and add thresholds for exact price/unit correctness, list completeness, citation correctness, abstention, and latency. Report failures by intent so regressions are diagnosable.
4. Run focused tests, all SQL regression fixtures on the isolated database, the backend and frontend browser tests, and full `npm.cmd run check` plus `git diff --check`.
5. Document local startup, required non-secret configuration names, how to run the evaluation and browser tests, and known limits. Do not claim production validation based on local results.

**Verification:**

```powershell
npm.cmd test --workspace @price-app/backend -- src/services/rag-feedback.service.test.ts
npm.cmd run test:e2e --workspace @price-app/frontend -- tests/customer-rag-query.spec.ts tests/rag-query-ui.spec.ts
npm.cmd run check
git diff --check
```

Run SQL fixtures locally in migration order:

```powershell
supabase test db supabase/tests/public_customer_catalog_search_terms.sql --local
supabase test db supabase/tests/public_catalog_and_rag_acl.sql --local
supabase test db supabase/tests/rag_auto_index_worker.sql --local
supabase test db supabase/tests/price_rpc_security.sql --local
```

Skip any remote Supabase operation. If local services or credentials are missing, record the exact blocker and do not substitute production.

## Acceptance checklist

- [ ] Natural Vietnamese variants and multi-intent queries become validated plans; malformed/low-confidence plans clarify safely.
- [ ] Catalog listing reports the real total and supports complete pagination, independent of vector top-k.
- [ ] Price, tier, amount, unit, variant, and source displayed to users match authorized current database evidence.
- [ ] Verified documents support product facts; unavailable evidence leads to clarification or abstention.
- [ ] Advice and comparison use only supported attributes and disclose gaps.
- [ ] Follow-ups use validated prior IDs and refresh current eligibility/prices.
- [ ] Catalog filters and AI conversation are independent in customer and staff UI; staff-only actions remain protected.
- [ ] Feedback remains role-safe and bounded to the response being rated.
- [ ] Unit, SQL, browser, evaluation, full check, and diff checks have recorded results.
- [ ] No production database operation occurred during local implementation and verification.

## Execution record — 2026-10-17

- Tasks 1–8 code changes are implemented in sequence. Candidate cases remain unscored pending expert fact adjudication; no retrieval accuracy result is claimed.
- `npm.cmd run check`: passed — frontend 111/111, backend 288/288, lint, typecheck, OpenAPI check, and frontend/backend production builds.
- `npm.cmd run test:e2e`: passed — 58 desktop/mobile browser tests; 12 isolated integration tests were skipped by the configured runner.
- `npm.cmd run eval:rag --workspace @price-app/backend -- --help`: passed. `git diff --check`: passed (Git emitted only line-ending conversion notices).
- SQL fixtures and migrations are present but not verified on a database because Supabase local CLI/engine access is unavailable. No remote/production Supabase operation occurred. Therefore database ACL/RPC behavior and real-corpus RAG quality remain unverified; keep those acceptance items open until an isolated local database run succeeds.
