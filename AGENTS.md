<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project rules

- Features live under `src/features`; UI lives under `src/components`; versioned SQL lives in `supabase/migrations`.
- Use `npm run dev|build|lint|typecheck|test|test:e2e`.
- Never edit an applied migration; add a new timestamped migration.
- Never commit `.env.local`, database passwords, service-role keys, or access tokens.
- Price writes must use audited RPCs with `expected_version`; offline behavior is read-only.
- `public.prices.amount` is authoritative. UI and invoice logic must never divide, normalize, convert, or silently replace it; totals are `requested quantity × prices.amount` after selecting the eligible retail/wholesale row.
- Quantity entry is expressed in the smallest retail package. Convert it to base quantity only to find an equivalent package (for example `10 × 10 bộ = 1 × 100 bộ`), show one best-priced eligible row, and calculate the total as `selected package count × unchanged prices.amount`.
- Done means lint, typecheck, unit tests and production build pass, with database/E2E blockers documented.
