# Sandbox — a throwaway test environment

[← Handbook](../HANDBOOK.md)

A **sandbox** is a full, safe copy of the app running on your machine against a **separate, throwaway
Supabase project** — never production. You get the real storefront, checkout and `/admin`, seeded with
a full catalogue, test logins and fake bookings, so you can click through anything without touching a
real customer, a real card, or a real inbox.

Want a link for someone else to try? See [Publish it for testers](#publish-it-for-testers-a-hosted-link-on-cloudflare-pages) — a free hosted copy on Cloudflare Pages.

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

## Mirror the live catalogue (real tours, no PII)

`npm run sandbox:setup` seeds a synthetic catalogue. To make the sandbox show the **real production
catalogue** instead — the actual activities, options, prices, images and every fare/planner/rental config
— pull it from live. This uses [`scripts/dump-catalogue.ts`](../../scripts/dump-catalogue.ts), which by
design copies **no bookings, payments, customers or auth users** — zero personal data, so it's safe for a
tester-facing sandbox.

Two steps, because they touch two different databases:

```bash
# 1. Dump the live catalogue — READ-ONLY on production. Point SUPABASE_DB_URL at prod
#    just for this one command (don't leave prod creds in .env.local).
SUPABASE_DB_URL="<prod :5432 URI>" npx tsx scripts/dump-catalogue.ts
#    → writes supabase/seed-live-catalogue.sql

# 2. Apply it to the sandbox (.env.local must point at the sandbox).
npm run sandbox:from-live
```

Step 2 replaces the sandbox catalogue with production's, rebuilds ~185 days of availability, and
re-creates the fake bookings against the real catalogue. It **refuses to run against production**. Re-run
both steps any time you want to refresh the sandbox with the latest live catalogue. (If you keep a
`.env.local.prod` copy, step 1 is
`SUPABASE_DB_URL="$(grep '^SUPABASE_DB_URL=' .env.local.prod | cut -d= -f2-)" npx tsx scripts/dump-catalogue.ts`.)

## Publish it for testers (a hosted link on Cloudflare Pages)

`npm run dev` is fine for you, but anyone else needs a URL. The sandbox has its own **free Cloudflare
Pages project** (default name `belle-mare-sandbox`, address `https://belle-mare-sandbox.pages.dev`),
completely separate from the live site and wired to the **same sandbox Supabase project** you seeded
above. A GitHub Action builds it on Linux (the local Windows build is broken) and deploys it. It runs on
the same platform as production, which is why it replaced the old Vercel test site.

> **A hosted deploy is not `next dev`, so payments are no longer stubbed.** The site runs in production
> mode and refuses the payment stub, so testers can complete checkout only if **Peach TEST keys** are
> configured. They are optional: without them everything up to checkout still works. Test cards move no
> real money, and the deploy refuses any Peach endpoint that is not a test one.

### One-time setup

1. **Copy your sandbox settings to GitHub.** Your `.env.local` already points at the sandbox project:

   ```bash
   npm run sandbox:secrets
   ```

   It lists the setting **names** it will upload (never the values), asks you to confirm, and stops if
   `.env.local` points at production, mixes keys from two Supabase projects, or holds live Peach
   settings. Add `-- --dry-run` to look without uploading, `-- --status` to see what GitHub already
   has, or `-- --no-peach` to skip card payments. Everything is stored as `SANDBOX_*`, and the workflow
   reads only those names, so it can never fall back to a production value.

   `SUPABASE_JWT_SECRET` is **optional** here, and the tool proves any one it finds really is the
   sandbox project's (it must sign that project's own keys). A `.env.local` copied from the production
   one carries **production's** secret; if yours does, the tool withholds it, says so, and uploads
   everything else. The sandbox signs tokens with asymmetric keys, so it never needs it. Consider
   deleting that line from `.env.local` so production's signing secret is not sitting in a sandbox file.

2. **Supabase (sandbox project) → Authentication → URL Configuration:** add
   `https://belle-mare-sandbox.pages.dev/**` to the Redirect URLs. Only new sign-ups and password
   resets need it; the test logins work without it.

3. **Peach sandbox dashboard:** allow-list the `belle-mare-sandbox.pages.dev` domain and point the
   webhook at `https://belle-mare-sandbox.pages.dev/api/v1/webhooks/payments` (same webhook secret). **Add**
   the sandbox webhook alongside the existing ones, do not replace them — the release pipeline's payment
   probe and any other test site still use theirs.
   Without the allow-list the widget will not load and settlement never arrives. Switching Peach
   accounts does **not** carry the allow-list with it, and the symptom is easy to misread: checkout
   fails for the guest with **"An upstream service is unavailable"** while your keys are perfectly fine
   (Peach answers "Merchant domain is not allowlisted"). If you see that message, check this step first.

4. **Have something to book.** For the photography gallery flow the sandbox needs a **published
   Photography package with open dates** (Admin → Photography).

5. If the sandbox Supabase project is **paused** (free projects pause after about a week idle), click
   **Restore** in the Supabase dashboard.

If Cloudflare gives the project a different address (a name already taken by another account gets a
random suffix), the first run prints the real one in its log and summary; use that in steps 2 and 3.

### Deploy

```bash
npm run sandbox:deploy
```

This pushes **what you have checked out and committed** to the `sandbox` branch (a disposable deploy
branch, so it is a force-push), which runs the _Sandbox deploy_ workflow. Follow it under GitHub →
Actions; the run summary shows the URL. Uncommitted changes are not deployed, and to redeploy the same
commit push an empty one (`git commit --allow-empty -m redeploy`, then deploy again).

Each run: **guard rails** (fails in seconds if anything looks wrong) → finds or creates the Pages
project and applies its settings → builds the edge bundle → **applies `supabase/catch-up.sql` to the
sandbox database** (schema only, idempotent, never production) → deploys → health check → tops up
bookable dates. The health check also fetches the deployed site and fails the run unless it proves the
sandbox is not indexable (`robots.txt`, `noindex` tag) and loads no analytics. The first run on a branch that has never had a Linux edge build is also the first proof
that the edge bundle compiles.

### What it refuses, so a slip cannot reach production

The rules live in [`scripts/sandbox/ci.mjs`](../../scripts/sandbox/ci.mjs) and are unit-tested. The run
stops before anything is built or deployed if:

- the Supabase URL is the **production** project, or a key belongs to a different project than the URL,
  or the anon and service-role keys are swapped;
- the Pages project is the **production** one, or its name does not contain `sandbox` (the Cloudflare
  token can deploy to every project in the account, so a typo must not overwrite another site);
- a Peach endpoint is not a test one, or the Peach group is only half configured;
- the JWT secret does not sign the sandbox project's own keys (it is another project's — for example
  production's);
- the build would be handed a secret — only the public Supabase values reach it.

### What is deliberately switched off

- **Search indexing.** The sandbox is a public copy of the live site: `robots.txt` disallows everything
  and pages carry `noindex`.
- **Analytics.** The Google Tag Manager id is blanked, so test traffic never reaches the live Google
  Analytics.
- **Email and the cron Worker.** The sandbox database holds fake customers and queued emails, so
  nothing here can send mail. "Confirm gallery complete" and the other delivery buttons show the link to
  copy instead of emailing it, and emails queued by payments just wait in the outbox. Bookable dates are
  topped up on each deploy instead of by cron. To add mail later: clear `notification_outbox` first, use
  real inboxes, and update `SITE_URL` in `workers/cron/wrangler.sandbox.toml`.
  (The old `gytm-cron-sandbox` Worker from the Vercel days is still deployed in the Cloudflare account,
  still calling the retired Vercel address every few minutes. It does no harm; re-deploy it with the new
  address to get automatic housekeeping back, or delete it.)
- **Google Maps.** The live key only works on the live domain, so map and planner features are reduced.

Every runtime setting is stored on the Pages project as a **secret**, deliberately: with a Wrangler
config file in the repo (`wrangler.toml`), a deploy may overwrite plain-text variables set outside it,
but Cloudflare states Wrangler never deletes secrets. The health check also fails the run if Peach keys
were configured but the deployed site still cannot take a payment.

The site is public but unlisted. If you would like it private, a Cloudflare Access policy on the Pages
project (dashboard → Workers & Pages → the project → Settings) is an optional extra.

> **The release pipeline's payment probe still points at the old test site.** The repository variable
> `PAYMENT_SMOKE_BASE_URL` is `https://belle-mare-sandbox.vercel.app`. If you retire the Vercel site,
> point it at the new address (and keep `PAYMENT_SMOKE_SUPABASE_*` on the same sandbox project).

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
