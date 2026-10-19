# Groq fallback for retrieval-first RAG

User request: add Groq because Gemini free quota is exhausted. Implement directly in the current workspace.

- [x] Confirm Groq OpenAI-compatible endpoint and GPT-OSS 120B strict JSON Schema support from official docs: https://console.groq.com/docs/structured-outputs .
- [x] Write failing tests for primary 429/5xx/network/timeout, separate credentials and identical evidence, success without fallback, missing fallback key, primary 401, failure of both providers and embedding isolation.
- [x] Add one Groq fallback attempt only in the active retrieval-first answer path. Keep raw prompt/history/evidence, server-side validation and SQL price handling. Do not change embedding model/index or restart the user's backend.
- [x] Add local/example configuration. User supplied the private Groq key during implementation; confirmed actual Groq response on synthetic evidence and the current catalog after explicit egress permission.
- [x] Resolve real free-tier 413 with lossless table encoding and deduplication of exact SQL chunk copies; verify round-trip preservation with tests. No lexical question rules added.

Validation details and remaining limits: `docs/reports/2026-10-19-groq-fallback.md`.

Scope: Gemini remains primary. Legacy chat/planner and admin primary chat health probe are unchanged; their diagnostic status describes the primary provider. No automatic loop between providers. Missing fallback key keeps the prior behavior. Groq primary mode is also available through existing RAG_CHAT_* settings.
