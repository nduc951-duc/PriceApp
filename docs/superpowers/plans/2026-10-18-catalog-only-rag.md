# Catalog-only RAG implementation

User-authorized scope: remove OCR entirely from the application and use verified Supabase catalog rows for the five previously discussed improvements. Execute inline in the current checkout, preserving existing uncommitted work.

## Design

Supabase product variants, products, aliases, attributes and packaging are the only factual input. Current prices are read separately for every price question; amounts are never embedded or converted. Catalog facts and specification lists render deterministically, without a chat or embedding dependency. Semantic discovery may use catalog embeddings; advice must be supported by verified catalog facts. OCR transcripts and OCR-only chunks are removed by a forward migration; original page images and catalog provenance links remain.

Catalog size notation confirmed by the user: for screw products, `D×L` or `D ly L` means diameter `D` ly/mm and length `L` mm (`10x120` and `10 ly 140` both mean diameter 10 mm, length 120/140 mm). A standalone `nFm` notation uses `F` for phân (`1F5` = 15 mm). Preserve the Supabase specification and add this interpretation only to grounded indexing and answers.

## Tasks

- [x] Add regression tests for deterministic catalog facts without embeddings, citation grounding, catalog-only indexing, retired routes and index diagnostics.
- [x] Remove OCR/transcript/preview UI, API endpoints, implementation, unused frontend RAG handlers and obsolete tests.
- [x] Read price questions from live Supabase SQL; answer specifications/packaging from verified rows; reject unsupported numeric and price claims.
- [x] Treat a scalar size such as `8 ly` or `8 mm` as a generic family filter for composite specifications; keep full sizes such as `8x100` precise and return each matching current price.
- [x] Explain the user's screw `diameter × length` convention and `F`/phân measurements in catalog chunks and grounded answers without altering the stored specification.
- [x] Index active verified catalog rows with stable variant keys and model fingerprints; allow variants without source images; show vector coverage and queued revisions in `/rag-admin`.
- [x] Add a forward migration that blocks old transcript access, removes OCR/source/price reindex triggers, refreshes public catalog RPCs and queues a clean catalog generation. Update guides, OpenAPI and generated types.
- [x] Add a forward migration deleting persisted OCR transcripts and OCR-only chunks/embeddings while keeping original source scans and catalog source links.
- [x] Run lint, TypeScript, unit suites, OpenAPI check, production build and desktop/mobile browser suite. Record the remaining database validation boundary below.

## Validation boundary

`npm run check` passed earlier (frontend 83 tests; backend 307 tests). After the final RLS and query-understanding fixes, all 309 backend tests and backend typecheck passed. The catalog-only SQL regression was run against an isolated local Supabase PostgreSQL database: before the worker-policy fix it failed with `permission denied for table rag_page_texts`; after the fix it passed, including the assertion that unlinked source-page metadata stays hidden. The official `supabase test db` wrapper still cannot start because the configured `gia-chuan` local container is absent; the SQL regression itself was executed directly through `psql`.

Remote migrations `202610180004` through `202610180010` are applied with `--skip-vault`; no Vault secrets were changed. The dedicated worker processed revision 7 successfully and published generation 5: 654 verified variants, 654 catalog chunks, 654 embeddings, and zero OCR chunks. The public vector RPC returned the expected bánh xe variant for its specification question. End-to-end public API checks answered both `Quy cách của bánh xe Đỏ mận khóa ĐL 7F5 là gì?` and its current retail price question (75.000 ₫) from verified Supabase rows.

Follow-up query regression checks now cover `8 ly` and `8 mm` family matching, different products and wording, per-variant current prices, and exclusion of a neighboring size such as `10x100`. Size-meaning tests cover screw `10x120`, spaced `10 ly 140`, generic `1F5`/`7F5`, index text and answers while preserving raw specifications. `npm run check` passes. Migration `202610180012_delete_retired_ocr_data.sql` is prepared locally but has not been applied remotely.

## Review focus

No old OCR chunk can enter retrieval; verified variants without an image remain answerable; price changes are visible without reindexing; embedding/chat outages do not block deterministic facts; unverified/inactive catalog rows and private price tiers stay inaccessible to guests.
