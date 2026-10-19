# Customer RAG checks and test organization

User request: test natural customer questions, move tests into dedicated directories, remove logs/debug waste. Work directly in the current project; preserve application behavior, credentials, migrations and useful reports.

- [x] Exercise customer journeys through the real public HTTP handler and Gemini. Keep one readable report and one reusable live test runner. **Limitation:** full quality evaluation is blocked by Gemini daily free-tier quota; actual observations and blocked cases are documented.
- [x] Move backend tests to `backend/tests` preserving module hierarchy; frontend unit tests to `frontend/tests/unit`, Playwright tests/support to `frontend/tests/e2e`, root dev-runner tests to `tests/scripts`. Rewrite imports/mocks and update discovery/lint configuration, preserving production typecheck boundaries.
- [x] Remove confirmed log/JSONL artifacts and obsolete one-off diagnostics. Four JSON reports were removed after explicit user confirmation; meaningful reports and source data remain.
- [x] Run unit tests, lint, typecheck, contract check, builds and full desktop/mobile E2E. `npm run check` passes; full Playwright has 100 passed, 20 failed, 12 skipped, documented in `docs/reports/2026-10-19-project-cleanup-validation.md`.
