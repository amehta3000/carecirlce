# CareCircle

Private family app for coordinating one elderly parent's medical care: scan
paperwork, review what Claude extracts, book follow-ups onto a shared Google
Calendar. Users: the owner (admin), his brother, and their 86-year-old dad.

Stack: Next.js 15 (App Router, server actions), React 19, TypeScript, Supabase
(Postgres + Auth + Storage), Google Calendar API, Anthropic API. Plain CSS in
`app/globals.css` (no Tailwind).

## Commands

- `npm run dev`: local dev at http://localhost:3000 (needs `.env.local`, see `.env.example`)
- `npm run typecheck`: run before every commit
- `npm run build`: production build
- `npm run test:db`: runs the schema + RLS security tests in an in-process Postgres (PGlite). No Supabase needed. Run after ANY change to `supabase/migrations/`.

## Architecture rules

- **Google Calendar is the source of truth for booked times.** `care_items` caches `scheduled_start/end` and `gcal_event_id`; the Today page reconciles from Google. Don't build a calendar UI.
- **Every mutation is a server action in `app/actions.ts`** that calls `requireEditor()` / `requireAdmin()` from `lib/context.ts` before touching data. RLS checks again in the database. Keep both layers.
- **Use the user-scoped Supabase client** (`createClient` in `lib/supabase/server.ts`) for everything. The service-role client is only for the `google_connections` table, and only after an admin check.
- **Extraction never writes to the care plan directly.** `/api/documents/[id]/extract` stores results on the document; a person confirms them via the `confirm_document` RPC (one transaction, guarded against double-confirm).
- **Calendar scope is `calendar.app.created` only.** Don't widen it; the app may only touch the calendar it created.
- **Times:** store UTC, display in `care_circles.timezone` via helpers in `lib/dates.ts`. Never use the server's local time.

## Schema changes

Edit by adding a new file in `supabase/migrations/` (don't rewrite `0001_init.sql` once it has been applied to a real project). Every new table gets RLS enabled plus policies using `is_member()` / `can_edit()` / `is_admin()`. Add matching checks to `supabase/tests/rls.test.mjs`.

## UX constraints

The dad reads this too. Keep body text ≥ 18px, tap targets ≥ 48px, plain-language labels ("Needs booking", not "Pending"), and the Atkinson Hyperlegible font. Test mobile first.

## Never

- Commit `.env*` files or keys.
- Make the `documents` storage bucket public or return unsigned file URLs.
- Store medical data outside the user's circle (logs, analytics, third-party services beyond Supabase and Anthropic).
