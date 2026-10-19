# Current RAG configuration and validation

## Scope

Gia Chuan is a catalog and price question answering application. Its RAG path retrieves verified catalog records, reloads current SQL facts, asks a model to select evidence identifiers, validates the output, and renders selected prices from `public.prices.amount`. Engineering advice is supported only when retrieved evidence establishes the relevant properties. A generic clarification can also indicate output validation failure and should not automatically be classified as a correct refusal.

## Configured profile

- Query mode: `retrieval_first`.
- Embedding: Gemini `gemini-embedding-001`, 1,024 dimensions, L2 normalization for both documents and queries.
- Latest rebuilt index: generation 8, 654 of 654 chunks completed, all newly indexed using the new embedding profile.
- Chat: local Ollama `qwen3:4b`; optional Groq `openai/gpt-oss-120b` fallback for eligible availability errors.
- Context: up to eight chunks per vector query, merged to at most 16; expanded catalog context capped at 16 variants and recent history capped at six messages.
- Ollama `keep_alive`: 15 minutes so repeated questions do not require a model reload.
- Environment files are private and excluded from Git. A running backend must be restarted to load environment changes.

## Repository verification

On 20 October 2026, `npm run check` completed with exit code 0:

- Frontend and backend lint and type checking passed.
- Development-runner tests: 2 passed.
- Frontend unit tests: 84 passed across 12 files.
- Backend unit tests: 472 passed across 56 files.
- Generated OpenAPI consistency passed.
- Frontend and backend production builds passed.

Historical full Playwright cleanup results were 100 passed, 20 failed and 12 skipped. The full browser suite and SQL regression suite were not rerun for this report. Unit checks do not prove live RLS, migration state or universal answer quality.

## Scoped live probes

These are individual observations on the current machine, not a held-out benchmark. Questions and public catalog evidence were used with the user's authorization.

| Probe | Observation |
| --- | --- |
| Gemini embedding vector | 1,024 dimensions, unit L2 norm; a direct public vector search returned eight catalog chunks. |
| LM Studio 8B catalog context experiment | The same bolt question took about 55 seconds with 47 and with 16 expanded variants. Reducing the context cap alone did not demonstrate a latency improvement. |
| Ollama Qwen2.5 3B | The bolt query returned a clarification after 8.9 seconds and did not yield a validated answer. |
| Ollama Qwen3 4B | The bolt query returned an answered result after 34.3 seconds, selecting variant 47 and its 10-set and 100-set packaging. |
| Technical advice | A question about an iron anchor, 8 ly x 3F, a 10-piece pack and a high-load installation returned a generic clarification after 26.3 seconds. No validated suitability recommendation was produced. |

Variant 47 was observed as `Bulong có tán`, specification `8 ly x 3F`. SQL prices during the recorded probes were VND 9,000 for 10 sets and VND 70,000 for 100 sets. These are point-in-time observations; the model is not the source of the amount.

The temporary probe backend on port 4001 was stopped after testing. Existing user-run services were not stopped as part of those probes. No claim is made that every existing backend process has reloaded the latest private environment file.

## Remaining limits

Local generation is still slow for interactive use. Qwen2.5 3B was faster but failed the tested evidence contract; Qwen3 4B performed better on the scoped catalog query but did not solve the technical-advice case. There is no completed retrieval benchmark proving embedding quality superiority, and no production acceptance claim. The supported project scope is catalog discovery, documented specifications, packaging, current prices and evidence-based factual comparisons.
