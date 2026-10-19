# Retrieval-first conversational RAG implementation plan

**Goal:** Apply MidTerm's raw question + recent conversation + retrieved text -> grounded model answer flow to the current catalog app, removing language rules from the active retrieval/generation path.

**Design:** A backend `retrieval_first` mode embeds the untouched question (and a bounded contextual query), expands verified catalog groups from vector hits, reloads current SQL prices, and calls the chat model once with the complete evidence and recent messages. The model selects evidence-backed variant/price/product IDs and writes the conversational answer. Code validates shape, IDs, permissions, source provenance and authoritative prices; it does not use lexical product-name filters or a conversational stop-word list. Existing pipeline is retained as an explicit rollback path during migration. The current local app and env example opt into retrieval_first.

**Reference:** https://github.com/nduc951-duc/MidTerm/blob/main/server/ai.js and server/retrieve.js, inspected on 2026-10-19. Adaptation adds current SQL prices, structured IDs for cart actions, and verified product-group expansion. Semantic retrieval does not establish exhaustive coverage of every parent product.

**Constraints:** Keep Gemini chat and bge-m3 embeddings separate; keep existing index/artifact; no migration or price writes; no automatic backend restart. Never let history, model-supplied money, or unknown IDs override current SQL data. Report retrieval/model outages as unavailable instead of missing catalog data. Public prices exclude dealer prices.

- [x] 1. Add failing service/provider tests: exact raw question, multiple clauses, unseen filler words, reordered speech, contextual references, unknown evidence IDs, unavailable providers, SQL prices and batched group expansion.
- [x] 2. Implement retrieval-first service and one-call evidence-bound model response, including citations and existing API response shape. Wire the configured mode before legacy planner/rules.
- [x] 3. Carry bounded recent history in customer and owned staff conversations; retain old context fields for compatibility; regenerate API types.
- [x] 4. Enable current environment mode, verify all relevant automated checks and real Gemini/Supabase cases; inspect prompt and retained evidence trace. Request independent review and resolve important findings.

Completed validation and limitations: `docs/reports/2026-10-19-retrieval-first-rag.md`. Five final read-only HTTP/Gemini/Supabase cases are summarized there. The raw JSON and one-off smoke runner were removed during the later user-requested cleanup; reusable customer checks now live in `backend/tests/live/customer-rag.ts`.

**Validation limits:** No claim of universal language understanding or new write capabilities. Product suitability needs technical evidence. A single live success does not establish model quality, quota headroom, or stable latency.
