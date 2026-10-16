# Customer Order Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public customer price browsing/order-request flow while keeping employee features authenticated.

**Architecture:** Add narrow public catalog and order-request APIs backed by constrained SQL RPCs; store canonical server-computed price snapshots and protect customer data with RLS. The Next.js entry screen chooses customer or employee mode; customers get a public cart/form and owner/editor staff get a request inbox.

**Tech Stack:** Next.js, React, Fastify, Zod, Supabase/Postgres, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-customer-order-flow-design.md`

## Global Constraints

- Guests can view current retail and wholesale prices; dealer prices and internal supplier/source metadata stay private.
- Guest order totals are recomputed from current database prices; client totals are never authoritative.
- New requests begin as `pending_confirmation`; no payment, shipping charge, inventory decrement, or revenue entry occurs before store confirmation.
- Anonymous users may create requests but cannot read requests or customer contact data.
- Employee workspace access requires authentication; order PII is restricted to owner/editor.
- Keep the public customer request flow independent of the local employee invoice.

## Review Focus

- A public catalog call must omit supplier/source fields and dealer prices: test response allowlist.
- A changed/stale price must prevent an inaccurate request: test price-version conflict and no insert.
- Anonymous users must not retrieve customer requests after submission: test route authorization and database RLS.
- Wholesale minimum quantities must be honored when quantities change: test quote and submission boundary values.
- Unauthenticated employee selection must stop at the login form: browser test the mode gate.

---

### Task 1: Public catalog and customer request persistence

**Files:**
- Create: `supabase/migrations/202610160002_customer_order_requests.sql`
- Test: `backend/src/repositories/customer-orders.repository.test.ts`
- Create: `backend/src/repositories/customer-orders.repository.ts`

**Interfaces:**
- Produces `readPublicCatalog(client): Promise<PublicCatalogResponse>`, `createCustomerOrderRequest(client, input): Promise<CustomerOrderReceipt>`, and `listCustomerOrderRequests(client): Promise<CustomerOrderRequest[]>`.
- Catalog exposes active verified public retail/wholesale price rows only. Create RPC accepts contact details plus `{ priceId, version, quantity }[]`; it returns request ID/reference, canonical subtotal and snapshots, and `pending_confirmation`.

- [x] Write tests for public allowlist/filtering, server-side canonical subtotal, stale version rejection, below-minimum rejection, and immutable pending request snapshot.
- [x] Run `npm test --workspace backend -- customer-orders.repository.test.ts` and confirm the expected failures.
- [x] Add SQL tables, checks, indexes, RLS policies, and constrained `SECURITY DEFINER` RPCs; owner/editor-only inbox reads/updates; anonymous creation also requires a backend-only HMAC and one-time database nonce.
- [x] Implement repository mapping/RPC calls and pass the tests.
- [x] Run the targeted repository tests and inspect the SQL policy boundaries. Live database application and shared-secret configuration remain pending.

### Task 2: Public and employee API routes

**Files:**
- Create: `backend/src/schemas/customer-orders.schema.ts`
- Create: `backend/src/controllers/customer-orders.controller.ts`
- Create: `backend/src/routes/v1/customer-orders.routes.ts`
- Modify: `backend/src/app.ts`, `backend/src/openapi/contract.ts`, `backend/openapi/openapi.json`
- Test: `backend/src/routes/v1/customer-orders.routes.test.ts`

**Interfaces:**
- `GET /api/v1/public/catalog` returns only safe public catalog rows.
- `POST /api/v1/public/order-requests` validates contact, quantities and item count, recomputes the quote through the repository, and returns a receipt; cap anonymous submissions per IP.
- `GET /api/v1/customer-order-requests` and `PATCH /api/v1/customer-order-requests/:id` require owner/editor authorization.

- [x] Write API tests for anonymous public catalog, anonymous submission, invalid input, throttling, anonymous inbox denial, viewer denial, and owner/editor access.
- [x] Run the targeted route tests and confirm the expected failures.
- [x] Implement Zod schemas, controllers, routes, per-process IP rate limiting, signed RPC submission, and OpenAPI contracts.
- [x] Run targeted tests and `npm run openapi:check --workspace backend`.

### Task 3: Entry mode and customer shopping UI

**Files:**
- Create: `frontend/src/components/app-mode-gate.tsx`
- Create: `frontend/src/components/customer-storefront.tsx`
- Create: `frontend/src/features/orders/customer-cart.ts`, `frontend/src/features/orders/customer-cart.test.ts`
- Modify: `frontend/src/app/page.tsx`, `frontend/src/lib/api/client.ts`, `frontend/src/app/globals.css`
- Test: `frontend/tests/customer-order.spec.ts`

**Interfaces:**
- Entry lets the user choose `customer` or `employee`; employee mode renders existing `AuthGate`, customer mode renders `CustomerStorefront`.
- Cart stores `priceId`, `version`, and package quantity only. UI estimates use returned canonical quote rows and are refreshed by the server before final submission.
- Contact form requires customer name and phone; delivery address and notes are optional.

- [x] Write cart tests for adding/removing quantities, price-tier selection, minimum quantities, and formatted subtotal; write browser tests for guest mode, employee login gate, responsive catalog/cart, and submit confirmation.
- [x] Run the targeted tests and confirm the expected failures.
- [x] Implement accessible Vietnamese customer flow with retail/wholesale labels, clear package units/minimums, and pending-confirmation/no-shipping-fee copy.
- [x] Run targeted tests and inspect at desktop and mobile viewport sizes.

### Task 4: Staff request inbox

**Files:**
- Create: `frontend/src/components/customer-order-inbox.tsx`
- Create: `frontend/src/lib/api/customer-orders.ts`
- Modify: `frontend/src/components/price-app.tsx`, `frontend/src/components/auth-actions-context.tsx`
- Test: `frontend/tests/customer-order.spec.ts`

**Interfaces:**
- Owner/editor staff can list requests and mark them contacted, confirmed, or cancelled. Viewer users cannot see customer contact data or mutate request status.
- Customer references and submitted price/item snapshots remain visible for staff follow-up.

- [x] Write browser/API client tests for inbox visibility, empty/loading/error states, PII access boundaries, and allowed status transitions.
- [x] Run the targeted tests and confirm the expected failures.
- [x] Implement inbox navigation and request follow-up actions using the authenticated API.
- [x] Run targeted tests.

### Task 5: Full verification and operator notes

**Files:**
- Modify: `docs/workspace-runbook.md`
- Verify: frontend and backend projects, migration deployment requirements

- [x] Run `npm.cmd run check` and `npm.cmd run test:e2e` where the configured environment supports them.
- [x] Run customer browser tests at desktop and mobile viewport widths; inspect Vietnamese font rendering and price/cart hierarchy.
- [x] Document how to apply the new migration and validate the anonymous catalog/request permissions.
- [x] Report external Supabase migration/deployment steps separately because database tooling/credentials are not configured here.
