# Deployment — shipping it

[← Handbook](../HANDBOOK.md)

---

## ⚠️ Read this before assuming any of this is live

This file describes a **fully-automated release pipeline** (`.github/workflows/release.yml` +
`.github/workflows/ci.yml`) that exists in the repository as of 2026-07-21. The repository-side
implementation is complete and unit-tested. **It is NOT yet operating in production.** Nothing in
this pipeline runs for real until a human completes the [Bootstrap checklist](#bootstrap-checklist-do-this-once-in-this-exact-order)
below — secrets and variables configured, the Cloudflare dashboard toggle flipped, the ledger
reconciled. Until then, the OLD manual process (further down, [Rolling back](#rolling-back) /
["the part everyone forgets"](#the-cron-worker--the-part-everyone-forgets)) is still what's actually
happening: Cloudflare Pages Git integration deploys on every push, and the database is still updated
by hand. **Do not tell anyone "the release pipeline is live" until you've watched one real
push-to-main go all the way through and verified the deployed SHA from `/api/v1/health`.**

---

## Three things deploy — now on ONE trigger, in ONE strict order

| Part            | How it ships (once bootstrapped)                                                      |
| --------------- | ------------------------------------------------------------------------------------- |
| **Web app**     | `release.yml` → `wrangler pages deploy` of the exact artifact CI built                |
| **Database**    | `release.yml` → `supabase db push` (linked), gated on an explicitly-reconciled ledger |
| **Cron Worker** | `release.yml` → `wrangler deploy --config workers/cron/wrangler.toml`, same SHA       |

All three now happen automatically, in a strict dependency chain, on every push to `main` — **once
bootstrapped**. Before that, see the three manual fallback sections further down in this file.

### The full chain

```
git push main
  → CI (typecheck, lint, format, coverage, build, pages:build, cron dry-run, e2e, actionlint)
  → CI packages .vercel/output/static ONCE into a checksummed, manifested artifact (push-to-main only)
  → Release workflow triggers (workflow_run, only on CI success)
      1. resolve-provenance      — proves: CI succeeded, was a push, was main, was this repo,
                                    not a fork; verifies the artifact SHA + checksum; verifies the
                                    SHA is reachable from origin/main
      2. create-deployment       — opens a GitHub Deployment (environment "production")
      3. cloudflare-preflight    — fails unless Cloudflare's OWN git-integration auto-deploy is
                                    confirmed disabled (see the dashboard step below)
      4. supabase-ledger-gate    — fails unless SUPABASE_MIGRATION_LEDGER_RECONCILED=true, re-checks
                                    parity, `db push --dry-run`, then the REAL `db push`
      5. deploy-web              — `wrangler pages deploy` of the CI artifact (no rebuild)
      6. deploy-cron             — `wrangler deploy` for workers/cron, same SHA, sequential AFTER web
      7. verify-dns-health       — canonical DNS/redirects + deep health, releaseSha must match
      8. payment-probe           — automated Peach SANDBOX probe (availability→hold→booking→
                                    checkout creation) against a SEPARATE staging target, if configured
      9. payment-smoke-manual-gate — a human approves a GitHub Environment after completing ONE
                                    real sandbox payment through the live site (see below — this
                                    step is deliberately NOT automated)
     10. mark-deployment-success — GitHub Deployment marked "success"
  → any failure at any stage stops everything after it and marks the deployment "failure",
    surfacing the previous deployment/version ids captured before step 5/6 for manual rollback
```

Nothing in this chain reruns `next build` or `pages:build` — CI builds it once, `release.yml` only
ever deploys the artifact CI already verified.

---

## Bootstrap checklist: do this ONCE, in this EXACT order

Do not skip ahead. Each step assumes the previous one is done.

1. **Merge `.github/workflows/{ci,release,reconcile-supabase-ledger}.yml`** (and the
   `scripts/release/*` they call) to `main`.
2. **Configure GitHub repository secrets and variables** — see the tables below. Least-privilege
   scopes are called out for every credential.
3. **Confirm a database backup / PITR point exists** (Supabase Dashboard → Database → Backups). The
   reconciliation workflow's typed confirmation exists specifically to make you check this.
4. **Run `reconcile-supabase-ledger.yml`** (Actions tab → manual dispatch). Type the exact
   confirmation phrase, give it a successful CI run id. It runs `catch-up.sql`, then
   `backfill-migration-ledger.sql`, verifies 1:1 parity against `supabase/migrations`, and runs
   `db push --dry-run` to prove nothing is pending. Read its job summary.
5. **Set the repository variable `SUPABASE_MIGRATION_LEDGER_RECONCILED=true`.** `release.yml`
   refuses to touch the database until this is exactly `true`.
6. **Disable Cloudflare Pages' automatic Git deployments** — dashboard step, see below. Do this
   AFTER step 1-2 (the preflight check that enforces it must already exist) and AFTER you're ready
   to cut over, since from this point the OLD automatic-on-push behavior stops.
7. **Manually dispatch a dry-run release** (`workflow_dispatch` on `release.yml` with a recent
   successful CI run id) and watch it end-to-end in the Actions tab.
8. **Push a harmless change** (e.g. a comment/whitespace tweak) and confirm the COMPLETE pipeline
   runs automatically: CI → release → deployed.
9. **Verify the deployed SHA** — `curl -s https://bellemaretours.com/api/v1/health?deep=true | jq
.data.releaseSha` must equal the pushed commit's SHA.
10. **Only now** is the release path active. Update this file's top banner (or tell the team) once
    you've actually watched step 8-9 succeed — passing repository tests is NOT the same as a
    verified production release.

### Repository secrets to add

| Secret                            | Used by                            | Least-privilege scope                                                                                                           |
| --------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`            | preflight, deploy-web, deploy-cron | Custom token: **Account.Cloudflare Pages: Edit**, **Account.Workers Scripts: Edit** — scoped to ONE account, not Global API Key |
| `CLOUDFLARE_ACCOUNT_ID`           | same as above                      | Not secret-strength, but kept out of the repo body regardless — Dashboard → right sidebar                                       |
| `SUPABASE_ACCESS_TOKEN`           | ledger gate, reconcile workflow    | A personal/service Supabase access token scoped to the ONE project (Dashboard → Account → Access Tokens)                        |
| `SUPABASE_DB_PASSWORD`            | same as above, direct `pg` queries | The project's Postgres password — rotate it if it's ever been pasted anywhere else                                              |
| `PAYMENT_SMOKE_SUPABASE_URL`      | payment-probe (optional)           | The STAGING project's URL — only if the automated probe is enabled                                                              |
| `PAYMENT_SMOKE_SUPABASE_ANON_KEY` | payment-probe (optional)           | The STAGING project's anon key — public-safe by design, but keep it out of the repo body                                        |
| `PAYMENT_SMOKE_USER_EMAIL`        | payment-probe (optional)           | A dedicated synthetic test user on the STAGING project only — never a real customer or the owner account                        |
| `PAYMENT_SMOKE_USER_PASSWORD`     | payment-probe (optional)           | That synthetic user's password                                                                                                  |

Sandbox smoke credentials are only "genuinely required" if you want the automated `payment-probe`
step to actually run (it's skipped with a warning if `PAYMENT_SMOKE_BASE_URL` is unset).

### Repository variables to add

| Variable                               | Example value                           | Notes                                                                                       |
| -------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_PAGES_PROJECT`             | `getyourtoursmauritius`                 | The REAL hosted Pages project name — see the note below on the historical name mismatch     |
| `PRODUCTION_URL`                       | `https://bellemaretours.com`            | Used by health/DNS verification                                                             |
| `CANONICAL_HOST`                       | `bellemaretours.com`                    | No scheme, no trailing slash                                                                |
| `SUPABASE_PROJECT_ID`                  | the project ref, e.g. `abcdefghijklmno` | Dashboard → Settings → General → Reference ID                                               |
| `SUPABASE_MIGRATION_LEDGER_RECONCILED` | `true` (only after step 4 above)        | Exact string `true` — anything else fails closed                                            |
| `PAYMENT_SMOKE_BASE_URL`               | `https://staging.bellemaretours.com`    | A dedicated staging/sandbox deployment — MUST differ from `PRODUCTION_URL`/`CANONICAL_HOST` |

### The Cloudflare project-name mismatch — fixed here, verify in the dashboard

The repo previously called the Pages project `bellemaretours` in `wrangler.toml`, but the actually
hosted project is `getyourtoursmauritius`. `wrangler.toml`'s `name` field only affects local
`wrangler pages dev`; the pipeline always deploys to whatever `CLOUDFLARE_PAGES_PROJECT` names, so
**set that variable to the project's real name** (default documented above). Confirm in the
dashboard which project actually serves `bellemaretours.com` before setting it.

### Exact Cloudflare dashboard setting to disable — do this ONLY after the workflow is merged and secrets are set

**Workers & Pages → `<CLOUDFLARE_PAGES_PROJECT>` → Settings → Builds → Automatic deployments** —
turn OFF "Enable automatic production branch deployments" and set preview deployments to "None" (or
the equivalent current wording — Cloudflare has renamed this UI more than once). `cloudflare-
preflight` in `release.yml` checks this via the Pages API and fails the release if it's still on,
but it cannot flip it for you — the task deliberately never automates this switch, because doing so
before secrets/workflow are ready would leave the site with NO deploy path at all.

---

## Payment smoke gate

The automated `payment-probe` job proves availability → hold → booking → Peach **sandbox checkout
creation** all work, against `PAYMENT_SMOKE_BASE_URL` (a staging deployment, never production). It
deliberately stops there — see `scripts/release/peach-payment-probe.mjs`'s header comment for why
completing a real charge cannot be safely automated (it needs either driving a real browser against
Peach's own hosted card-entry widget, which this repo doesn't own or version-pin, or storing test
card details for programmatic entry, which is out of scope regardless of them being Peach's own
published sandbox numbers).

So the FULL journey — charge → webhook/`payments/sync` → confirmed booking → invoice/receipt — is a
**manual, blocking gate**: `payment-smoke-manual-gate` in `release.yml` pauses on the
`production-payment-smoke` GitHub Environment. Configure required reviewers on that environment
(Settings → Environments) — until you do, it auto-approves, which defeats the point.

**Evidence to gather before approving:** make one real booking through the live site's checkout with
a Peach sandbox test card, confirm the booking reaches `confirmed`/`payment_state: paid`, and confirm
`GET /api/v1/bookings/{ref}/invoice` returns a PDF. Note the booking ref in the approval comment.

---

## Deploying an ordinary change — MANUAL fallback (still true until bootstrap is complete)

```bash
# 1. The gate (Windows can run all but the last CI step)
npm run typecheck && npm run lint && npm run format:check && npm run test:coverage && npm run build

# 2. Ship
git push origin main

# 3. WATCH CI — its final step (Edge bundle) is the only proof the Cloudflare artifact builds,
#    and it's the step you could not run locally.
gh run watch --exit-status

# 4. Cloudflare Pages builds the same commit and deploys it (until step 6 of the bootstrap
#    checklist is done — after that, release.yml deploys it instead).
curl -i "https://bellemaretours.com/api/v1/health?deep=true"     # expect 200 "status":"ok"
```

## Deploying a change that includes SQL — **order matters** (manual fallback)

```
1. Write the migration + mirror it into catch-up.sql + regenerate setup.sql
2. Run the local gate
3. ▶ OWNER RUNS supabase/catch-up.sql ON PRODUCTION  ← BEFORE the code ships (only if the ledger
   pipeline below isn't live yet; once bootstrapped, `release.yml`'s `supabase db push` does this)
4. git push origin main
```

Push the code first and every request touching the new RPC or column **500s** until someone remembers to
paste the SQL. The other order is safe: the migrations are additive, so the _old_ code keeps working
against the _new_ schema. **Once the release pipeline is bootstrapped, `supabase/migrations/` stays
the source of truth and `db push` applies it automatically** — but still write the migration BEFORE
merging the code that depends on it, same ordering logic, now enforced by the pipeline instead of a
human's memory.

---

## Continuous integration

`.github/workflows/ci.yml`. Runs on every push to `main` and every PR. **Fail-fast — a failure at any
step skips everything after it.**

| #   | Step                        | Notes                                                                 |
| --- | --------------------------- | --------------------------------------------------------------------- |
| 1   | `npm ci`                    | Node 22                                                               |
| 2   | `npm run typecheck`         |                                                                       |
| 3   | `npm run lint`              |                                                                       |
| 4   | `npm run format:check`      | **The step people forget.** Fails → steps 5–8 never run.              |
| 5   | `npm run test:coverage`     | Tests + coverage floors + all the drift guards + release-script tests |
| 6   | release metadata write      | Bakes the git SHA + run id into the bundle (see below)                |
| 7   | `npm run build`             |                                                                       |
| 8   | **`npm run pages:build`**   | **The actual deployable Cloudflare artifact**                         |
| 9   | cron Worker dry-run         | `wrangler deploy --dry-run` — compiles + validates, no deploy         |
| 10  | (push to main only) package | tarball + manifest.json, uploaded as a short-retention artifact       |

A separate `e2e` job runs the Playwright smoke in parallel, and a separate `lint-workflows` job runs
`actionlint` on every workflow file — neither can block the unit gate on its own flake.

**Step 8 is the whole point.** `next build` passing does **not** mean the edge bundle builds. And because
`pages:build` cannot run on Windows (`spawn npx ENOENT`), CI is the _only_ place it is ever verified.
A red `format:check` therefore hides it completely — which is exactly how five commits once shipped
without the edge bundle ever being built.

### Release provenance — how `releaseSha` gets into `/api/v1/health`

Cloudflare Pages env vars are configured per-PROJECT in the dashboard, not per-deploy, and a
pre-built artifact deploy gets none of the `CF_PAGES_*`/`WORKERS_CI_*` variables (those only exist
inside Cloudflare's OWN git-integration build, which this pipeline deliberately bypasses). So the
release SHA + run id are baked into the bundle at BUILD time as literal TypeScript constants —
`src/lib/config/release-metadata.generated.ts`, overwritten by
`scripts/release/write-release-metadata.mjs` right before `next build` runs in CI, on every run
(harmless on a PR build; the value is simply never deployed). The committed file defaults both to
`null`, so a fresh checkout still builds without CI having touched it.

---

## Cloudflare Pages

Project name lives in the `CLOUDFLARE_PAGES_PROJECT` repository variable (default
`getyourtoursmauritius` — see the mismatch note above), not hardcoded in the repo.

| Setting                | Value                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production branch      | `main`                                                                                                                                                                           |
| Framework preset       | None                                                                                                                                                                             |
| Build command          | _(none once bootstrapped — the release pipeline deploys a pre-built artifact; leave the OLD `npm run pages:build` config in place only until step 6 of the bootstrap checklist)_ |
| Build output directory | `.vercel/output/static`                                                                                                                                                          |
| `NODE_VERSION`         | `22`                                                                                                                                                                             |

`wrangler.toml` in the repo root carries `compatibility_flags = ["nodejs_compat"]`. **This is not
optional — the app 500s at runtime without it.** The release pipeline's generated deploy config
mirrors these settings; if you ever change them, update BOTH `wrangler.toml` and
`.github/workflows/release.yml`'s `deploy-web` job.

No KV / R2 / D1 / Durable Object bindings exist. There is nothing else to provision.

### The custom domain

Attach it in Pages → project → **Custom domains** (after the zone's nameservers point at Cloudflare —
see [`domain-cutover-runbook.md`](../domain-cutover-runbook.md), which is built around not breaking
email).

Then set `NEXT_PUBLIC_SITE_URL=https://bellemaretours.com` in the Pages environment. **That single
variable is the domain** — canonicals, Open Graph, JSON-LD, sitemap, and the Peach return URL all derive
from it.

---

## Environment variables

Set in **Pages → Settings → Environment variables**. Never committed. The authoritative list is the Zod
schema in `src/lib/config/env.ts`.

**Minimum for a working site:**

```
NEXT_PUBLIC_SITE_URL          ← the REAL https origin
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
INTERNAL_TASK_SECRET          ← must MATCH the cron Worker's secret
```

**Feature-gated:** `PEACH_*` (payments), `RESEND_API_KEY` + `RESEND_FROM` (email),
`NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` + `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID` (maps),
`AI_PROVIDER` + `GOOGLE_GENERATIVE_AI_API_KEY` (road-trip planner),
`OWNER_NOTIFY_EMAIL` / `TELEGRAM_*` (owner alerts),
`WHATSAPP_WEBHOOK_VERIFY_TOKEN` + `WHATSAPP_APP_SECRET` (the Meta webhook at
`/api/v1/webhooks/whatsapp` — required for WhatsApp number registration/connect; set + redeploy
**before** clicking "Verify and save" in the Meta dashboard, and see `.env.example` for the full
walkthrough).

> ⚠️ **Almost every variable is optional in the schema, and the app boots without them.** Missing
> Supabase → it serves fake seed data. Missing Peach → a **stub payment provider whose webhook confirms
> anything**. Missing Resend → emails are queued and dropped.
>
> The only thing preventing that in production is a fail-closed gate (`isProductionLikeRuntime()`), which
> makes payments throw and `/health` return 503 rather than serving a stub. **Do not "fix" those throws
> by loosening the checks — fix the environment variables.**

Env changes only take effect on a **new deployment**.

---

## The cron Worker — the part everyone forgets

Cloudflare Pages **has no cron**. So a separate Worker (`gytm-cron`) pings two internal endpoints:

| Schedule | Endpoint                               | What dies without it                                                 |
| -------- | -------------------------------------- | -------------------------------------------------------------------- |
| `*/2`    | `/api/v1/internal/notifications/drain` | **All email.** Confirmations, invoices, owner alerts                 |
| `*/5`    | `/api/v1/internal/maintenance`         | **Payment reconciliation, hold expiry, and the availability window** |

Once bootstrapped, `release.yml`'s `deploy-cron` job deploys this automatically, sequentially AFTER
the web deploy, from the same commit, and verifies its liveness response reports the deployed
release SHA. Manual fallback (still the current reality until bootstrap):

```bash
# Deploy (from the REPO ROOT — the --config flag is required on EVERY command)
npx wrangler deploy --config workers/cron/wrangler.toml

# Set the secret — SAME VALUE as INTERNAL_TASK_SECRET in the Pages env
npx wrangler secret put INTERNAL_TASK_SECRET --config workers/cron/wrangler.toml

# Is it alive? GET the Worker's URL — it now replies with a JSON liveness body
# (status, releaseSha, releaseRunId, internalTaskSecretConfigured, siteUrl — never the secret itself).
# Is it working?
npx wrangler tail --config workers/cron/wrangler.toml
#   → [cron] POST /api/v1/internal/notifications/drain -> 200
#   → 401 means the secret doesn't match the Pages env
#   → 503 means INTERNAL_TASK_SECRET isn't set on Pages at all
```

Three ways to break this, all silent (mitigated once the pipeline is live, since a push always
redeploys the Worker from the SAME commit as the web app — but still true for out-of-band changes):

1. **You changed `workers/cron/` and pushed, and the pipeline isn't bootstrapped yet.** Nothing
   deployed it. The old code is still running.
2. **You rotated `INTERNAL_TASK_SECRET` in one place.** Every tick now 401s. The site looks perfectly
   healthy. The pipeline verifies the secret EXISTS but cannot verify the two sides match (it never
   reads the value) — a rotation mismatch still needs a human to notice.
3. **You moved the domain and didn't update `SITE_URL`** in `workers/cron/wrangler.toml`.
   `release.yml`'s `deploy-cron` job now asserts this matches `CANONICAL_HOST` and fails the release
   if it doesn't — this specific failure mode is now caught automatically.

Workers Logs are enabled (`[observability] enabled = true` in `workers/cron/wrangler.toml`) — 7 days
of retained invocation logs, queryable from the dashboard, no separate Logpush needed for this Worker.

Forget `--config` and wrangler picks up the _root_ `wrangler.toml` (a Pages config) and errors
confusingly.

---

## Rolling back

**A bad web deploy** — Cloudflare dashboard → Workers & Pages → `<CLOUDFLARE_PAGES_PROJECT>` →
**Deployments** → find the previous deployment (its id is in the failed release's job summary,
captured automatically before the new deploy) → **Rollback to this deployment**. Instant. Doesn't
touch the database.

Then fix the repo so the next push doesn't re-ship it: `git revert <sha>` and push. (Revert, not
`reset --hard` — the pipeline deploys whatever is on `main`.)

**A bad cron Worker deploy** — the previous deployment id is in the same failed-release job summary.
Dashboard → Workers & Pages → `gytm-cron` → Deployments → roll back, or
`npx wrangler rollback --config workers/cron/wrangler.toml [deployment-id]` if Wrangler's rollback
command supports that deployment (check `npx wrangler rollback --help` — this project doesn't rely on
it being scripted into the pipeline itself, since Workers rollback semantics are versioned
separately from Pages).

**A bad migration** — there is no rollback. Migrations are **forward-only**; write a new migration
that undoes the change. See [database.md](database.md#undoing-a-bad-migration). This is exactly why
every migration must stay additive/backward-compatible with the PREVIOUS web version: a web rollback
only stays safe if the old code can still run against the (now slightly ahead) schema.

**A bad env var** — fix it in Pages settings, then trigger a redeploy (env changes need a new deployment).

---

## Observability

- **`/api/v1/health`** — the probe. `?deep=true` also pings the DB. Returns 503 and names the failing
  check when config is wrong. Now also reports `releaseSha`, `releaseRunId`, `environment`
  (`production`/`non-production`) and `paymentMode` (`live`/`test`) — all non-sensitive, used by
  `scripts/release/verify-health.mjs` to confirm a deploy actually landed.
- **`x-request-id`** on every API response. It's also on the log line for that request and on any error
  shown to the user — so a customer-reported error id maps to exactly what failed.
- **Logs** are one JSON line per event, captured by Cloudflare. `npx wrangler tail`, Workers Logs, or
  Logpush (which the owner must enable to retain/search them for the Pages app; the cron Worker's
  Workers Logs are already on).
- **Server crashes** anywhere in the App Router are captured by `instrumentation.ts`.
- **Browser crashes** POST to `/api/v1/client-errors` and appear in the logs as `client_error`.

---

## OpenNext — explicitly NOT part of this pipeline

`docs/opennext-migration-plan.md` describes a separate, deliberately-staged platform move (Pages →
Workers via `@opennextjs/cloudflare`). This release pipeline is built entirely around **Pages** and
`@cloudflare/next-on-pages` and does not change that plan. **Do not combine the two efforts** — the
OpenNext migration remains a production follow-up, to be executed on its own once this pipeline has
been running quietly for a while.
