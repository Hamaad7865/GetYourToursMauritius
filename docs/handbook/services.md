# Services & configuration

Every external service this app depends on, every environment variable, and **where each value has to be
set**. This is the page to open when something is misconfigured, when you're provisioning a new
environment, or when you're handing the project to someone else.

The authoritative list of variables is always the Zod schema in
[`src/lib/config/env.ts`](../../src/lib/config/env.ts). This page explains what they _do_ and what breaks
without them — the schema alone won't tell you that.

---

## The service map

| Service                           | What it does here                                                           | Breaks how                                                        |
| --------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Supabase**                      | Database, auth, file storage. All business logic (43 `api_*` SQL functions) | API 500s; in dev it silently serves fake seed data instead        |
| **Cloudflare Pages**              | Hosts the web app on the edge. Deploys from `main`                          | Missing `nodejs_compat` → every page 500s on a green build        |
| **Cloudflare Worker `gytm-cron`** | The scheduler. Pages has no cron                                            | **Email stops and the calendar empties.** Silent                  |
| **Peach Payments**                | Card checkout (embedded widget, EUR)                                        | Fails closed on production rather than serving a fake provider    |
| **Resend**                        | All transactional email                                                     | Outbox rows go `failed` and stay visible — never silently dropped |
| **Google Maps Platform**          | Maps, geocoding, Routes, Places                                             | Degrades gracefully to keyless map links                          |
| **Google Route Optimization**     | Auto-orders planner stops (service account, not a key)                      | Nothing — returns `null`, planner keeps the chosen order          |
| **Google Gemini**                 | AI road-trip planner co-pilot                                               | Falls back to a stub provider                                     |
| **Telegram**                      | Owner booking alerts (the live chat channel)                                | Alert row fails loudly and retries                                |
| **Meta WhatsApp Cloud API**       | Inbound webhook live; owner alerts pending setup                            | Endpoint answers 503 until configured                             |

---

## Two things that govern all configuration

**1. Almost nothing is "required" in the schema — enforcement happens downstream.**

Of the 42 variables, only three have defaults (`NEXT_PUBLIC_SITE_URL`, `AI_PROVIDER`,
`PEACH_ENVIRONMENT`); every other one is optional. `getServerEnv()` throws only when a value that _is_
present is malformed. **A missing variable never fails validation.** The app boots happily without
Supabase, without Peach, without Resend.

What saves you is `isProductionLikeRuntime()` in
[`src/lib/config/runtime.ts`](../../src/lib/config/runtime.ts), which is true when **any** of these hold:

- `PEACH_ENVIRONMENT=live`, or
- `NODE_ENV=production`, or
- `SUPABASE_SERVICE_ROLE_KEY` is set

…and is hard-coded false under `next dev`. On a production-like runtime, payments refuse to start rather
than use the stub, notifications fail closed, and `/health` reports 503. **Do not "fix" those throws by
loosening the checks — fix the variable.**

**2. Four variables are baked in at build time, not read at runtime.**

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` and
`NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` are read as raw `process.env` inside client modules, so they are inlined
into the browser bundle when Pages builds. They must exist in the **build** environment.

More generally: **an environment-variable change does nothing until you redeploy.** Saving a value in the
Cloudflare dashboard does not touch the deployment currently serving traffic.

---

## The environment variable matrix

Where: **P** = Cloudflare Pages · **W** = the `gytm-cron` Worker's own secrets · **L** = `.env.local`
(for `next dev`) · **D** = `.dev.vars` (for `wrangler pages dev`)

### Core — the site does not work without these

| Variable                        | Controls                                                 | Unset →                                                             | Where               |
| ------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------- | ------------------- |
| `NEXT_PUBLIC_SITE_URL`          | Canonicals, OG, sitemap, JSON-LD, CORS, Peach return URL | Defaults to localhost → **payments refuse to start**, `/health` 503 | P, L, D             |
| `NEXT_PUBLIC_SUPABASE_URL`      | Database + JWKS issuer                                   | Prod: 500s. Dev: fake seed data                                     | P (build+run), L, D |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon/RLS reads, browser client                           | Same as above                                                       | P (build+run), L, D |
| `SUPABASE_SERVICE_ROLE_KEY`     | Webhooks, cron, admin. **Also flags "production-like"**  | Internal endpoints throw                                            | P, L, D             |
| `INTERNAL_TASK_SECRET`          | Auth on both internal endpoints                          | Endpoints 503 → **the cron silently does nothing**                  | **P + W** ⚠️        |

### Payments — all five needed together

`PEACH_CLIENT_ID`, `PEACH_CLIENT_SECRET`, `PEACH_MERCHANT_ID`, `PEACH_ENTITY_ID`,
`PEACH_CHECKOUT_BASE_URL`. Missing any one on a production-like runtime makes `getPaymentProvider()`
**throw** — deliberately, because the stub provider's webhook accepts any body and defaults to `paid`.

| Variable               | Controls                                           | Unset →                                                    |
| ---------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `PEACH_AUTH_BASE_URL`  | OAuth host                                         | Falls back to the checkout base URL                        |
| `PEACH_WEBHOOK_SECRET` | HMAC signature verification                        | Falls back to re-querying Peach — degraded, not broken     |
| `PEACH_WEBHOOK_URL`    | The URL Peach signs over                           | Same fallback                                              |
| `PEACH_ENVIRONMENT`    | `test` \| `live`. **`live` flags production-like** | Defaults to `test` (sandbox widget)                        |
| `PEACH_EXPECT_LIVE`    | Go-live arming switch                              | Readiness stays green on sandbox. Set `true` on launch day |

`PEACH_ENTITY_ID` is deliberately shipped to the browser as the widget key. It is not a secret.

### Email

| Variable                 | Controls                      | Unset →                                                        |
| ------------------------ | ----------------------------- | -------------------------------------------------------------- |
| `RESEND_API_KEY`         | All outbound mail             | Prod: rows go `failed`. Dev: silent no-op stub                 |
| `RESEND_FROM`            | Sender (`bookings@…`)         | Same                                                           |
| `AUTH_EMAIL_FROM`        | Auth-email sender             | Falls back to `RESEND_FROM`                                    |
| `SEND_EMAIL_HOOK_SECRET` | Supabase Send-Email hook HMAC | Endpoint **503** → every password reset and confirmation fails |
| `OWNER_NOTIFY_EMAIL`     | Where owner alerts land       | Defaults to `info@bellemaretours.com`                          |

Two mailboxes, two jobs: `bookings@` is send-only (nobody reads it); `info@` is the human inbox and the
Reply-To on every message, so a guest replying to a confirmation reaches a person.

### Owner alerts

| Variable                           | Controls                                     | Unset →                                                      |
| ---------------------------------- | -------------------------------------------- | ------------------------------------------------------------ |
| `TELEGRAM_BOT_TOKEN`               | Bot API                                      | Fail-closed provider on production                           |
| `TELEGRAM_OWNER_CHAT_ID`           | Destination chat (or a comma-separated list) | **Throws** → visible `failed` outbox row                     |
| `WHATSAPP_ACCESS_TOKEN`            | Cloud API send                               | Alert row fails                                              |
| `WHATSAPP_PHONE_NUMBER_ID`         | Which number sends                           | Same                                                         |
| `OWNER_WHATSAPP_TO`                | Owner's number, digits only                  | Same                                                         |
| `WHATSAPP_TEMPLATE_NAME` / `_LANG` | Out-of-session template                      | Free-form text only, which only delivers inside a 24h window |

See [`whatsapp-setup-runbook.md`](../whatsapp-setup-runbook.md) for the full WhatsApp walkthrough.

### Webhooks in

| Variable                        | Controls                       | Unset →                                    |
| ------------------------------- | ------------------------------ | ------------------------------------------ |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Meta's GET handshake           | Endpoint **503** → Meta verification fails |
| `WHATSAPP_APP_SECRET`           | `X-Hub-Signature-256` on POSTs | Endpoint **503** → deliveries rejected     |

### Maps & AI — all optional, all degrade gracefully

| Variable                          | Controls                                    | Unset →                                        |
| --------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` | Maps **JavaScript** API + Geocoder          | Keyless "View on Google Maps" links            |
| `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`  | Advanced markers / vector maps              | Falls back to Google's public demo map id      |
| `GOOGLE_MAPS_API_KEY`             | Server-side Routes + Places (New)           | Haversine estimates; planner can't list places |
| `GOOGLE_SERVICE_ACCOUNT_JSON`     | Route Optimization (full SA JSON, one line) | Stop order left as chosen                      |
| `GOOGLE_CLOUD_PROJECT`            | Overrides the SA's project id               | Uses `project_id` from the JSON                |
| `AI_PROVIDER`                     | Provider select                             | Defaults to `google`                           |
| `GOOGLE_GENERATIVE_AI_API_KEY`    | Gemini co-pilot                             | Stub provider                                  |
| `GOOGLE_GENERATIVE_AI_MODEL`      | Model override                              | `gemini-2.5-flash`                             |

> The browser Maps key needs the **Maps JavaScript API**, not the Embed API — the code loads
> `libraries=places,marker,routes` and drives the Geocoder. An Embed-only key produces a broken map.

### Auth legacy

`SUPABASE_JWT_SECRET` and `ACCEPT_LEGACY_HS256` exist only for the legacy HS256 path, which is **off by
default**. Leave both unset in production; the app signs ES256 and verifies via JWKS. Setting
`ACCEPT_LEGACY_HS256=true` on production makes `/health` report 503, on purpose.

---

## ⚠️ Values that must match in more than one place

These are the ones that bite, because half-applying them leaves the site looking perfectly healthy.

1. **`INTERNAL_TASK_SECRET`** — Cloudflare Pages **and** the `gytm-cron` Worker's secrets. Rotate one
   without the other and every cron tick 401s while the site stays green.
2. **The domain** — five places: `NEXT_PUBLIC_SITE_URL` (Pages), `SITE_URL` in
   `workers/cron/wrangler.toml`, `PEACH_WEBHOOK_URL` (Pages), the Resend verified domain, and Supabase's
   Auth → Redirect URLs.
3. **`WHATSAPP_WEBHOOK_VERIFY_TOKEN`** — Pages **and** the Meta dashboard, identical, deployed _before_
   you click "Verify and save".
4. **`SEND_EMAIL_HOOK_SECRET`** — generated by Supabase, pasted into Pages, redeployed, and _only then_
   is the hook enabled. Enable it first and every auth email fails during the gap.

---

## Configuration that isn't an environment variable

Easy to forget, because it lives in a dashboard and nothing in the repo will remind you.

### Supabase

- **Storage bucket `activity-images`** — public, plus four RLS policies. Created by **step 3 of
  `supabase/admin-setup.sql`**, which is _not_ part of `setup.sql` or `catch-up.sql` and must be run by
  hand once. Skip it and admin photo uploads fail silently.
  > ⚠️ **Step 1 of that same file deletes every activity except `north-tour`.** Never run the file whole
  > against a live catalogue — run step 3 only.
- **Auth → URL Configuration → Redirect URLs** — must include the production origin and
  `/auth/reset-password`, plus `http://localhost:3000/**` for dev. Note that Supabase auth redirects
  derive from `window.location.origin`, **not** `NEXT_PUBLIC_SITE_URL`.
- **Auth → Hooks → Send Email** — points at `/api/v1/hooks/send-email`. Order matters (see above).
- **Auth → Rate Limits** — the default per-hour email cap is restrictive.
- **Auth → Providers** — Google is enabled and wired into the sign-in dialog.
- **Roles are data, not config** — `update profiles set role = 'admin' where id = '…'`. The `seo` role is
  RLS-locked out of bookings and customer PII.

### Cloudflare

- **Pages build**: production branch `main`, build command `npm run pages:build`, output
  `.vercel/output/static`, `NODE_VERSION=22`.
- **`compatibility_flags = ["nodejs_compat"]`** — set it for **both** Production and Preview. Losing it
  500s the entire site on a build that succeeded.
- **Custom domains**: apex + `www`. Four non-canonical hosts 308 to the apex; hash-prefixed preview hosts
  get `X-Robots-Tag: noindex`.
- **DNS**: Resend MX/SPF/DKIM + DMARC, all **DNS-only (grey cloud)**.
  > ⚠️ **One SPF record per domain.** A second `v=spf1` is a permerror that collapses deliverability.
- **Email Routing**: `info@bellemaretours.com` → the owner's real inbox. It's the Reply-To on every
  booking email; until it exists, customer replies bounce.
- **Logpush / Workers Logs** — must be enabled to retain or search the structured JSON logs.
- **WAF / rate limiting / Turnstile — none configured.** Rate limiting today is database-backed per IP.
  The code asks for an edge rule on the expensive public routes; treat it as an open pre-launch item.

### Meta (WhatsApp)

App, callback URL, verify token, app secret, and the WABA / Phone Number ID pair. A **stale Phone Number
ID fails quietly** — re-read it from the dashboard rather than trusting a note. See the
[WhatsApp runbook](../whatsapp-setup-runbook.md).

### Peach

Merchant onboarding, live credentials, and registering the webhook URL.

---

## Variables that do nothing

Declared or documented, read by no code. Setting them has no effect:

`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` (the
`workersai` / `anthropic` / `openai` branches of `AI_PROVIDER` all return the stub), and `MUR_PER_EUR`.

## Variables read by code but absent from the schema

Nothing validates or warns on these:

| Variable                       | Read by                         | Note                                                    |
| ------------------------------ | ------------------------------- | ------------------------------------------------------- |
| `NEXT_PUBLIC_GSC_VERIFICATION` | `app/layout.tsx`                | Google Search Console verification meta tag             |
| `ENABLE_PREVIEW_FALLBACK`      | `src/lib/http/context.ts`       | ⚠️ **`=true` on production serves fake catalogue data** |
| `SUPABASE_DB_URL`              | `scripts/db-exec.ts` and others | Scripts only, never the app                             |
| `PEXELS_API_KEY`               | `scripts/fetch-blog-photos.ts`  | Scripts only                                            |

---

## First diagnostic

```bash
curl -s "https://bellemaretours.com/api/v1/health?deep=true"
```

`200` + `"status":"ok"` means the configuration is sane. `503` + `"status":"degraded"` **names the failing
check** in the body (`siteUrlConfigured`, `internalTasksConfigured`, `paymentsSafe`, …).

`/health` does **not** cover everything. It says nothing about whether the cron Worker is actually
running, and it does not gate on email being configured. To check those:

```bash
npx wrangler tail --config workers/cron/wrangler.toml   # expect [cron] POST … -> 200 every 2 min
```

```sql
-- Notifications that failed and why. An unconfigured channel shows up here, never silently.
select channel, template, attempts, last_error, created_at
from notification_outbox
where status = 'failed'
order by created_at desc
limit 20;
```

That query is the fastest way to find a half-configured alert channel — it is exactly how the owner's
Telegram alerts were found to have never been configured in production, while email alerts for the same
bookings were going out fine.
