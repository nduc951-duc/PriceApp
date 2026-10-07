# PriceApp account management design

## Status

Design approved in chat; awaiting review of this written specification before planning or implementation.

## Problem and outcome

Staff access is currently managed by changing `public.profiles.role` manually in Supabase SQL. A missing profile or a role assigned to the wrong Auth user ID prevents staff from loading the catalog, and the current app has no account directory for owners.

Provide an owner-only **Tài khoản** page where a store owner can see existing Auth accounts, understand their app role and invitation state, invite a staff member by email, and change roles without editing SQL. Invitees set their own passwords from the email link; the store owner never sees or sends a password.

## Approved decisions

- Account administration is part of the existing PriceApp frontend/backend workspaces.
- Only an `owner` can access account list, invitation, and role management endpoints.
- Existing app roles remain `owner`, `editor`, and `viewer`.
- An invited account starts as `viewer`; an owner can change its role after invitation.
- Supabase Auth sends the invitation email. The invitee sets their own password.
- Role updates use an owner-checked database RPC, optimistic `expected_version`, and an atomic audit record.
- A narrowly scoped server-only Supabase Auth Admin key is approved for listing Auth accounts and sending invitations. It is not used to read or write catalog, prices, profiles, or other app tables.
- Existing price rules remain unchanged: price writes continue through audited RPCs with `expected_version`, and offline behavior remains read-only.

## User experience

### Account directory

Add an owner-only route at `/admin/accounts`, with a clear **Tài khoản** navigation entry. The page contains:

- Search by email or display name.
- A table showing email, display name when available, role, invitation/account state, and account creation time.
- A role selector for each account. A save action displays the current and proposed role and requires confirmation.
- A **Mời nhân viên** form that validates and submits an email address. It contains no password field.
- Clear states for loading, empty results, pending invitation, completed invitation, stale role conflict, duplicate/invalid email, insufficient permission, network failure, and Auth service unavailability.
- A **Gửi lại lời mời** action is available only for an unconfirmed invited account; confirmed accounts cannot be re-invited as new users.

The account list and mutations are online-only and are never stored in the browser's offline catalog cache.

### Invitation lifecycle

1. An owner enters an employee email and sends an invitation.
2. The backend asks Supabase Auth Admin to send the invite link.
3. The app shows the invited email and pending state. The account receives the `viewer` role by default.
4. The employee follows the email link, sets a password on PriceApp, and signs in.
5. The owner may later change the account to `editor` or `owner` from the directory.

The invite redirect must resolve to a dedicated PriceApp acceptance route, and that route must establish the Supabase session before showing the password form. The invite redirect must be included in the Supabase project's allowed redirect URLs. Expired and already-used invitation links receive a clear recovery message; the owner can request another invitation for an unconfirmed account. The backend uses the Auth Admin invite operation for this request and returns a clear conflict or recovery response if that Auth project does not permit re-inviting the pending user.

### Role safeguards

- Roles are limited to `owner`, `editor`, and `viewer`.
- An owner cannot change roles through direct table updates or by calling a frontend-only guard.
- The database RPC verifies `auth.uid()` is currently an owner, locks the relevant owner state, compares `expected_version`, writes the role, increments the version, and records actor, target, previous role, new role, and timestamp in one transaction.
- Reject stale versions with HTTP 409 and leave the displayed role unchanged.
- Reject any update that would leave the project with no owner. This includes concurrent attempts to demote separate owners.
- Accounts without a valid `profiles` row are shown as **Chưa phân quyền** and can be assigned a role by an owner. They cannot access catalog endpoints until the role assignment succeeds.

## Backend and data design

### API

Add owner-only endpoints under `/api/v1/admin/accounts`:

- `GET /api/v1/admin/accounts` returns the paginated Auth account list joined with the safe app profile fields and role version.
- `POST /api/v1/admin/accounts/invitations` validates an email and sends an invitation.
- `POST /api/v1/admin/accounts/:userId/invitations/resend` issues another invite only when the target Auth account remains unconfirmed; duplicate or unsupported pending invite behavior is mapped to a clear recovery response.
- `POST /api/v1/admin/accounts/:userId/role` accepts `{ role, expectedVersion }` and delegates role mutation to the caller-scoped audited RPC.

All routes run bearer-token validation and an owner-role check before account data is returned or an operation is attempted. Responses use the existing typed API/OpenAPI conventions and safe Vietnamese error mapping.

### Supabase boundary

- Add a server-only `SUPABASE_AUTH_ADMIN_KEY` and an explicit invite redirect URL configuration. The key may be Supabase's current secret key or the legacy service-role key for projects that have not migrated.
- Keep Auth Admin access behind a small backend adapter used only for `auth.admin.listUsers` and `auth.admin.inviteUserByEmail`, including the resend endpoint. Do not export a general elevated Supabase data client from that adapter.
- Continue to use the caller's JWT client for authorization and app data. Role listing is exposed through an owner-checked `SECURITY DEFINER` RPC; role changes also use a caller-scoped RPC. No account endpoint may query `profiles` with the Auth Admin key.
- Add a database trigger for Auth users created through invitation that creates a `profiles` row with the default `viewer` role and a role version. The trigger must distinguish invited users from ordinary sign-ups; an uninvited Auth account receives no app role and cannot access the catalog API.
- Add an atomic owner-only role-change RPC and an append-only account role audit table. The role change RPC may create a missing profile only for a real `auth.users` row. Grant only the required RPC execution permissions; retain RLS on `profiles` and the audit table.
- Account listing merges Auth Admin's paginated users with the owner-scoped profile RPC by user ID. The frontend never supplies a role claim or email as proof of identity.

Supabase documents `inviteUserByEmail` as a server-side Auth Admin operation requiring a secret key, and requires the redirect URL to be allowlisted. The invitee completes account setup from the emailed link: [Supabase Auth Admin invite](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail), [Supabase user management](https://supabase.com/docs/guides/auth/users).

### First-owner bootstrap

The directory cannot create its own first owner. Before account administration can be used, at least one Auth user must have an owner profile assigned through a trusted one-time Supabase SQL operation or an already authorized owner account. The current signed-in account `d6eeaffa-5aa6-4dbf-abe4-cde8d0c26ab7` is presently `viewer`; the previous owner approval concerned a different user ID. This feature does not silently promote either account.

## Failure and recovery behavior

- Invalid email and a duplicate confirmed Auth account return clear validation/conflict messages.
- Auth Admin 429, timeout, network, and 5xx responses map to a safe temporary-unavailable response. Do not expose provider response bodies, keys, or tokens.
- If an invitation succeeds but profile provisioning does not, report that the email was sent and show the account as unassigned; an owner can safely complete profile provisioning through the audited role RPC.
- If profile listing fails, do not return a partial list that could conceal owners or misrepresent access.
- The role editor does not optimistically change the displayed value before the RPC succeeds.

## Out of scope

- Admins setting, viewing, or transmitting passwords.
- Self-service registration, account deletion, account suspension, password reset, or email changes.
- Editing price data from the account page.
- Replacing the existing role names or changing their catalog/price/RAG permissions.
- Bootstrapping the first owner automatically.

## Acceptance criteria

1. An owner can see Auth accounts, including unassigned accounts, with correct email, role, and invitation state.
2. An owner can invite a new employee by email; the invite email points to the PriceApp password setup flow and the new account begins as `viewer`.
3. An owner can change an account role; a successful change increments its version and creates exactly one audit record.
4. A stale `expectedVersion`, missing/invalid role, non-owner caller, or last-owner demotion is rejected without changing the role.
5. A viewer cannot list accounts, invite users, or change roles, even by calling the API directly.
6. The service key is absent from frontend bundles, API responses, logs, and browser requests; it is used only by the Auth Admin adapter.
7. Invite acceptance establishes a session and lets the employee set their password without exposing an administrator-set password.
8. Account management data is not available offline and is not written to the catalog cache.
9. Lint, typecheck, unit tests, OpenAPI freshness, and production builds pass. Mocked desktop/mobile tests cover invite UI, role update, permission denial, conflict handling, and offline behavior.
10. Live Auth invitation, resend behavior, email redirect, RLS, RPC, and role audit behavior are verified only against a separately provisioned Supabase test project; never use production credentials for E2E writes.

## Deployment prerequisites and limits

- Configure `SUPABASE_AUTH_ADMIN_KEY` and the allowlisted invite redirect URL in the backend's secret environment before enabling invitation endpoints.
- Apply new timestamped Supabase migrations to the intended project after review; do not edit existing applied migrations.
- Provision a separate Supabase test project and invite test mailbox before accepting live invitation E2E.
- No database admin credential or isolated test project is currently available in this workspace, so migrations and live invitation cannot be applied or verified here.
