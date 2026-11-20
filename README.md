# CareCircle

A private family app for coordinating one person's medical care. Photograph the
papers at the end of an appointment, review what was pulled out, and book the
follow-ups onto a shared Google Calendar.

**Google Calendar owns confirmed appointments.** CareCircle owns the things a
calendar can't hold: the list of what still needs booking, the scanned papers,
medications, and "call the doctor if…" instructions.

## How it works

1. **Scan.** Photograph every page (or upload a portal PDF). Photos are shrunk to
   ~2000px on the phone and EXIF/GPS is stripped before upload.
2. **Review.** Claude reads the pages and proposes: things to book (with a
   book-by date and the paper's exact wording), medication changes, and standing
   instructions. Each comes with a short quote from the paper so you can check
   it. Nothing enters the plan until someone ticks it and taps Add.
3. **Book.** Call the office, then enter the date and time. CareCircle creates
   the event on a dedicated `Dad · Care` calendar and adds each family member as
   a guest, so it lands in their own Google Calendar with reminders 1 day and
   2 hours before. Prep instructions go in the event.
4. **Stay in sync.** If someone moves the event in Google Calendar, the new time
   flows back into the app. Cancel in the app and the event is removed (guests
   are notified).

## Roles

| Role | Can do |
|---|---|
| Admin | Everything, plus invite/remove people and connect the calendar |
| Editor | Scan, review, book, update meds |
| Viewer | See everything, change nothing |

Suggested: you = admin, your brother = admin or editor, your dad = editor if he
will book things himself, viewer if he just wants to see what's coming.

## Security model

- **Sign-in:** Google via Supabase, basic profile only. Optional `ALLOWED_EMAILS`
  allowlist is enforced in middleware on every request.
- **Data isolation:** every table has Row Level Security keyed on care-circle
  membership. A signed-in stranger sees nothing. Covered by 43 checks
  (`npm run test:db`) for strangers, viewers, role escalation, the token table,
  storage and the confirm transaction.
- **Papers:** private storage bucket. Files are only reachable through
  10-minute signed links, and only by circle members.
- **Calendar access:** uses `calendar.app.created`, the narrowest Calendar scope
  Google offers. The app can only see and edit the one calendar it creates; it
  cannot read anything else in the account. Only the admin who connects it sees
  a Google permission screen.
- **Refresh token:** AES-256-GCM encrypted with `TOKEN_ENCRYPTION_KEY` before
  storage, in a table no client can read. Revoked at Google on disconnect.
- **Every write** goes through a server action that re-checks the caller's role
  before the database checks it again via RLS. Every change is logged with who
  made it.
- **Not HIPAA-compliant.** That's fine for a family keeping its own records, but
  don't point a clinic at this. Supabase and Anthropic both process the papers.

## Setup (about 30 minutes)

### 1. Supabase
1. Create a project at supabase.com.
2. **SQL Editor** → paste and run `supabase/migrations/0001_init.sql`. It creates
   the tables, policies and the private `documents` bucket.
3. **Project Settings → API**: copy the URL, anon key and service-role key.

### 2. Google Cloud (one project covers both)
1. console.cloud.google.com → new project → **APIs & Services → Enable APIs** →
   enable **Google Calendar API**.
2. **OAuth consent screen**: External. Add scopes `openid`, `email`, `profile`,
   and `.../auth/calendar.app.created`.
3. **Credentials → Create OAuth client → Web application.** Authorized redirect
   URIs:
   - `https://YOUR-PROJECT.supabase.co/auth/v1/callback` (sign-in)
   - `http://localhost:3000/api/google/callback` (calendar, local)
   - `https://YOUR-DOMAIN/api/google/callback` (calendar, production)
4. Supabase → **Authentication → Providers → Google**: paste the client ID and
   secret. Under **URL Configuration**, set Site URL to your app URL and add
   `http://localhost:3000/**` and `https://YOUR-DOMAIN/**` to redirect URLs.

> **Important:** while the consent screen is in **Testing** status, Google
> expires refresh tokens after 7 days and you'd have to reconnect weekly. Click
> **Publish app**. You don't need Google's verification for a family app; the
> admin just sees an "unverified app" warning once when connecting the
> calendar. Family members signing in never see it, since login asks for basic
> profile only.

### 3. Anthropic
Create an API key at console.anthropic.com. Expect cents per scan.

### 4. Run it
```bash
cp .env.example .env.local      # fill it in
npm run gen-key                 # paste output into TOKEN_ENCRYPTION_KEY
npm install
npm run dev
```

### 5. First use
1. Sign in → **Set up your care circle** (who you're caring for, time zone).
2. **Family → Connect Google Calendar.**
3. **Family → Invite**: your brother's and dad's Google emails. Send them the
   app link; they join by signing in with that exact account.
4. On phones: open the app in Safari/Chrome → Share → **Add to Home Screen**.

### Deploy
Vercel works out of the box. Add the same env vars, set `APP_URL` to the
production URL, and add the production redirect URIs above. The extraction route
allows up to 120 s; Vercel's free tier caps functions at 60 s, so multi-page
scans may need the Pro plan or fewer pages per scan.

## What's deliberately not here (yet)

- **SMS.** Google Calendar no longer sends texts, and US business SMS now
  requires A2P 10DLC carrier registration, which is a real chore for a personal
  app. Calendar notifications on each phone cover reminders.
- **Daily digest email.** Easy to add with a cron route once you see whether
  calendar reminders are enough.
- **Multiple people cared for.** The schema supports it (one circle per
  person); the UI assumes one.

## Project layout
```
app/
  (app)/            signed-in screens: Today, Papers, Scan, Meds, Family, items
  actions.ts        all mutations (server actions, role-checked)
  api/google/       calendar connect + OAuth callback (admin only)
  api/documents/    runs extraction on uploaded pages
  login, welcome, not-allowed, auth/
components/         UI pieces (forms, review screen, scan flow)
lib/
  context.ts        loads the user's circle + role per request
  google.ts         Calendar API: token refresh, events, agenda
  extract.ts        Claude call with a strict tool schema
  crypto.ts         token encryption
supabase/migrations/0001_init.sql
```
