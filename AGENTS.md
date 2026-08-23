<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# DocMaker Calendar

Shared calendar app. Next.js 16 App Router, React 19, Tailwind 4, TypeScript.

- **All data access goes through `useStore()` in `src/lib/store.tsx`**, which
  calls `src/lib/db.ts`. Components never query Supabase directly.
- Events are READ from the `cc_calendar_feed` view, never from `cc_events`:
  the view applies busy masking, so the client is never sent details the
  viewer is not entitled to. Writes go to the tables.
- Tables in `supabase/schema.sql` use the `CC_` prefix and mirror `src/lib/types.ts`.
- Colours: never hardcode hex in components. Set `--c` via `colorVar(key)` from
  `src/lib/colors.ts` and use the `.cc-dot` / `.cc-tint` / `.cc-solid` helpers so
  light and dark both work.
- Date maths and layout packing live in `src/lib/date.ts`, not in components.
- Attachments: bytes through `src/lib/files.ts` only; components never touch
  IndexedDB or Storage directly.
- The Supabase project is shared with several other apps, distinguished by
  table prefix. Every table, view, function, policy and bucket this app
  creates MUST be `CC_` prefixed, and nothing outside that prefix may be read
  or written.
- `auth.users` and the auth provider settings are SHARED by all those apps.
  Never add a trigger to `auth.users` and never change provider config for
  this app alone — set this app up on demand via `cc_bootstrap_me()` instead.
- Never commit `.env.local` or paste keys into tracked files.
- Before finishing: `npm run lint` and `npx tsc --noEmit` must both be clean.
