# 13-page RAG operator workbench

## Purpose

Prepare all 13 photographed price-book pages for RAG through a repeatable OCR and review workflow. A signed-in staff member can run OCR and edit a draft; an owner remains responsible for approving transcribed prices and starting embedding/indexing. The page should feel like a focused store-operations tool, work on desktop and mobile, and render Vietnamese text reliably.

## Confirmed context

- The repository contains `frontend/public/source-pages/page-01.jpg` through `page-13.jpg`.
- The existing `/rag-admin` screen can OCR one selected image, preview chunks, edit/import individual chunks, save a draft, and fall back from a missing bundled image to a signed Supabase URL.
- API access for page listing, OCR, chunk preview, and draft save is authenticated-user access. Approval, rejection, verified-variant linking, diagnostics, and indexing remain owner-only.
- The default record chunker carries headings and source spans. Only approved page text and verified catalog rows may enter the embedding index; prices continue to come from SQL at query time.
- `glm-ocr:latest` and `bge-m3:latest` are present on the local Ollama host. Existing workflow notes report that GLM-OCR can misread handwritten values, so its output is never treated as verified.
- The migration `202610160001_rag_ocr_for_authenticated_users.sql` is in the workspace but has not been applied to the remote Supabase project. Remote source rows and RLS behavior still need verification.
- The most recent local `npm run check` passed. Mocked Playwright covered desktop and mobile; authenticated integration tests were skipped because a separate E2E project and test accounts were not configured.

## Workflow

1. Load all source-page records and show the 13-page queue with review/index state and source image.
2. Offer a sequential “OCR pages without a transcript” action. Process one image at a time with the configured Ollama OCR model so the local inference host is not flooded.
3. For each successful page, normalize and chunk the OCR text with the existing record chunker, then persist it as a draft. Show per-page progress and preserve successful drafts if a later page fails. Let the queue continue after a page-level failure and report which page needs a retry.
4. Never batch-overwrite an approved/rejected page or a non-empty draft. Report these as skipped. A deliberate re-scan is a separate page-level action and must retain the existing text until the user chooses to replace it.
5. Keep the source image beside editable OCR chunks. Preserve headings and source spans; flag model uncertainty (`[?]`) and let staff edit/import chunks into the page transcript.
6. Make save state visible. Draft edits remain out of retrieval. Only an owner can approve/reject a page or rebuild embeddings; approval is an explicit human action after comparing handwritten amounts with the source photo.

## Interface direction

Use a restrained operations-workbench layout consistent with the existing PriceApp palette: a compact page queue with clear statuses, a readable source-photo/transcript workspace, and controls grouped by the work staff actually performs. On wide screens keep the source visible while editing; on narrow screens stack the image and transcript, preserve usable touch targets, and avoid horizontal page overflow. Make page progress, draft state, and approval state distinct without decorative AI labels, gradients, or decorative dashboard metrics.

Remove runtime dependence on remote font loading for core readability. Use a locally available Vietnamese-capable sans-serif stack for body/interface text and a tabular-number stack for prices/IDs. Keep display styling restrained and ensure every visible label with Vietnamese diacritics survives the fallback stack. References inform workflow clarity, not copied branding: Shopify POS describes a unified product/variant catalog and inventory view; Square documents receiving/counting inventory directly from the POS ([Shopify POS](https://www.shopify.com/pos/features), [Square Retail inventory](https://squareup.com/us/en/square-university/inventory/manage-inventory-from-the-pos-with-square-for-retail)).

## Safety and failure behavior

- OCR output is untrusted draft text. It must never set `review_status` to approved or call the index endpoint.
- The batch action skips any row that has existing text or a reviewed status. Individual re-scan must require an explicit replace action and keep the old transcript recoverable until replacement is saved.
- A failed image fetch, OCR request, draft save, or page-list request must produce a page-specific status and retry path; successful earlier pages remain saved.
- Signed-in user access remains limited to OCR, page text, preview, and draft updates. Owner-only actions retain their current checks in both API and database policy.
- Apply and verify the migration in an isolated Supabase test project before running real-user E2E. Do not run integration tests against the production project.

## Verification and acceptance

- All 13 expected page numbers can be matched to source-page rows and bundled/signed images.
- A batch run processes eligible pages sequentially, persists only drafts, skips existing/reviewed text, and continues/report failures without discarding completed drafts.
- Unit and API tests cover page selection, permission boundaries, non-overwrite behavior, source spans, and page-level failure/retry.
- Authenticated user tests prove staff can load sources, OCR, edit, and save drafts while they cannot approve/index; owner tests prove the approval/index path remains available.
- Browser tests cover the complete workflow at desktop and mobile sizes, Vietnamese strings, keyboard focus, clear status feedback, no clipped controls, and no horizontal overflow.
- The existing lint, typecheck, unit/API suite, OpenAPI check, production build, and mocked E2E suite pass. Real-user E2E results are reported separately from mocks.
- No transcript is counted as retrieval-ready until an owner has checked it against its photographed source, approved it, and rebuilt/verified the index.

## Dependencies to resolve before live verification

- Apply the OCR-access migration to the isolated test project, then the intended application project.
- Configure `PRICEAPP_E2E_ENABLED`, `PRICEAPP_E2E_PROJECT_REF`, `PRICEAPP_E2E_SUPABASE_URL`, `PRICEAPP_E2E_SUPABASE_PUBLISHABLE_KEY`, `PRICEAPP_E2E_OWNER_EMAIL`, `PRICEAPP_E2E_OWNER_PASSWORD`, `PRICEAPP_E2E_EMPLOYEE_EMAIL`, and `PRICEAPP_E2E_EMPLOYEE_PASSWORD` from a dedicated non-production test project. Keep these secrets out of chat and version control.
- Compare and approve handwritten amounts before indexing. The OCR model cannot establish price correctness on its own.
