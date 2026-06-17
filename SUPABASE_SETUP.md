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

`supabase/setup.sql` is 13 migrations + 23 seeded activities, wrapped in one
transaction (all-or-nothing). Regenerate any time with
`npm run seed:gen && npm run setup:sql`.

### Recommended: apply over the connection string (no paste)

Pasting ~1800 lines into the SQL Editor can truncate or mangle multibyte text
(`Île`, `Chéri`, `–`) mid-string, which surfaces as a confusing
`relation "the" does not exist`. Applying it over the wire avoids that entirely:

1. Supabase: **Settings → Database → Connection string → URI** — copy it and fill in
   your DB password. Use the **`:5432`** direct/"Session pooler" string (not `:6543`).
2. Add it to `.env.local`:
   ```
   SUPABASE_DB_URL=postgresql://postgres:YOUR-PASSWORD@db.YOUR-PROJECT.supabase.co:5432/postgres
   ```
3. Run:
   ```
   npm run db:setup
   ```
   It applies the file and prints `✓ Applied. activities rows: 23`. On any SQL error it
   prints the exact line/column + context.

### Alternative: SQL Editor

**SQL Editor → New query** → paste **all** of `supabase/setup.sql` → **Run**. If you hit
a parse error, it's almost always a truncated paste — use the connection-string method
above, or paste the files in `supabase/migrations/` one at a time (in name order),
then `supabase/seed.sql`.

**Verify** either way: **Table Editor** lists `activities`, `bookings`, `payments`, … and
`activities` holds 23 published rows.

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
- **Redirect URLs**: **Authentication → URL Configuration** → add
  `http://localhost:3000/**` (and your production origin later).

The sign-in dialog shows **Google**, **Apple** and **Facebook** buttons. Each only works
once its provider is enabled in Supabase; an un-configured button returns a
`provider is not enabled` error. They all share the same callback:
**`https://YOUR-PROJECT.supabase.co/auth/v1/callback`** (copy the exact URL from
**Authentication → Providers → <provider>** — Supabase shows it there).

**Google** — create an OAuth client in [Google Cloud Console](https://console.cloud.google.com)
(APIs & Services → Credentials → OAuth client ID → Web application), add the Supabase callback
under "Authorized redirect URIs", then **Authentication → Providers → Google** → paste the
Client ID + Client Secret and enable.

**Apple** (needs a paid Apple Developer account):

1. [developer.apple.com](https://developer.apple.com) → Certificates, Identifiers & Profiles.
2. **Identifiers → App ID** (or use an existing one) and enable the **Sign In with Apple** capability.
3. **Identifiers → Services ID** → create one (e.g. `com.bellemaretours.web`). This identifier
   is your **Client ID**. Configure it: enable Sign In with Apple, set the domain to your
   Supabase project domain, and the **Return URL** to the callback above.
4. **Keys → +** → enable **Sign In with Apple** → download the `.p8` key. Note the **Key ID**
   and your 10-character **Team ID** (top-right of the developer portal).
5. **Authentication → Providers → Apple** in Supabase → enter the **Services ID** as the Client ID,
   then generate the Client Secret from **Team ID + Key ID + the `.p8` key** (Supabase's panel
   has fields for these / a "generate secret" helper) → enable.

**Facebook**:

1. [developers.facebook.com](https://developers.facebook.com) → **My Apps → Create App** →
   choose the **Consumer** type.
2. Add the **Facebook Login** product (Web).
3. **Facebook Login → Settings** → add the Supabase callback under
   **Valid OAuth Redirect URIs**.
4. **Settings → Basic** → copy the **App ID** and **App Secret**.
5. **Authentication → Providers → Facebook** in Supabase → paste App ID (Client ID) +
   App Secret → enable.
6. Toggle the Facebook app from **Development** to **Live** (top bar) so non-developer accounts
   can sign in. `email` + `public_profile` are granted by default — no App Review needed for basic login.

## 6. Admin access + image uploads (`admin-setup.sql`)

`supabase/setup.sql` builds the schema and the demo catalogue but deliberately does **not**
grant you admin rights or create the Storage bucket — those are one-time, account-specific, and
partly destructive, so they live in a separate file: **`supabase/admin-setup.sql`**. Run it once
against the live DB (SQL Editor, or `npx tsx scripts/db-exec.ts supabase/admin-setup.sql`). It has
three independent, clearly-commented steps — **read them first** and delete any you don't want:

1. **Catalogue reset** — deletes every activity except `north-tour`. **Permanent.** Skip this
   block if you want to keep the demo catalogue.
2. **Make yourself an admin** — sets your profile `role = 'admin'`. You must have **signed up in
   the app first** (so your profile row exists); the email in the file is already yours.
3. **Image uploads (Storage)** — creates the public **`activity-images`** bucket and its RLS
   policies (public read; staff insert/update/delete). **Admin photo uploads silently fail until
   this runs.** This block is safe and idempotent — if you only want uploads, run just step 3.

> Re-running `npm run db:setup` will not undo `admin-setup.sql`, **but** it re-seeds the demo
> catalogue — don't run it again after step 1 unless you want the demo activities back.

## 7. (optional) Regenerate DB types

Once the schema is live you can replace the hand-authored types:

```
npx supabase gen types typescript --project-id YOUR-PROJECT-REF > src/lib/supabase/types.ts
```

(Needs a Supabase access token: `npx supabase login`.)
