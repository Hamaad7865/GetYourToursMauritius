# Belle Mare Tours — Maintenance Handbook

Everything you need to run, change, deploy and fix this app **without the AI that built it**.

Two audiences:

- **Owner / operator** — you don't write code. You need [Operations](handbook/operations.md).
- **Developer** — you're changing code. Read [Architecture](handbook/architecture.md), then
  [Development](handbook/development.md), then **[Landmines](handbook/landmines.md)** before you touch
  anything. The landmines page is not optional; it is the accumulated scar tissue of this codebase.

---

## The 60-second orientation

A Mauritius tour-booking site. Customers browse tours, pick a date, hold a seat, pay by card, and get an
emailed invoice. The owner runs everything from a `/admin` back-office.

| Piece              | What it is                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| **Web app**        | Next.js 15 (App Router). **Every route runs on the edge**, not Node.                                       |
| **Hosting**        | Cloudflare Pages, project named by the `CLOUDFLARE_PAGES_PROJECT` repo variable (`getyourtoursmauritius`). |
| **Database**       | Supabase (Postgres). **All business logic lives in SQL functions**, not in JS.                             |
| **Payments**       | Peach Payments (embedded card widget, EUR).                                                                |
| **Email**          | Resend. Sent from `bookings@`, replies go to `info@`.                                                      |
| **Scheduled work** | A **separate** Cloudflare Worker (`workers/cron/`).                                                        |

> ⚠️ **Two eras.** A fully-automated release pipeline (`.github/workflows/release.yml`) exists in
> the repo, but does not run for real until a human completes its
> [bootstrap checklist](handbook/deployment.md#bootstrap-checklist-do-this-once-in-this-exact-order).
> Everything below describes the pipeline's target state; **check with whoever last touched
> `deployment.md`'s top banner before assuming it's live** — until then, the three-manual-parts
> reality further down is what's actually happening.

**Once bootstrapped**, a single `git push` to `main` ships all three parts, in order, automatically —
web, then database (gated on an explicitly-reconciled migration ledger), then the cron Worker, then a
battery of post-deploy verification. **Before that** (and this is the current reality as of this
writing), this app has **three moving parts that deploy separately**, and pushing to `main` only ships
one of them:

| Part            | How it ships (manual era)                                 | Ships on `git push`? |
| --------------- | --------------------------------------------------------- | -------------------- |
| The web app     | Cloudflare Pages, connected to Git                        | ✅ Yes               |
| The database    | A human pastes `supabase/catch-up.sql` into Supabase      | ❌ **No**            |
| The cron Worker | `npx wrangler deploy --config workers/cron/wrangler.toml` | ❌ **No**            |

Forgetting the second one means the site 500s on the new feature. Forgetting the third means **emails
stop and seats stay locked forever** — silently, with a perfectly green deploy. (Once bootstrapped,
the pipeline itself refuses to let this happen — see `handbook/deployment.md`.)

---

## "Something is wrong" — start here

| Symptom                                   | Almost certainly                                           | Go to                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Customer paid, booking still says pending | Settlement event never ingested                            | [Operations → paid but not confirmed](handbook/operations.md#a-customer-paid-but-the-booking-is-not-confirmed) |
| No confirmation emails at all             | **The cron Worker is dead**                                | [Operations → the cron](handbook/operations.md#nothing-is-emailing-anyone)                                     |
| Tours show "no dates available"           | **The cron Worker is dead** (availability stopped rolling) | [Operations → the cron](handbook/operations.md#tours-say-no-dates-available)                                   |
| Site 500s on every page                   | `nodejs_compat` flag lost, or a bad env var                | [Deployment → Cloudflare](handbook/deployment.md#cloudflare-pages)                                             |
| Site 500s only on one new feature         | You deployed code without running the SQL                  | [Database → applying to prod](handbook/database.md#owner-applying-an-update-to-production)                     |
| CI is red                                 | Probably `format:check`                                    | [Development → the gate](handbook/development.md#the-gate-run-this-before-every-push)                          |
| Nobody can pay                            | `NEXT_PUBLIC_SITE_URL` wrong → payments **fail closed**    | [Deployment → env vars](handbook/deployment.md#environment-variables)                                          |
| Admin photo uploads fail silently         | The Storage bucket was never created                       | [Operations → admin](handbook/operations.md#photo-uploads-fail-silently)                                       |

**First diagnostic, always:**

```bash
curl -s "https://bellemaretours.com/api/v1/health?deep=true"
```

`200` + `"status":"ok"` means config is sane. `503` + `"status":"degraded"` **names the failing check**
in the body (`siteUrlConfigured`, `internalTasksConfigured`, `paymentsSafe`, …). It also reports
`releaseSha` / `releaseRunId` — compare against `git rev-parse HEAD` on `main` to confirm the deployed
build is actually current. It is the single most useful URL in this system.

---

## The handbook

1. **[Architecture — what's linked to what](handbook/architecture.md)**
   The request flow, the money path end to end, and the "if you change X you must also change Y" table.
   Read this before your first change.

2. **[Development — making a change](handbook/development.md)**
   Local setup, the CI gate, and copy-paste recipes for the common jobs (add a page, add an API field,
   change a price rule, add an admin-editable setting).

3. **[Database — the SQL discipline](handbook/database.md)**
   The highest-risk surface. Three SQL files must stay in step, and production is updated **by hand**.
   The full "add a migration" recipe.

4. **[Deployment — shipping it](handbook/deployment.md)**
   CI, Cloudflare Pages, the cron Worker, environment variables, and how to roll back.

5. **[Operations — the owner's runbook](handbook/operations.md)**
   No code. What you can change yourself in `/admin`, how to give someone access, and how to diagnose
   the things that actually go wrong.

6. **[Landmines — how this codebase bites](handbook/landmines.md)** ⚠️
   Non-obvious invariants that a competent developer _will_ violate on day one. Several of these have
   already caused real incidents.

### Also in `docs/`

- [`domain-cutover-runbook.md`](domain-cutover-runbook.md) — moving DNS to Cloudflare without breaking email.
- [`api/`](api/) — the OpenAPI spec.
- [`legal/`](legal/) — privacy policy, terms, DPA drafts.

---

## The five rules

If you remember nothing else from this handbook:

1. **Never let the client name a price.** The browser sends _what_ is being booked, never _how much_.
   The server recomputes every amount from the database. ([why](handbook/landmines.md#money))

2. **A booking is only ever confirmed by `append_payment_event`.** Never `UPDATE bookings SET
status='confirmed'` by hand — you'd skip the underpayment guard and the capacity re-check.

3. **Migration first, then mirror into `catch-up.sql`.** Pre-bootstrap, also run the SQL on prod
   _before_ you push the code — the pipeline doesn't exist yet to apply it, and nothing will remind
   you. Once bootstrapped, `release.yml` applies it automatically on push, in the correct order — but
   the migration-first mirroring discipline itself never goes away.

4. **Pre-bootstrap, the cron Worker is not deployed by `git push`.** If you touched `workers/cron/`,
   run wrangler by hand. Once bootstrapped, `release.yml` deploys it automatically, sequentially
   after the web app, from the same commit.

5. **Run the whole gate before pushing** — including `format:check` and `test:coverage`. CI fails fast,
   so one missed formatting error hides the _five_ checks after it, including the only test that proves
   the Cloudflare bundle builds.
