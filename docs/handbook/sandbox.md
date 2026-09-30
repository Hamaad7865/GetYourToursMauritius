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

3. **Peach sandbox dashboard** (`sandbox-dashboard.peachpayments.com` — the test one, never the live
   one). Open **Checkout** in the left menu and do these three things:
   - **Allowlisted domains → Add domain:** `belle-mare-sandbox.pages.dev` — the bare host, no
     `https://`, no wildcard (Peach documents none, and `*.pages.dev` would be every site on
     Cloudflare). **Required.** Without it the widget will not load and every checkout fails for the
     guest with **"An upstream service is unavailable"** while your keys are perfectly fine (Peach
     answers "Merchant domain is not allowlisted"). Switching Peach accounts does **not** carry the
     allow-list with it. The release pipeline's payment probe needs this entry too. Sandbox domains need
     no Peach review. Test on this stable address, never the `<hash>.belle-mare-sandbox.pages.dev` link
     a deploy prints: that is a different host.
   - **Webhooks → Add webhook URL:** `https://belle-mare-sandbox.pages.dev/api/v1/webhooks/payments`,
     typed exactly like that. It is the address every deploy hands the site as `PEACH_WEBHOOK_URL`, and
     Peach signs over a URL. Peach sends each event to the dashboard URL **and** to the address the site
     attaches to every checkout, and its documentation does not say which of the two the signature
     covers, so keep them identical. Delete the entry for the retired `belle-mare-sandbox.vercel.app`
     (it is dead, and Peach retries a failing address for 30 days); keep only entries still in use,
     such as a dev tunnel.
   - **Webhook security:** the key shown must equal `PEACH_WEBHOOK_SECRET` in `.env.local` (uploaded as
     `SANDBOX_PEACH_WEBHOOK_SECRET`). **Never press "Regenerate secret key"**: it takes effect at once
     and breaks every site using the old one. If no key is shown, HMAC signing is not switched on for
     the test account, so webhooks are rejected and payments settle more slowly, through the
     confirmation poll and the Worker's 5-minute reconcile.

   Then book once with a Peach test card on the stable address to confirm.

4. **Have something to book.** For the photography gallery flow the sandbox needs a **published
   Photography package with open dates** (Admin → Photography).

5. **Optional: receive the sandbox's emails.** The sandbox database is full of fake customers, so mail is
   only ever delivered to **one inbox of yours**: the app diverts every email there, subject-tagged
   `[sandbox → who it was really for]`, with no copy to the real `info@` inbox. A mail key that does not
   come with that inbox is refused before anything is built.
   - In Resend → **API Keys** → **Create API Key**: name it `gytm-sandbox`, permission **Sending access**,
     domain `bellemaretours.com`. It is a separate key so the live one is never involved and this one can
     be revoked on its own.
   - Add three lines to `.env.local`. The names are deliberately different from the production
     `RESEND_API_KEY`, which this tool never reads:
     `SANDBOX_RESEND_API_KEY=re_…`, `SANDBOX_RESEND_FROM=Belle Mare Tours <bookings@bellemaretours.com>`
     and `SANDBOX_EMAIL_REDIRECT_TO=` the inbox you will read.
   - Run `npm run sandbox:secrets`, then deploy. The run summary says **Mail: ON**, and the health check
     fails the run if the deployed site cannot actually send.

   Emails queued by the database go out within about two minutes (the cron Worker drains the outbox); the
   admin buttons ("Confirm gallery complete", …) send at once. To switch mail off again, delete the three
   settings from GitHub and deploy: the deploy clears them from the project.

6. If the sandbox Supabase project is **paused** (free projects pause after about a week idle), click
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
- a mail key arrives without the redirect inbox (or the inbox cannot receive mail, or mail is only half
  configured), and, at run time, the app itself refuses to send if the redirect is ever set on a
  live-payments deployment;
- the JWT secret does not sign the sandbox project's own keys (it is another project's — for example
  production's);
- the build would be handed a secret — only the public Supabase values reach it.

### What is deliberately switched off

- **Search indexing.** The sandbox is a public copy of the live site: `robots.txt` disallows everything
  and pages carry `noindex`.
- **Analytics.** The Google Tag Manager id is blanked, so test traffic never reaches the live Google
  Analytics.
- **Email is off until you switch it on** (step 5 above). With no mail key nothing is sent
  (`emailConfigured:false` in `/api/v1/health`), and "Confirm gallery complete" and the other delivery
  buttons show the link to copy instead. With one, every email still goes to a single inbox of yours and
  to nobody else, because the database holds fake customers and the cron Worker drains the outbox every
  two minutes. Old mail is not replayed when you switch it on: only `pending` rows are ever retried, and
  a row that has failed five times is final.
- **The cron Worker is on, and sends nothing.** `gytm-cron-sandbox` (deployed by hand from
  `workers/cron/wrangler.sandbox.toml`, separate from production's `gytm-cron`) calls the sandbox site.
  Every 5 minutes it expires holds, reconciles payments against Peach's test API and rolls the bookable
  dates forward. Every 2 minutes it runs the email drain: with no mail key it fails closed (queued
  emails are marked `failed` and nothing leaves); with mail on (step 5) it sends them, to your one
  inbox. It was re-pointed from the retired Vercel address
  on 2026-10-01. After any address change, redeploy it with
  `npx wrangler deploy --config workers/cron/wrangler.sandbox.toml`; then
  `npx wrangler tail --config workers/cron/wrangler.sandbox.toml` should show `-> 200` on both paths
  (a 401 means its `INTERNAL_TASK_SECRET` no longer matches the site's; the header of that file has the
  command). Each deploy also tops up bookable dates on its own.
- **Google Maps.** The live key only works on the live domain, so map and planner features are reduced.

Every runtime setting is stored on the Pages project as a **secret**, deliberately: with a Wrangler
config file in the repo (`wrangler.toml`), a deploy may overwrite plain-text variables set outside it,
but Cloudflare states Wrangler never deletes secrets. The health check also fails the run if Peach keys
were configured but the deployed site still cannot take a payment.

The site is public but unlisted. If you would like it private, a Cloudflare Access policy on the Pages
project (dashboard → Workers & Pages → the project → Settings) is an optional extra.

> **The release pipeline's payment probe targets this site.** The repository variable
> `PAYMENT_SMOKE_BASE_URL` is `https://belle-mare-sandbox.pages.dev`. It was the Vercel address, which
> answered HTTP 402 once Vercel suspended that project, so the probe ended every release red from
> 2026-09-04 until it was re-pointed on 2026-10-01 (production itself deployed fine each time; only the
> closing check failed). The probe signs in with the `PAYMENT_SMOKE_*` secrets, which must stay on this
> same sandbox Supabase project, and its last step creates a real Peach **test** checkout, so it passes
> only once the allow-list entry in step 3 exists. Only a brand-new release run uses the new value:
> re-running an old run has replayed its old settings before.

### Test the whole photography flow, with emails

Do this once the sandbox runs the latest code, Peach is allow-listed (step 3) and mail is on (step 5).
Everything below arrives in **your one inbox**, subject-tagged `[sandbox → …]`, so the guest's address
does not matter.

**1 · Book it, as the guest**

1. Open the sandbox site and sign in as `customer@sandbox.test` (password in the table near the top).
2. **Photography** → _Holiday — Beach Shoot, Honeymoon and Couple Shoot_ → pick a date → checkout.
3. Pay the 50% deposit with a Peach test card: Visa `4200 0000 0000 0000`, any future expiry, any three
   digits for the CVV (3-D Secure is off for that number; Peach lists the others in its
   [test-card reference](https://developer.peachpayments.com/docs/reference-test-and-go-live)).

   Within about two minutes you get the **deposit receipt** (with its PDF) and the **owner's new-booking
   alert**.

**2 · Deliver it, as the studio**

4. Sign in as `admin@sandbox.test` → **Admin → Photography → Customer galleries** → expand the booking.
5. Upload a few photos (a video too, if you like) and press **Confirm gallery complete**. The
   **"Your photos are ready — balance for booking …"** email is sent at once, with a link to the pay box,
   and the gallery shows **Awaiting balance**.

   Signed in as the guest, **Account → Galleries** now lists the shoot as **Locked** with a **Pay the
   balance** button, and the gallery API sends no photo URLs yet.

**3 · Pay the balance, as the guest**

6. Open the link in that email (or Account → Galleries → **Pay the balance**) and pay the remaining 50%.
   Within about two minutes you get the **full VAT invoice** (PDF), the **owner's balance-paid alert**
   and **"Your gallery is ready — booking …"** with the gallery link.
7. Open the gallery: Account → Galleries → **View gallery**. The photos are there.

If an email is missing: the admin button shows the same link to copy; `npx wrangler tail --config
workers/cron/wrangler.sandbox.toml` shows every drain; and in the sandbox Supabase SQL editor
`select template, status, last_error from notification_outbox order by created_at desc limit 20;` says
what happened to each row.

## Resetting

- **Rebuild the fake bookings:** `delete from bookings where notes = 'sandbox-seed';` then re-run
  `npm run sandbox:setup`.
- **Start completely fresh:** delete the Supabase project and create a new one (fastest), or drop the
  public schema and re-run. Because it's throwaway, nuking it costs nothing.

## Notes & limits

- On your own machine (`npm run dev`) payments are stubbed, so a "paid" sandbox booking never involved
  Peach — the stub webhook just marks it paid. To test the real Peach integration use the **hosted**
  sandbox above (Peach TEST keys and test cards, once its domain is allow-listed), or a tunnel added to
  the Peach allow-list (see [`.env.example`](../../.env.example) and the Peach section).
- Optional integrations (Google Maps, AI planner, Telegram/WhatsApp alerts) stay off until you add their
  keys — everything else works without them.
- **Never** run `npm run sandbox:setup` with production credentials in `.env.local`. It will refuse, but
  the habit to keep is: sandbox keys for the sandbox, and swap your `.env.local` back to prod when done.
