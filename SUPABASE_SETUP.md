# Supabase setup (one-time, no CLI needed)

This wires the app to a real Supabase project so auth, booking persistence and
storage work. No Docker or Supabase CLI required — you paste one SQL file.

> Until `.env.local` has real Supabase values, the app runs on a local seed
> fixture (placeholder photos/ratings). Once configured, it uses live data.

## 1. Create the project

1. Go to <https://supabase.com> → sign in → **New project**.
2. Name it (e.g. `belle-mare-tours`), set a strong **database password** (save it),
   pick a region close to Mauritius (**Frankfurt** `eu-central-1` or
   **Singapore** `ap-southeast-1`).
3. Wait ~2 min for it to provision.

## 2. Apply the schema + seed

1. In the dashboard: **SQL Editor → New query**.
2. Open `supabase/setup.sql` from this repo, copy the **whole file**, paste, **Run**.
   - It's wrapped in a transaction (all-or-nothing) — 13 migrations + 23 seeded
     activities (operators, options, prices, occurrences, translations).
   - Regenerate it any time with `npm run seed:gen && npm run setup:sql`.
3. Verify: **Table Editor** should now list `activities`, `bookings`, `payments`, … and
   `activities` should hold 23 published rows.

## 3. Grab the keys

**Settings → API:**

- **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
- **Project API keys → `anon` `public`** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Project API keys → `service_role` `secret`** → `SUPABASE_SERVICE_ROLE_KEY` (server-only)
- **JWT Settings → JWT Secret** → `SUPABASE_JWT_SECRET` (server-only)

## 4. Create `.env.local`

Create `.env.local` in the repo root (it's gitignored) with your real values:

```
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...your-anon-key...
SUPABASE_SERVICE_ROLE_KEY=eyJ...your-service-role-key...
SUPABASE_JWT_SECRET=your-jwt-secret
```

> Leave a Supabase line out entirely rather than blank — the env schema rejects
> empty/placeholder values, and a missing pair keeps the local seed fallback on.

Then restart `npm run dev` so Next picks up the new env.

## 5. Auth providers (for Phase 4)

- **Authentication → Providers → Email**: enabled by default. For local testing,
  **Authentication → Settings**, you may turn **"Confirm email"** off so sign-ups
  log in immediately.
- **Google** (optional, can be added later): create an OAuth client in Google Cloud
  Console, then **Authentication → Providers → Google** → paste Client ID/Secret and
  add the callback `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
- **Redirect URLs**: **Authentication → URL Configuration** → add
  `http://localhost:3000/**` (and your production origin later).

## 6. (optional) Regenerate DB types

Once the schema is live you can replace the hand-authored types:

```
npx supabase gen types typescript --project-id YOUR-PROJECT-REF > src/lib/supabase/types.ts
```

(Needs a Supabase access token: `npx supabase login`.)
