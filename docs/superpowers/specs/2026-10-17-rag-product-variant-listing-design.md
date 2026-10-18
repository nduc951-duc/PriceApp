# RAG Product Variant Listing Design

## Goal

Let customers and staff ask questions such as “Cửa hàng có bao nhiêu loại tắc kê đạn?” and “Các quy cách tắc kê đạn giá bao nhiêu?”. The answer must count every active, verified variant in the uniquely identified product group, show current SQL prices where available, and explicitly label variants without a current price.

Keep ordinary broad price questions such as “Tắc kê đạn giá bao nhiêu?” on the existing clarification path. Do not let the model invent product counts, variants, prices, packaging, units, or sources.

## Current behavior and constraint

- `backend/src/services/rag-query.service.ts` detects price questions, searches the catalog and RAG chunks, and asks the user to choose when a broad price query matches multiple variants.
- `backend/src/repositories/rag-catalog.repository.ts` requests at most eight lexical candidates for both public and staff searches.
- The public `search_public_rag_catalog` and `get_public_rag_catalog` RPCs in `202610180001_public_customer_rag_query.sql` cap each call at eight variant IDs. `get_public_rag_catalog` also inner-joins current prices, so variants without a current price are omitted.
- The existing UI renders each returned item and its prices. Customer add-to-order actions only appear when a price is present; staff selection links remain on the employee path.

Changing only the answer prompt would therefore produce incomplete or inaccurate counts. The feature needs a distinct list intent and a SQL-backed group expansion path.

## User flow

1. The user asks for the number of types, all variants/specifications, or prices for all specifications of a named product.
2. Existing lexical/vector retrieval identifies verified candidate variants. Existing hard filters and named-candidate checks reject unrelated products and conflicting explicit specifications.
3. If candidates identify exactly one product group, the backend expands them to every active, verified sibling variant in that group.
4. The answer states the exact number of variants and lists each specification. Each row shows current applicable prices, packaging quantity/unit, minimum quantity when applicable, and available source references. A verified variant with no current public price remains in the count and is labelled “Chưa có giá hiện hành”.
5. If candidates identify multiple product groups, the assistant asks the user to choose a group before listing. If no group is sufficiently supported, it reports insufficient evidence.
6. For a plain broad price question without an explicit list/count request, the current specification clarification behavior remains unchanged.

## Answer and data rules

- A list/count intent is explicit: wording such as “có bao nhiêu loại”, “có những quy cách nào”, “liệt kê quy cách”, or “giá các quy cách”. A lone “giá [product] bao nhiêu” is not a list intent.
- Counts include distinct product variants that are active, verified, and belong to an active product and category. Variants without a valid current price still count, as approved by the user.
- Public customer results include only current, active retail and wholesale prices already permitted by the public catalog contract. Do not expose dealer prices or add direct table access for `anon`.
- Staff results use the existing authenticated catalog path and its existing role/RLS behavior, including staff-visible price tiers where the current route permits them.
- Prices come from active SQL rows valid at query time. Preserve exact amount, tier, package, package quantity, base unit, and minimum quantity. Never derive prices from OCR text or embedding chunks.
- Sources come only from current eligible source rows already allowed by the corresponding public or authenticated source RPC. Do not synthesize page numbers. If a verified variant has no eligible page source, label the source as unavailable rather than fabricating one.
- The response is deterministically formatted from SQL data. LLM answer generation is not used to count variants or format a price list.
- Customers may add a listed variant to an order only through the existing explicit action. Variants without a current price have no add-to-order action. The backend continues validating the current price/version during order submission.

## Architecture

### Intent and query service

Add a small, deterministic `variantListIntent` classifier to query understanding. It recognizes explicit count/list wording independently from `asksForPrice`, so “có bao nhiêu loại” works even without the word “giá”. Do not weaken existing explicit-attribute matching, follow-up handling, comparison behavior, or out-of-catalog abstention.

For list intent, use the lexical/vector retrieval result as seed variant IDs and resolve them through the expansion RPC before the existing price-only public catalog read. This ordering is required so a verified seed with no current price can still identify its product group. SQL validates every seed and the backend applies the existing name/attribute filters to the expanded variant metadata. If more than one product group remains plausible, return `clarify` with short group choices and no prices/items. If one group remains, return the complete SQL-backed variant set, including rows with no current price. Set the answer status to `answered` when the group and its variant set are supported, even if one or more variants have no current price; use `insufficient_evidence` when no group can be established.

### Public database boundary

Add a new migration with a narrow public group-expansion RPC, provisionally named `public.list_public_rag_product_variants(p_seed_variant_ids bigint[])`.

- Accept only a non-empty bounded seed array of variant IDs produced by the existing public retrieval path.
- Resolve seeds only through active, verified variants attached to active products and categories. Expand siblings only within those resolved product IDs; never accept a caller-supplied product ID or arbitrary filter that would broaden access.
- Return all matching sibling variants, including variants with no current price. Include product/group IDs, product/category names, aliases needed by existing candidate filters, variant/specification fields, optional current-price fields, and source page numbers. Model price columns as nullable and use left joins for prices/packaging so absence of a price does not erase the variant.
- Include only current active public tiers (retail/wholesale), with the same validity-date and non-sample-list rules used by `get_public_rag_catalog`. Include only fields required to render the list and sources.
- Keep the RPC `SECURITY DEFINER` only because anonymous callers cannot read the base tables. Fix its `search_path`, qualify referenced objects, validate arguments, and filter every returned row to the existing public eligibility conditions. Revoke execute from `PUBLIC` and `authenticated`; grant execute to `anon` only. Do not grant table privileges, change RLS, or alter worker ACLs.
- Preserve the existing four public RPC contracts. Do not change existing RPC caps to create an unbounded path.

The authenticated staff path expands the same seed IDs through the existing authenticated repository/query path under current RLS. It must not call the public RPC using a fabricated identity.

### API and UI

- Extend the existing RAG response item mapping to include every variant in the selected group, with an empty `prices` array for variants without a current price. Preserve current source citation shape and API status semantics.
- Add a deterministic list formatter that states the count and one concise line per variant, including all applicable current price tiers and units or the no-current-price label.
- Keep the existing shared chat interface. The existing product cards render the returned variants; preserve customer add-to-order buttons only for variants with eligible prices, and preserve employee price-selection actions.
- Do not change catalog search filters, cart validation, order persistence, staff permissions, or ordinary single-price answer formatting.

## Alternatives considered

1. Increase the existing eight-result caps. This is smaller initially but cannot guarantee exact counts for larger groups and still omits variants without prices from the current public catalog RPC.
2. Add a dedicated seed-to-product-group expansion RPC. This produces an exact complete variant set while keeping the public data boundary narrow; selected.
3. Ask the LLM to infer the number and variants from retrieved chunks. Chunks may be incomplete or stale, so this can produce false counts and unsupported prices; rejected.

## Verification

- Unit tests cover intent detection (Vietnamese accents and unaccented wording), count/list versus ordinary ambiguity, product-group resolution, deterministic price formatting, and no-price variants remaining in the exact count.
- Service tests cover one supported group, multiple plausible groups (clarify without mixed prices), unrelated retrieval rejection, missing-price variants, current price/unit/source fields, and unchanged ordinary broad-price clarification.
- SQL regression runs only on Supabase local or a separately isolated database. It verifies `anon` can call the new RPC, cannot directly select protected tables, receives only active verified public variants and current retail/wholesale prices, and sees no dealer/expired/sample rows. It verifies `authenticated` cannot execute the public RPC, and worker roles/RLS remain unchanged.
- Browser tests cover the count/list questions on customer and staff pages, variants with and without prices, multiple-group clarification, and explicit add-to-order behavior for priced variants only.
- Run `npm.cmd run check`, relevant browser tests, SQL regression on an isolated database, and `git diff --check`.
- Do not apply the new migration or index/rewrite data on production as part of implementation without separate explicit deployment authorization. Report local/isolated verification separately from production status.

## Scope

This change adds a count/list question path to the existing RAG feature. It does not change the OCR workflow, product verification process, price values, embedding model, existing public catalog fields, or order workflow.
