<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## UI component source

- Use components from `flowbite-react` for shared controls and presentation primitives such as buttons, inputs, selects, textareas, cards, badges, alerts, spinners, and modals.
- Do not introduce locally invented replacements for those generic components. Compose application-specific screens with Flowbite React and Tailwind utilities; keep CSS in `src/app/globals.css` limited to app layout, responsive behavior, and brand tokens.
- Keep Flowbite's Tailwind v4 setup in `src/app/globals.css`, `.flowbite-react/`, and `next.config.ts` in sync when upgrading the library.
