# Sandbox — a throwaway test environment

[← Handbook](../HANDBOOK.md)

A **sandbox** is a full, safe copy of the app running on your machine against a **separate, throwaway
Supabase project** — never production. You get the real storefront, checkout and `/admin`, seeded with
a full catalogue, test logins and fake bookings, so you can click through anything without touching a
real customer, a real card, or a real inbox.

> **Why it's safe.** In `next dev` the app **stubs payments and email** (`NODE_ENV=development` bypasses
> the production fail-closed gate — see [development.md](development.md#local-setup)). Checkout
> completes with no Peach account and no card; no confirmation email is ever sent. And
> `npm run sandbox:setup` **hard-refuses to run against the production project** — it aborts if the
> target is the prod ref.

---

## One-time: create the test project

1. Go to [supabase.com](https://supabase.com) → **New project** (the free tier is enough). Give it a name
   like `belle-mare-sandbox`, pick a region near you, and set a database password you'll paste below.
2. When it's provisioned, collect four values:
   - **Project URL** and **anon key** — Settings → API → _Project URL_ and _Project API keys → anon
     public_.
   - **service_role key** — same page, _Project API keys → service_role_ (keep this secret).
   - **Direct connection string** — Settings → Database → _Connection string → URI_. Use the **port
     `5432`** direct/session-pooler string (NOT the `6543` transaction pooler), and include the password.
3. Auth redirects for local dev — Authentication → **URL Configuration**:
   - **Site URL** = `http://localhost:3000`
   - **Redirect URLs** → add `http://localhost:3000/**` (covers `/auth/callback` and
     `/auth/reset-password`).

## One-time: point `.env.local` at it

Put these four lines in `.env.local` (it's git-ignored — never commit real keys):

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-sandbox-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<sandbox anon key>
SUPABASE_SERVICE_ROLE_KEY=<sandbox service-role key>
SUPABASE_DB_URL=postgresql://postgres:<password>@<host>:5432/postgres
```

> Keep a copy of your **production** `.env.local` somewhere (e.g. `.env.local.prod`) so you can swap
> back. The app reads whichever project `NEXT_PUBLIC_SUPABASE_URL` points at.

---

## Provision it — one command

```bash
npm run sandbox:setup
```

This is idempotent — re-run it any time. It:

| Step | What                       | Source                                                     |
| ---- | -------------------------- | ---------------------------------------------------------- |
| 1    | Schema (only if DB empty)  | `supabase/setup.sql`                                       |
| 2    | Transfers, rentals, fares  | `supabase/catch-up.sql` (self-seeds these)                 |
| 3    | 32 activities              | `supabase/seed-catalogue.sql` (operator UUID auto-patched) |
| 4    | Region tagging             | `supabase/seed-activity-regions.sql`                       |
| 5    | Publish + 60 days of dates | `scripts/sandbox/sandbox-seed.sql`                         |
| 6    | Test users + fake bookings | Auth Admin API + `scripts/sandbox/sandbox-bookings.sql`    |

When it finishes it prints the counts and the logins.

## Run it

```bash
npm run dev            # → http://localhost:3000
```

**Test logins** (sign in from the app's account menu):

| Role     | Email                   | Password      | Where      |
| -------- | ----------------------- | ------------- | ---------- |
| Customer | `customer@sandbox.test` | `Sandbox123!` | storefront |
| Admin    | `admin@sandbox.test`    | `Sandbox123!` | `/admin`   |

The customer owns some of the seeded bookings, so `/account` and the admin screens both have data.

---

## What you get

- **32 published, bookable activities** with ~60 days of open availability from today (0 lead time, so
  same-day booking works).
- **Airport transfers, point-to-point transfers, and the rental fleet**, with placeholder fares — tune
  them in `/admin` if you're testing pricing.
- **8 fake bookings** tagged `notes = 'sandbox-seed'`, spread across `confirmed`, `payment_pending`,
  `cancelled`, `refund_pending` and `refunded`, with matching payment ledgers — so reports, the calendar
  day sheet and the bookings list all show realistic data.

## Publish it for testers (a hosted link)

`npm run dev` is fine for you, but remote testers need a URL. Deploy the app to **Vercel**, pointed at
the **same sandbox Supabase project** you seeded above. We use Vercel (not Cloudflare Pages) for the test
env because it builds with plain `next build` — the Cloudflare `pages:build` is broken on Windows — and
every route is already `runtime = 'edge'`, so it runs on Vercel's edge unchanged.

> **A hosted deploy is not `next dev`, so payments are no longer stubbed** (`NODE_ENV=production` puts the
> app in fail-closed mode). To let testers complete checkout you must wire **Peach SANDBOX** credentials
> (the same test-mode ones prod uses). Test cards move no real money. Leave real/live Peach creds out.

### 1. Create the Vercel project (once)

```bash
npx vercel login          # your Vercel account — I can't do this for you
npx vercel link           # create/link a project; NAME IT so the URL is predictable,
                          # e.g. "belle-mare-sandbox" → https://belle-mare-sandbox.vercel.app
```

A fixed name matters: `NEXT_PUBLIC_SITE_URL` is baked in at **build** time and must equal the real URL,
or payments fail closed. Knowing the URL up front lets you set it before the first real build.

### 2. Set the environment variables

Vercel → Project → **Settings → Environment Variables** (scope: Production). The `NEXT_PUBLIC_*` ones are
build-time — they must be present before the build testers use.

| Variable                                                                                                     | Value                                                            |
| ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`                                                 | your **sandbox** Supabase project                                |
| `SUPABASE_SERVICE_ROLE_KEY`                                                                                  | your **sandbox** service-role key                                |
| `NEXT_PUBLIC_SITE_URL`                                                                                       | `https://belle-mare-sandbox.vercel.app` (your real URL)          |
| `PEACH_CLIENT_ID` / `PEACH_CLIENT_SECRET` / `PEACH_MERCHANT_ID` / `PEACH_ENTITY_ID` / `PEACH_WEBHOOK_SECRET` | your **Peach sandbox** values                                    |
| `PEACH_AUTH_BASE_URL`                                                                                        | `https://sandbox-dashboard.peachpayments.com`                    |
| `PEACH_CHECKOUT_BASE_URL`                                                                                    | `https://testsecure.peachpayments.com`                           |
| `PEACH_ENVIRONMENT`                                                                                          | `test`                                                           |
| `PEACH_WEBHOOK_URL`                                                                                          | `https://belle-mare-sandbox.vercel.app/api/v1/webhooks/payments` |

Do **not** set `SUPABASE_DB_URL` (script-only), `PEACH_EXPECT_LIVE`, or `OWNER_WHATSAPP_TO` (it fails
loudly on every runtime). Email (`RESEND_*`) is optional — unset means no confirmation emails are sent,
which is fine for testing.

```bash
npx vercel --prod         # build + deploy → prints the live URL
```

### 3. Point Supabase + Peach at the test URL (once)

- **Supabase** (sandbox project) → Authentication → URL Configuration → add
  `https://belle-mare-sandbox.vercel.app/**` to the redirect allowlist (keep `http://localhost:3000/**`
  too so local still works).
- **Peach** (sandbox dashboard) → allowlist the `belle-mare-sandbox.vercel.app` domain, and point the
  webhook at `…/api/v1/webhooks/payments` with the same `PEACH_WEBHOOK_SECRET`. Peach only calls back a
  domain it has been told about — without the allowlist the widget won't load and settlement never
  arrives, so the booking stays `payment_pending`.

### 4. Seed once, share the link

The seed data lives in the Supabase project, not the deploy — so `npm run sandbox:setup` (run once from
your machine) is all the hosted app needs. Send testers the URL and the logins
(`customer@sandbox.test` / `admin@sandbox.test`, password `Sandbox123!`). For test card numbers, use
Peach's sandbox test cards (Peach dashboard → Testing).

### Hosted caveats

- **Availability is static** on the hosted env — the cron Worker that rolls new dates isn't deployed
  here. 60 days are pre-seeded; re-run `npm run sandbox:setup` to top them up.
- Vercel's edge runtime is compatible but not byte-identical to Cloudflare's — for a final pre-launch
  check use a Cloudflare Pages preview, not this.

## Resetting

- **Rebuild the fake bookings:** `delete from bookings where notes = 'sandbox-seed';` then re-run
  `npm run sandbox:setup`.
- **Start completely fresh:** delete the Supabase project and create a new one (fastest), or drop the
  public schema and re-run. Because it's throwaway, nuking it costs nothing.

## Notes & limits

- Because payments are stubbed, a "paid" sandbox booking never involved Peach — the stub webhook just
  marks it paid. Don't use the sandbox to test the real Peach integration; that needs sandbox Peach
  credentials and a tunnel (see [`.env.example`](../../.env.example) and the Peach section).
- Optional integrations (Google Maps, AI planner, Telegram/WhatsApp alerts) stay off until you add their
  keys — everything else works without them.
- **Never** run `npm run sandbox:setup` with production credentials in `.env.local`. It will refuse, but
  the habit to keep is: sandbox keys for the sandbox, and swap your `.env.local` back to prod when done.
