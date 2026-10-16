# 13-page RAG operator workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** OCR all eligible source pages in a safe sequential queue, persist transcriptions as editable drafts, and give staff a clear Vietnamese-language review workspace with tested desktop/mobile behavior.

**Architecture:** Keep the existing authenticated OCR, preview, and page-save APIs. Add a small tested frontend queue runner that chooses only empty draft pages, executes one page at a time, saves each success as a draft, and records per-page failures without losing earlier work. Keep owner approval and indexing separate. Simplify runtime typography to a locally available Vietnamese-capable system stack and test the actual page at desktop/mobile sizes.

**Tech Stack:** Next.js 16, React, TypeScript, Tailwind/CSS, Fastify, Supabase RLS, Ollama `glm-ocr:latest`, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-16-rag-13-page-operator-workbench-design.md`

## Global Constraints

- Only a signed-in user may list source text, run OCR, preview chunks, and save drafts.
- OCR and batch processing never approve, reject, link product variants, or index content.
- Batch processing is sequential and only selects pages whose review status is `draft` and whose `extractedText` is empty after trimming.
- Existing draft text and any reviewed page are preserved; a single-page re-scan must explicitly confirm replacement and keep the old transcript until the replacement saves.
- Each successful page is saved before processing the next page; one page failure does not discard completed drafts or stop later eligible pages.
- Only owner-approved OCR and verified catalog rows are retrieval input; current prices remain SQL data.
- Do not place secrets in source control or chat, and never point authenticated integration tests at production.

## Review Focus

- A non-empty or approved page is skipped by batch OCR and remains unchanged; assert the skip reason and no save request.
- A page's image/OCR/save request fails; assert a visible page-level retry state and that later pages still process.
- Two pages cannot OCR concurrently; assert the queue runner's observed maximum in-flight count is one.
- OCR output contains headings, long rows, Vietnamese diacritics, and `[?]`; assert chunk headings and source spans remain stable through edit/import/save.
- The viewport is narrow or remote fonts are unavailable; assert controls do not overlap/clip, the page has no horizontal overflow, and Vietnamese text remains legible in the system font stack.

---

### Task 1: Lock the page eligibility and sequential queue behavior

**Files:**
- Create: `frontend/src/features/rag/ocr-batch.ts`
- Create: `frontend/src/features/rag/ocr-batch.test.ts`

**Interfaces:**
- Consumes page values with `sourcePageId`, `reviewStatus`, and `extractedText`.
- Produces `selectOcrBatchPages(pages)`, returning eligible empty drafts and skipped page IDs with reasons (`existing-draft` or `reviewed`).
- Produces `runSequentialOcrBatch(pages, processPage, onResult)`, returning one `saved` or `failed` result per eligible page while continuing after a page-level error.

- [ ] **Step 1: Write failing tests** named `selects only empty draft pages`, `skips pages with existing text or reviewed status`, `processes one page at a time`, and `continues after one page fails`.
- [ ] **Step 2: Run the tests and verify the expected failures** with `npm.cmd run test --workspace frontend -- src/features/rag/ocr-batch.test.ts`.
- [ ] **Step 3: Implement the two queue functions** in `frontend/src/features/rag/ocr-batch.ts` with a serial loop and a per-page result callback.
- [ ] **Step 4: Run the tests and verify every case passes** with the same command.
- [ ] **Step 5: Commit only the queue helper and its test** with message `feat: add safe sequential RAG OCR queue`.

### Task 2: Persist one page at a time as a draft

**Files:**
- Modify: `frontend/src/components/rag-admin.tsx`
- Modify: `frontend/tests/rag-ocr.spec.ts`
- Modify: `backend/src/services/rag-pages.service.test.ts` only if a required API boundary is not already covered

**Interfaces:**
- Consumes the queue runner from Task 1 and existing `Page`, `SavePageInput`, OCR, preview, and page-save API types.
- Produces a batch action that fetches each eligible local image (with signed-URL fallback), requests OCR, normalizes/previews the returned text, and saves the page using `reviewStatus: "draft"` before advancing.
- Owner-only approval/index controls remain unchanged and inaccessible to viewer/editor roles.

- [ ] **Step 1: Add failing browser coverage** for a 13-page queue where empty draft pages save in order, existing text/approved pages are skipped, and one OCR failure does not stop later pages.
- [ ] **Step 2: Run the OCR E2E spec and verify it fails** at the absent batch action/result behavior with `npm.cmd run test:e2e --workspace frontend -- tests/rag-ocr.spec.ts`.
- [ ] **Step 3: Add queue state and page-specific progress/results** to `RagAdmin`; call existing OCR, preview, and draft-save APIs for one page at a time.
- [ ] **Step 4: Run the targeted OCR E2E spec** and verify successful pages are saved as drafts, failed/skipped rows are identified, and no request uses `approved` or calls the index endpoint.
- [ ] **Step 5: Commit the component and browser test** with message `feat: process eligible RAG pages as OCR drafts`.

### Task 3: Make the 13-page queue safe to review and retry

**Files:**
- Modify: `frontend/src/components/rag-admin.tsx`
- Modify: `frontend/tests/rag-ocr.spec.ts`
- Modify: `backend/src/routes/v1/rag.routes.test.ts` only if the existing viewer-route coverage misses draft-save or owner-only boundaries

**Interfaces:**
- Consumes batch results and page state from Task 2.
- Produces a page queue showing page number, source availability, not-started/processing/draft/reviewed/error state, and a retry action for failed pages. Show indexed state only to owners.
- Produces a guarded single-page re-scan action that does not replace existing text until an explicit confirmation and successful draft save.

- [ ] **Step 1: Add failing browser tests** named `shows per-page progress and retry`, `keeps completed drafts when another page fails`, and `requires confirmation before replacing an existing draft`.
- [ ] **Step 2: Run the OCR E2E spec and verify those assertions fail** before UI implementation.
- [ ] **Step 3: Implement queue status, skip reasons, retry, and guarded re-scan** without adding database columns or changing approval semantics.
- [ ] **Step 4: Run the targeted OCR E2E spec** and verify retry only resubmits the failed page and never changes a reviewed page.
- [ ] **Step 5: Commit these queue safety changes** with message `feat: add RAG OCR retry and review states`.

### Task 4: Improve Vietnamese typography and operator layout

**Files:**
- Modify: `frontend/src/app/layout.tsx`
- Modify: `frontend/src/app/globals.css`
- Modify: `frontend/src/components/rag-admin.tsx`
- Modify: `frontend/tests/rag-ocr.spec.ts`

**Interfaces:**
- Consumes the existing PriceApp color tokens and queue behavior from Task 3.
- Produces a responsive two-pane source/photo and transcript workspace on wide screens, a stacked touch-friendly workspace on mobile, and a local/system font stack that does not depend on Google Fonts at runtime.
- Uses workflow references from Vietnamese retail software: grouped product/page lists, explicit statuses, and readable price/variant information; it does not copy their branding.

- [ ] **Step 1: Add failing visual/browser assertions** for Vietnamese diacritics, focus order, visible save/progress state, and no horizontal overflow at 1440px and 390px viewport widths.
- [ ] **Step 2: Run the OCR E2E spec and confirm the new layout assertions fail** against the current screen/font setup.
- [ ] **Step 3: Remove remote runtime font links, define Vietnamese-capable system/body and tabular-number stacks, and adjust only the OCR operator layout** to fit the stated viewports.
- [ ] **Step 4: Run the targeted E2E spec and lint** with `npm.cmd run test:e2e --workspace frontend -- tests/rag-ocr.spec.ts` and `npm.cmd run lint --workspace frontend`; inspect desktop/mobile screenshots for clipped text and controls.
- [ ] **Step 5: Commit the typography/layout and browser checks** with message `style: refine Vietnamese RAG review workspace`.

### Task 5: Verify RLS and authenticated user journeys in an isolated Supabase project

**Files:**
- Modify: `frontend/tests/workspace-integration.spec.ts`
- Modify: `frontend/tests/rag-ocr.spec.ts`
- Modify: `scripts/test-e2e.mjs` only if secret validation needs to require the employee test account
- No production migration edits; verify `supabase/migrations/202610160001_rag_ocr_for_authenticated_users.sql` as written.

**Interfaces:**
- Consumes the isolated project variables `PRICEAPP_E2E_ENABLED`, `PRICEAPP_E2E_PROJECT_REF`, `PRICEAPP_E2E_SUPABASE_URL`, `PRICEAPP_E2E_SUPABASE_PUBLISHABLE_KEY`, `PRICEAPP_E2E_OWNER_EMAIL`, `PRICEAPP_E2E_OWNER_PASSWORD`, `PRICEAPP_E2E_EMPLOYEE_EMAIL`, and `PRICEAPP_E2E_EMPLOYEE_PASSWORD`.
- Produces real-user evidence for employee OCR/draft save, forbidden employee approval/index, and owner approval/index access. It must fail fast if configured against production.

- [ ] **Step 1: Add failing authenticated tests** for employee page load/OCR/draft save and owner-only approval/index restrictions, using the isolated test accounts.
- [ ] **Step 2: Apply pending migrations only to the isolated test project** and verify the OCR RLS policy permits reads/inserts/draft updates while preventing changes to approved rows.
- [ ] **Step 3: Run authenticated browser tests** with `npm.cmd run test:e2e` under the isolated E2E environment and verify the tests execute rather than skip.
- [ ] **Step 4: Run the mocked suite and full code checks** with `npm.cmd run check` and `npm.cmd run test:e2e`; report real-user and mocked results separately.
- [ ] **Step 5: Commit only test changes** with message `test: cover authenticated RAG OCR workflows`.

### Task 6: Run OCR for the 13 eligible pages and verify the stored drafts

**Files:**
- No repository edits unless execution reveals a defect; any defect returns to its owning task and uses TDD.
- Data target: the 13 `source_pages` rows and `rag_page_texts` draft records in the intended Supabase project.

- [ ] **Step 1: Confirm the 13 remote source rows map to page-01 through page-13** and that the authenticated OCR migration is applied; do not create duplicate source rows.
- [ ] **Step 2: Sign in through the authorized application session and run `OCR pages without a transcript`**; process pages serially and leave all generated text in draft state.
- [ ] **Step 3: Verify 13 page results** with per-page model, draft revision, chunk count, source spans, and OCR error/uncertainty states; do not approve or index.
- [ ] **Step 4: Run browser checks at desktop and mobile sizes** and verify the rendered source, Vietnamese text, page statuses, retry path, and lack of horizontal overflow.
- [ ] **Step 5: Present the draft-review result** with uncertain values identified for owner review before any approval/index operation.

## Environment gate

Live RLS and authenticated browser tests require a separate non-production Supabase project, its publishable key, and owner/employee test accounts. Do not send passwords through chat; configure them only in the local test environment or approved secret store. The local OCR model is present, but access to the intended Supabase project and an authenticated application session are required to persist the 13 drafts.
