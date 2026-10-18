# RAG Product Variant Listing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let customers and staff ask how many verified product variants the store has and see every variant’s current applicable price, including an explicit no-current-price label.

**Architecture:** Detect explicit list/count intent separately from ordinary price questions. Use existing RAG results as bounded seed variant IDs, then expand to the full verified product group through a scoped public SQL RPC for guests or the existing authenticated/RLS path for staff. Format count and prices deterministically from SQL-backed rows.

**Tech Stack:** TypeScript, Fastify, Supabase PostgreSQL migrations and SQL regression scripts, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-rag-product-variant-listing-design.md`

## Global Constraints

- Count distinct variants only when the variant, product, and category are active and the variant is verified.
- Count verified variants without a current price and label each one “Chưa có giá hiện hành”.
- Public prices come only from active, current retail/wholesale rows; do not expose dealer prices or direct table reads to `anon`.
- Use only the existing authenticated/RLS path for staff; never fabricate a user identity.
- Preserve ordinary ambiguous-price clarification, explicit comparison, current order validation, existing RLS, and worker ACLs.
- Apply SQL regression only to Supabase local or another isolated database; do not reset local DB without explaining that it deletes/recreates its data, and do not apply this migration to production.

## Review Focus

- Unaccented or incomplete list wording could fail to activate list intent; test Vietnamese accented/unaccented count/list phrases and keep “giá tắc kê đạn bao nhiêu?” on clarification.
- A verified seed without a price could be dropped before group expansion; test that it can identify the group and remains counted.
- Similar product groups could be combined; test that multiple plausible groups return clarification with no mixed prices.
- Expired, inactive, sample, or dealer prices could leak into the public list; assert all are absent from anon RPC results.
- Invalid or unverified seed IDs could expose a sibling group; test that invalid seeds return no rows and existing table/RPC ACLs and worker RLS remain intact.

---

### Task 1: List intent and deterministic answer formatting

**Files:**
- Create: `backend/src/rag/variant-list-intent.ts`
- Test: `backend/src/rag/variant-list-intent.test.ts`
- Modify: `backend/src/rag/price-answer.ts`
- Test: `backend/src/rag/price-answer.test.ts`

**Interfaces:**
- Produces: `isVariantListIntent(question: string): boolean`.
- Produces: `variantListAnswer(items: Item[]): string`, where each `Item` uses product name, variant, source page numbers, and the existing SQL-backed price fields.

- [ ] **Step 1: Add failing intent tests** for “có bao nhiêu loại tắc kê đạn”, “các quy cách tắc kê đạn giá bao nhiêu”, their unaccented forms, and ordinary “giá tắc kê đạn bao nhiêu”.
- [ ] **Step 2: Run the focused test** with `npm.cmd test --workspace @price-app/backend -- src/rag/variant-list-intent.test.ts`; confirm only explicit list/count wording is recognized.
- [ ] **Step 3: Implement `isVariantListIntent`** using normalized Vietnamese text and a small explicit phrase set; do not infer list intent from “bao nhiêu” alone.
- [ ] **Step 4: Add failing formatter tests** proving the answer counts all variants, lists each variant’s current price/unit/source, and labels no-price variants.
- [ ] **Step 5: Implement `variantListAnswer`** in `backend/src/rag/price-answer.ts`, using only fields in the returned items and never omitting an item with an empty `prices` array.
- [ ] **Step 6: Run both focused test files** and confirm they pass.

### Task 2: Scoped public variant-group RPC and SQL regression

**Files:**
- Create: `supabase/migrations/202610180004_public_rag_variant_group_listing.sql`
- Modify: `supabase/tests/public_catalog_and_rag_acl.sql`

**Interface:**
- Produces: `public.list_public_rag_product_variants(p_seed_variant_ids bigint[])` returning flat rows with `product_id`, `product_name`, `category_name`, `product_aliases`, `variant_id`, `display_name`, `raw_specification`, `source_pages`, nullable packaging fields, and nullable current-price fields (`price_id`, `price_version`, `price_amount`, `price_type`, `minimum_quantity`, `price_list_name`, `supplier_name`).
- Input seed array cardinality is 1–8. Resolve seeds only when active and verified; expand only their active, verified siblings under the same active products/categories.
- Emit a row for a variant with no eligible current price; return only current active retail/wholesale prices for public calls.

- [ ] **Step 1: Extend the SQL regression fixture/assertions first** to create a verified priced seed, a verified sibling without a current price, and an ineligible sibling; assert exact distinct count, no-price row retention, current-price filtering, invalid-seed rejection, and the new RPC’s ACL.
- [ ] **Step 2: Run the regression on an already-running Supabase local database** with `supabase test db supabase/tests/public_catalog_and_rag_acl.sql`; it must fail because the new RPC is absent. Do not run `db reset`.
- [ ] **Step 3: Add the migration** with a narrowly scoped `SECURITY DEFINER` RPC, fixed `search_path`, qualified base objects, active/verified/product/category checks, source filtering consistent with current public source rules, nullable current price joins, and exact `anon`-only execute grant. Revoke from `PUBLIC` and `authenticated`; do not change table grants, RLS, existing RPCs, or worker privileges.
- [ ] **Step 4: Re-run the SQL regression locally**; verify the function returns the whole eligible group, counts no-price variants, excludes ineligible prices/variants, denies direct `anon` table reads, denies `authenticated` execution, and leaves worker ACL/RLS assertions green. All fixture writes must roll back.

### Task 3: Repository expansion for public and staff callers

**Files:**
- Modify: `backend/src/repositories/rag-catalog.repository.ts`
- Create: `backend/src/repositories/rag-catalog.repository.test.ts`

**Interfaces:**
- Produces: `RagCatalogVariant` with `{ productId: number; productName: string; categoryName: string; productAliases: string[]; variantId: number; displayName: string; rawSpecification: string | null; sourcePages: number[]; packagingOptions: Array<{ id: number; name: string; quantity: number; unit: string; note: string; prices: Array<{ id: number; version: number; amount: number; priceType: string; minimumQuantity: number; packageQuantity: number; priceList: string | null; supplier: string | null }> }> }`.
- Produces: `expandVerifiedGroups(seedVariantIds: number[]): Promise<RagCatalogVariant[]>`; public mode calls only the new RPC, while staff mode resolves seed product IDs and loads sibling variants through the authenticated Supabase client under existing RLS.

- [ ] **Step 1: Add failing repository tests** for flattening/grouping public rows with nullable price/package columns and for calling the public RPC only in public mode.
- [ ] **Step 2: Add a failing staff-path test** proving seed product IDs expand to verified siblings through ordinary authenticated table queries, without calling a public RPC or using privileged credentials.
- [ ] **Step 3: Run the repository test file** and confirm the new method is missing or returns the wrong grouped shape.
- [ ] **Step 4: Implement `expandVerifiedGroups(seedVariantIds)`** for both modes, normalize public rows to the same internal variant shape, and preserve existing price filters and RLS boundaries.
- [ ] **Step 5: Re-run the repository tests** and confirm no-price variants remain represented with `prices: []`.

### Task 4: RAG service list/count path

**Files:**
- Modify: `backend/src/services/rag-query.service.ts`
- Test: `backend/src/rag/query.test.ts`

**Consumes:**
- `isVariantListIntent(question)` from Task 1.
- `expandVerifiedGroups(seedVariantIds)` from Task 3.
- `variantListAnswer(items)` from Task 1.

- [ ] **Step 1: Add failing service tests** for a single group with priced and unpriced siblings, asserting exact count, every variant and price/unit/source, and `answered` status.
- [ ] **Step 2: Add failing tests** that multiple supported product groups clarify without mixing items/prices, an unrelated result is rejected, and “giá tắc kê đạn bao nhiêu?” still asks for a specification.
- [ ] **Step 3: Run `npm.cmd test --workspace @price-app/backend -- src/rag/query.test.ts`** and confirm the list/count cases fail before implementation.
- [ ] **Step 4: Implement the list path** after retrieval and before price-only public catalog expansion; validate/filter seeds, resolve one product group, preserve all verified siblings, attach current sources/prices, and use deterministic formatting. Return `clarify` with empty items for multiple groups and `insufficient_evidence` when no group is supported.
- [ ] **Step 5: Re-run the query service tests** and confirm existing single-price, comparison, citation, and abstention tests remain green.

### Task 5: Customer/staff browser coverage and final verification

**Files:**
- Modify: `frontend/tests/customer-rag-query.spec.ts`
- Modify: `frontend/tests/rag-query-ui.spec.ts`
- Modify only if required by verified failures: `frontend/src/components/price-question-assistant.tsx`

- [ ] **Step 1: Add customer browser coverage** for a list/count response with one priced and one unpriced variant; assert both render, the exact count is visible, and only the priced variant has an add-to-order action.
- [ ] **Step 2: Add staff browser coverage** for the same list/count behavior and confirm staff selection links remain limited to variants with eligible prices.
- [ ] **Step 3: Run targeted desktop/mobile browser tests** against the local app with mocked API responses using `npm.cmd run test:e2e --workspace @price-app/frontend -- --config=playwright.local.config.ts -g "variant listing"`.
- [ ] **Step 4: Run `npm.cmd run check` and `git diff --check`**; confirm lint, typecheck, unit tests, OpenAPI check, and production builds pass.
- [ ] **Step 5: Record database verification separately**: SQL regression is complete only if it ran on Supabase local or an explicitly isolated database. If local Supabase is unavailable, report that blocker; do not apply the migration remotely or reset local data without first explaining the data loss.

## Self-review

- Spec coverage: intent classification and deterministic formatting are Task 1; exact SQL expansion and ACL are Task 2; customer/staff repository boundary is Task 3; ambiguity, no-price counts, and unchanged ordinary price behavior are Task 4; user-facing list rendering and final checks are Task 5.
- Interface consistency: Task 1 exports `isVariantListIntent` and `variantListAnswer`; Task 3 exports `expandVerifiedGroups`; Task 4 consumes these exact names. The RPC signature and result fields are fixed in Task 2.
- Review focus: all five failure modes above have explicit tests in Tasks 1–4.
- Proportion: five tasks cover one vertical feature while keeping SQL/RLS, repository mapping, query orchestration, and browser behavior reviewable as separate deliverables.
