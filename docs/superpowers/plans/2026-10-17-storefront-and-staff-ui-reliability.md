# Storefront and Staff UI Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Work sequentially in the current repository and preserve unrelated working-tree changes.

**Goal:** Improve reliability and readability of customer and staff screens across narrow viewports, keyboard use, and light/dark themes without changing business permissions or redesigning the application.

**Architecture:** Keep the existing customer storefront, staff screen, and role gate. Use Flowbite React for standard controls and make targeted changes to shared CSS tokens, layout, and state styling. Keep catalog filtering independent from AI/RAG question submission.

**Tech Stack:** Next.js App Router, React, TypeScript, Flowbite React, Tailwind/CSS, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-storefront-and-staff-ui-reliability-design.md`

## Global constraints

- Follow `frontend/AGENTS.md`; use existing Flowbite React components for standard controls.
- Limit CSS work to layout, responsive behavior, typography, focus, and theme tokens; do not introduce a new visual system.
- Preserve session checks and role authorization. Choosing the staff role must continue to require authentication.
- Keep catalog search filters separate from RAG messages; sending a question must not mutate the active catalog search.
- Do not connect to or modify any remote database. Use browser mocks for UI behavior unless a local isolated database is explicitly required.

## Review focus

1. Check input, clear button, icon, placeholder, and helper text at narrow widths so they do not overlap.
2. Check long unbroken specifications for clipping; document `scrollWidth` alone is not sufficient evidence.
3. Check native/custom select arrows and controls at 200% browser zoom.
4. Check role selection still routes unauthenticated staff users through the existing auth gate.
5. Check keyboard operation, focus visibility, and text/control contrast in both themes.

## Task 1: Protect separation between catalog search and AI questions

**Files:** `frontend/src/components/customer-storefront.tsx`; `frontend/src/components/price-app.tsx`; `frontend/tests/staff-search-ui.spec.ts`; `frontend/tests/customer-rag-query.spec.ts`.

1. Add failing browser tests showing that typing and clearing a catalog search updates only catalog results, category filters remain active, and sending an AI question leaves the search/filter state unchanged.
2. Fix only the state wiring or layout responsible for violations; keep existing search and RAG API contracts.
3. Verify both customer and staff screens expose clearly labeled catalog search and AI question entry points.
4. Run the focused customer RAG and staff search Playwright tests.

## Task 2: Make role selection and chat controls usable by keyboard and theme

**Files:** `frontend/src/components/app-mode-gate.tsx`; `frontend/src/components/customer-storefront.tsx`; `frontend/src/components/price-app.tsx`; `frontend/src/app/globals.css`; focused browser tests.

1. Add failing browser tests for keyboard focus/order, Enter-to-send, Alt+Enter newline, disabled/loading send state, visible errors, and authenticated versus unauthenticated staff selection.
2. Implement semantic labels and focus styles using existing components and theme tokens. Preserve the existing auth gate behavior.
3. Ensure the chat answer panel, text input, placeholder, send button, loading state, and error state remain legible in light and dark themes.
4. Run the focused browser tests in both configured themes where supported.

## Task 3: Verify layout at small screens, long text, and zoom

**Files:** `frontend/src/components/customer-storefront.tsx`; `frontend/src/components/price-app.tsx`; `frontend/src/components/app-mode-gate.tsx`; `frontend/src/app/globals.css`; create `frontend/tests/ui-layout-reliability.spec.ts` if current tests do not cover these cases.

1. Add failing browser assertions for viewports 320, 390, 768, and 1440 CSS pixels, long unbroken variant/package text, and 200% zoom or an equivalent browser scaling test.
2. Measure actual element bounds and text visibility, not only document overflow.
3. Fix only the implicated spacing, wrapping, min-width, or control padding rules; avoid broad component rewrites.
4. Verify horizontal scrolling is limited to intentionally scrollable regions and controls remain reachable.

## Task 4: Full verification and completion

**Files:** tests and implementation files from Tasks 1–3.

1. Run the focused Playwright tests for customer search/RAG, staff search, keyboard behavior, and responsive layout.
2. Run `npm.cmd run check` and `git diff --check`.
3. Inspect the browser results at desktop and mobile sizes and confirm no unauthorized employee action appears on the customer screen.
4. Commit only the implementation changes for this plan when executing it; preserve unrelated working-tree changes.
