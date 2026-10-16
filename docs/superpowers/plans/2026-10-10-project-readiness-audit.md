# PriceApp Project Readiness Audit Plan

> Execution method supplied by the user: parallel subagent cross-review, followed by root integration and verification.

**Goal:** Review and repair PriceApp to a strong, reproducible level for a one-person IT project course submission without claiming unverified cloud or corpus behavior.

**Architecture:** Keep the existing Next.js frontend, Fastify backend, and Supabase/RLS architecture. Review each boundary independently, reproduce findings, make the smallest fixes, and verify with the repository-wide gates plus any targeted checks.

**Requirements:** `AGENTS.md`, `README.md`, `docs/PRICEAPP_RAG_ROADMAP.md`, `docs/L4_L9_EXECUTION.md`, `docs/architecture.md`, and `docs/workspace-runbook.md`.

## Global Constraints

- Preserve user changes already in the working tree, including the account-management spec edit.
- Never edit an applied Supabase migration; fix schema issues with a new migration.
- Never expose `.env.local`, provider keys, access tokens, service-role keys, or database passwords.
- Keep `prices.amount` authoritative; price writes use audited RPCs with `expected_version`.
- Do not claim cloud RLS, E2E, OCR approval, or benchmark success without matching evidence.
- Completion gates from `AGENTS.md`: lint, typecheck, unit tests, production build; document database/E2E blockers.

## Review Focus

1. Price, package, and quantity selection must not silently change value or unit.
2. Authentication, tenant/user scoping, RLS, cache behavior, and admin access must fail closed.
3. RAG answers must use current SQL price rows and verifiable source provenance.
4. Offline snapshots and runner scripts must start/stop cleanly and avoid stale authenticated data.
5. A clean checkout must expose accurate setup, environment requirements, test commands, and remaining acceptance gates.

## Tasks

### Task 1: Establish the baseline

- [ ] Record branch, dirty files, package/runtime requirements, and current test/build output.
- [ ] Run `npm.cmd run check` and `npm.cmd run test:e2e`; classify failures as code, test-environment, or credential-gated.

### Task 2: Cross-review independent boundaries

- [ ] Backend reviewer: routes, auth, RAG pipeline, price/catalog services, OpenAPI and tests.
- [ ] Frontend reviewer: navigation, auth, cart/price behavior, offline/cache, API integration and tests.
- [ ] Supabase reviewer: migrations, RLS/grants/policies, schema contracts, setup/runbook and acceptance evidence.
- [ ] Root reviewer: project structure, CI, dependency hygiene, clean-machine setup, docs and integration risks.

### Task 3: Reproduce and repair findings

- [ ] Rank findings by data integrity/security, user-visible correctness, reliability, then maintainability.
- [ ] For each fix, add or update a focused test before changing implementation where practical.
- [ ] Preserve applied migration history and unrelated dirty edits.
- [ ] Re-review fixes across an independent agent boundary.

### Task 4: Final verification and readiness report

- [ ] Re-run targeted tests after fixes.
- [ ] Run `npm.cmd run check`, E2E, and `git diff --check`; report exact counts and blockers.
- [ ] Update readiness docs and roadmap with evidence, not assumptions.
