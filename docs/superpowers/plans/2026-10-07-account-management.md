# PriceApp account management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give store owners one PriceApp page to find accounts, invite employees by email, and safely manage app roles.

**Architecture:** Add an owner-scoped Postgres/RPC layer for app roles and auditing, plus a narrowly scoped backend Supabase Auth Admin adapter for Auth account listing and email invitations. Add typed Fastify endpoints and an owner-facing Next.js directory and invitation acceptance flow; all account data stays online and outside the catalog cache.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, TypeScript, Fastify 5, Supabase JS 2, Zod, Next.js 16.3, React 19, Vitest, Playwright, generated OpenAPI types.

**Spec:** `docs/superpowers/specs/2026-10-07-account-management-design.md`

## Global Constraints

- Existing app roles remain `owner`, `editor`, and `viewer`.
- An invited account starts as `viewer`; the invitee sets their own password from the email link.
- Only an `owner` can access account list, invitation, and role management endpoints.
- Role updates use an owner-checked database RPC, optimistic `expected_version`, and an atomic audit record.
- Auth Admin access is only for Auth account listing and invitation; it is not used for catalog, prices, profiles, or other app tables.
- Account list and mutations are online-only and are never stored in the browser's offline catalog cache.
- Price writes continue through audited RPCs with `expected_version`; offline behavior remains read-only.
- `prices.amount` remains authoritative and price or invoice logic must not divide, convert, or replace it.

## Review Focus

- **Non-owner API calls:** direct requests must fail with 403 before Auth Admin or role-management work is performed (Task 2 route tests).
- **Auth user without a profile:** it must appear as unassigned and gain a role only through the owner RPC (Tasks 1–2 tests).
- **Untrusted identity/metadata:** caller-supplied email never determines the target identity, and a requested role never bypasses the current caller's owner check (Tasks 1–2 tests).
- **Concurrent owner demotions and stale versions:** no transaction may remove the last owner, and stale `expectedVersion` must leave the role unchanged (Task 1 SQL tests).
- **Expired, replayed, or malformed invitation links:** the acceptance page must explain recovery and never show a password form without an established invite session (Task 3 tests).

---

### Task 1: Database role listing, provisioning, and audit RPCs

**Files:**
- Create: `supabase/migrations/202610070001_account_management.sql`
- Create: `supabase/tests/account_management.test.sql`

**Interfaces:**
- Produces `public.admin_list_accounts(p_user_ids uuid[])`, returning safe profile fields (`id`, `display_name`, `role`, `role_version`, `created_at`) only when `auth.uid()` is an owner.
- Produces `public.admin_set_account_role(p_user_id uuid, p_role public.app_role, p_expected_version integer)`, returning the changed target profile fields and rejecting unauthorized, stale, missing-user, invalid-role, and last-owner updates.
- Adds `profiles.role_version integer not null default 1`, an append-only `public.account_role_history` table, and a trigger that provisions only Auth users whose `invited_at` is set as `viewer`.

- [ ] **Step 1: Write SQL behavior checks** in `supabase/tests/account_management.test.sql` for owner-only listing, unassigned valid Auth users, default viewer provisioning for invited users, no role for ordinary signups, audited role change/version increment, stale version rejection, and last-owner rejection.
- [ ] **Step 2: Run the database checks against a local Supabase test database** with `npx supabase test db`; confirm the new checks fail before the migration exists.
- [ ] **Step 3: Implement the migration** with tight `SECURITY DEFINER` search paths and grants, owner validation inside both RPCs, and sorted locks on all current owner rows before the target role mutation and last-owner count.
- [ ] **Step 4: Re-run `npx supabase test db`** and confirm all account migration checks pass; also review that authenticated users cannot directly mutate profile roles or account audit rows.
- [ ] **Step 5: Commit** the migration and SQL checks.

### Task 2: Owner-only backend account API

**Files:**
- Create: `backend/src/schemas/admin-accounts.schema.ts`
- Create: `backend/src/repositories/auth-admin-client.ts`
- Create: `backend/src/services/admin-accounts.service.ts`
- Create: `backend/src/controllers/admin-accounts.controller.ts`
- Create: `backend/src/routes/v1/admin-accounts.routes.ts`
- Create: `backend/src/services/admin-accounts.service.test.ts`
- Create: `backend/src/routes/v1/admin-accounts.routes.test.ts`
- Modify: `backend/src/config/env.ts`, `backend/src/config/env.test.ts`, `backend/.env.example`, `backend/src/app.ts`, `backend/src/openapi/contract.ts`, and `docs/workspace-runbook.md`
- Regenerate: `backend/openapi/openapi.json` and `frontend/src/lib/api/generated/api-types.ts` with `npm run openapi:generate`

**Interfaces:**
- `AuthAdminClient.listUsers(page: number, perPage: number)` and `AuthAdminClient.inviteUserByEmail(email: string, redirectTo: string)` are the only elevated Auth operations exposed to services.
- `GET /api/v1/admin/accounts?page=1&pageSize=50` returns `{ accounts, page, pageSize, hasMore }`; optional `query` searches email and display name across Auth pages.
- `POST /api/v1/admin/accounts/invitations` accepts `{ email }` and returns `{ accountId, email, role: "viewer", invitationState: "pending" }` after Supabase accepts the email.
- `POST /api/v1/admin/accounts/:userId/invitations/resend` accepts no identity fields and returns the target account's pending invitation state.
- `POST /api/v1/admin/accounts/:userId/role` accepts `{ role, expectedVersion }` and returns `{ userId, role, roleVersion }`.

- [ ] **Step 1: Write failing env, service, and route tests** for missing admin config, valid pagination and email validation, merged profile/Auth rows, Auth failures, all four API operations, viewer denial before any Auth Admin call, caller-ID targeting, stale role conflicts, and errors that do not expose provider details.
- [ ] **Step 2: Run backend targeted tests** with `npm test --workspace backend -- admin-accounts`; confirm the new operation tests fail.
- [ ] **Step 3: Implement optional `SUPABASE_AUTH_ADMIN_KEY` and `SUPABASE_INVITE_REDIRECT_URL` config** and the isolated Auth Admin adapter. Do not export or pass its elevated Supabase client to profile, role, catalog, or price queries.
- [ ] **Step 4: Implement the service/controller/routes** using `app.authenticate`, then `app.requireRole("owner")`, caller-scoped RPCs for profile listing and role mutation, and the existing error envelope for safe Vietnamese errors. Search over paginated Auth results server-side and join profiles by Auth user ID.
- [ ] **Step 5: Add OpenAPI contracts and regenerate checked-in files** with `npm run openapi:generate`; verify `npm run openapi:check` and targeted backend tests pass.
- [ ] **Step 6: Commit** the backend API, generated contract, and runbook/env-example updates.

### Task 3: Account directory and invitation acceptance UI

**Files:**
- Create: `frontend/src/lib/api/accounts.ts` and `frontend/src/lib/api/accounts.test.ts`
- Create: `frontend/src/components/accounts-admin.tsx` and `frontend/src/components/accounts-admin.test.tsx`
- Create: `frontend/src/components/invite-acceptance.tsx` and `frontend/src/components/invite-acceptance.test.tsx`
- Create: `frontend/src/app/admin/accounts/page.tsx`
- Create: `frontend/src/app/auth/accept-invite/page.tsx`
- Modify: `frontend/src/components/price-app.tsx` and `frontend/tests/workspace-mocked.spec.ts`

**Interfaces:**
- The account API helpers use generated `ApiRequestBody` and `ApiResponse` types for the endpoints in Task 2.
- The directory loads paginated accounts, searches by email/display name, sends/resends invites, and changes roles with confirmation and `expectedVersion`; it does not write to `features/offline/cache.ts`.
- The acceptance route verifies the Supabase invite callback, establishes the session, then allows the invited employee to set a password; absent/expired/replayed links show a recovery message.

- [ ] **Step 1: Write failing UI/API tests** for pending/confirmed/unassigned rows, search and pagination, invite validation and confirmation, resend eligibility, role confirmation, 403/409/network states, and no offline cache writes. Test that the password form is absent until invite verification succeeds and that expired/replayed links show recovery guidance.
- [ ] **Step 2: Run frontend targeted tests** with `npm test --workspace frontend -- accounts-admin invite-acceptance`; confirm new interaction tests fail.
- [ ] **Step 3: Read the relevant Next.js 16.3 guides under `frontend/node_modules/next/dist/docs/`** before changing route pages, and implement the API helpers, owner page, navigation link, and invitation acceptance flow using the documented Supabase callback mechanism.
- [ ] **Step 4: Run frontend targeted tests** and the mocked desktop/mobile account workflows in `npm run test:e2e --workspace frontend`; confirm invite/role states and invite-link recovery work without a Supabase project.
- [ ] **Step 5: Commit** the account page, acceptance page, API helpers, and mocked tests.

### Task 4: Full regression and deployment readiness

**Files:**
- Modify: `docs/workspace-runbook.md` and `backend/.env.example` only if implementation-specific setup differs from Task 2.
- Verify: generated OpenAPI files, frontend/backend workspaces, and the new migration.

**Interfaces:**
- Deployment requires backend `SUPABASE_AUTH_ADMIN_KEY`, `SUPABASE_INVITE_REDIRECT_URL`, the redirect in Supabase Auth allowed URLs, and at least one trusted owner profile.
- Live invite, resend, redirect, RLS, RPC, and audit checks run only against an isolated Supabase test project; the current signed-in viewer account is not silently promoted.

- [ ] **Step 1: Run all repository gates** with `npm run check` and `npm run test:e2e`; fix regressions and record authenticated E2E skips if isolated test credentials are unavailable.
- [ ] **Step 2: Review the built frontend output** to confirm the Auth Admin key is absent from browser bundles and confirm account endpoints set `Cache-Control: private, no-store`.
- [ ] **Step 3: If isolated Supabase credentials are configured, apply the new migration and run the live invite, resend, acceptance, role audit, stale-version, and last-owner checks. Otherwise document this as an external deployment gate.**
- [ ] **Step 4: Commit** any final runbook changes and report the exact migration/configuration steps needed before enabling the feature.
