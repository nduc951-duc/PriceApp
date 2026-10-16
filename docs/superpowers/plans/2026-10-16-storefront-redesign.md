# Storefront redesign implementation plan

**Goal:** Implement `design.md` using the existing Flowbite React library.
**Architecture:** Dedicated public shop and employee entry routes; composed product rows and a shared cart panel in a desktop aside or mobile Drawer. Preserve server pricing and auth rules.
**Execution:** Inline, requested by the user with “chạy làm lại giao diện đi”. Existing feature branch includes the in-progress product; preserve its changes. No new dependencies.

## Tasks

- [x] Add local Playwright config and failing tests: API error must not render an empty catalog/count, product quantity and price units visible, mobile cart Drawer and separate contact step, stylesheet/layout checks.
- [x] Replace role selector with compact Flowbite controls; add `/shop` and `/staff` entry routes; preserve existing authenticated paths.
- [x] Rebuild customer layout: searchable header, grouped product rows, tier filter, explicit unit/minimum quantity, separate review/contact step, sticky mobile cart.
- [x] Remove legacy customer control overrides; unify neutral/blue theme in POS, auth and RAG without altering their data flows.
- [x] Run targeted browser tests, lint/typecheck/unit/build and full Playwright suite. Capture desktop/mobile fixture screenshots and inspect them. Stop dev before production build; restart afterwards.

## Review focus

Loading versus empty versus network failure; wholesale minimums and unchanged unit amounts; long Vietnamese names on mobile; missing or changed prices in a cart; focus/scroll behavior when opening and closing the cart.

## Progress

Plan written before implementation. No database or API schema changes required.

Verification: `npm run check` passed with 108 frontend tests, 178 backend tests and 2 dev-runner tests. Final lint and production build passed. Final root `npm run test:e2e`: 40 passed, 12 skipped (isolated Supabase integration credentials unavailable).

Review fixes: confirmed submissions immediately clear the persisted public draft; adding/editing lines is disabled while submitting. Both reproduced with failing browser assertions before fixes. Screenshot review also found and fixed queue-button overflow in RAG and employee-header overflow at laptop widths.

Cache ruling: use the existing feature checkout because it contains the authorized in-progress application and numerous uncommitted changes. No unrelated changes reverted. Development service workers are unregistered and app asset caches removed to prevent stale HMR CSS; production keeps offline shells for the new routes. Production offline reload remains covered by Playwright.

Scope: the storefront is rebuilt; staff login/inbox, shared theme/navigation and RAG queue/header are updated. The existing pricing and OCR backend behavior are preserved. Live Supabase connectivity is not represented by fixture test success.
