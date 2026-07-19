# Deployment — shipping it

[← Handbook](../HANDBOOK.md)

---

## Three things deploy separately

| Part            | How it ships                                                 | On `git push`? |
| --------------- | ------------------------------------------------------------ | -------------- |
| **Web app**     | Cloudflare Pages, connected to Git, production branch `main` | ✅ automatic   |
| **Database**    | A human pastes `supabase/catch-up.sql` into Supabase         | ❌ **manual**  |
| **Cron Worker** | `npx wrangler deploy --config workers/cron/wrangler.toml`    | ❌ **manual**  |

Nothing warns you about the two manual ones.

---

## Deploying an ordinary change (no SQL)

```bash
# 1. The gate (Windows can run all but the last CI step)
npm run typecheck && npm run lint && npm run format:check && npm run test:coverage && npm run build

# 2. Ship
git push origin main

# 3. WATCH CI — its final step (Edge bundle) is the only proof the Cloudflare artifact builds,
#    and it's the step you could not run locally.
gh run watch --exit-status

# 4. Cloudflare Pages builds the same commit and deploys it.
#    Smoke-test:
curl -i "https://bellemaretours.com/api/v1/health?deep=true"     # expect 200 "status":"ok"
```

## Deploying a change that includes SQL — **order matters**

```
1. Write the migration + mirror it into catch-up.sql + regenerate setup.sql
2. Run the local gate
3. ▶ OWNER RUNS supabase/catch-up.sql ON PRODUCTION  ← BEFORE the code ships
4. git push origin main
```

Push the code first and every request touching the new RPC or column **500s** until someone remembers to
paste the SQL. The other order is safe: the migrations are additive, so the _old_ code keeps working
against the _new_ schema.

---

## Continuous integration

`.github/workflows/ci.yml`. Runs on every push to `main` and every PR. **Fail-fast — a failure at any
step skips everything after it.**

| #   | Step                      | Notes                                                    |
| --- | ------------------------- | -------------------------------------------------------- |
| 1   | `npm ci`                  | Node 22                                                  |
| 2   | `npm run typecheck`       |                                                          |
| 3   | `npm run lint`            |                                                          |
| 4   | `npm run format:check`    | **The step people forget.** Fails → steps 5–7 never run. |
| 5   | `npm run test:coverage`   | Tests + coverage floors + all the drift guards           |
| 6   | `npm run build`           |                                                          |
| 7   | **`npm run pages:build`** | **The actual deployable Cloudflare artifact**            |

A separate `e2e` job runs the Playwright smoke in parallel, so a browser flake can't block the unit gate.

**Step 7 is the whole point.** `next build` passing does **not** mean the edge bundle builds. And because
`pages:build` cannot run on Windows (`spawn npx ENOENT`), CI is the _only_ place it is ever verified.
A red `format:check` therefore hides it completely — which is exactly how five commits once shipped
without the edge bundle ever being built.

---

## Cloudflare Pages

Project **`bellemaretours`**. Settings live in the dashboard, not the repo:

| Setting                | Value                   |
| ---------------------- | ----------------------- |
| Production branch      | `main`                  |
| Framework preset       | None                    |
| Build command          | `npm run pages:build`   |
| Build output directory | `.vercel/output/static` |
| Deploy command         | _(none)_                |
| `NODE_VERSION`         | `22`                    |

`wrangler.toml` in the repo root carries `compatibility_flags = ["nodejs_compat"]`. **This is not
optional — the app 500s at runtime without it.** If you ever configure flags in the dashboard, set them
for **both** Production and Preview.

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

```bash
# Deploy (from the REPO ROOT — the --config flag is required on EVERY command)
npx wrangler deploy --config workers/cron/wrangler.toml

# Set the secret — SAME VALUE as INTERNAL_TASK_SECRET in the Pages env
npx wrangler secret put INTERNAL_TASK_SECRET --config workers/cron/wrangler.toml

# Is it alive? Open the Worker URL — it replies "gytm-cron: alive."
# Is it working?
npx wrangler tail --config workers/cron/wrangler.toml
#   → [cron] POST /api/v1/internal/notifications/drain -> 200
#   → 401 means the secret doesn't match the Pages env
#   → 503 means INTERNAL_TASK_SECRET isn't set on Pages at all
```

Three ways to break this, all silent:

1. **You changed `workers/cron/` and pushed.** Nothing deployed it. The old code is still running.
2. **You rotated `INTERNAL_TASK_SECRET` in one place.** Every tick now 401s. The site looks perfectly
   healthy.
3. **You moved the domain and didn't update `SITE_URL`** in `workers/cron/wrangler.toml`. The Worker
   keeps pinging the old host.

In all three cases the website works fine and nothing appears wrong — until you notice no emails went out
and the calendar is emptying. `/api/v1/health` reports `internalTasksConfigured`, and the Worker
deliberately **throws** on failure so Cloudflare marks the invocation failed rather than showing green.

Forget `--config` and wrangler picks up the _root_ `wrangler.toml` (a Pages config) and errors
confusingly.

---

## Rolling back

**A bad web deploy** — Cloudflare dashboard → Workers & Pages → `bellemaretours` → **Deployments** →
find the last good one → **Rollback to this deployment**. Instant. Doesn't touch the database.

Then fix the repo so the next push doesn't re-ship it: `git revert <sha>` and push. (Revert, not
`reset --hard` — Pages deploys whatever is on `main`.)

**A bad migration** — there is no rollback. See [database.md](database.md#undoing-a-bad-migration).

**A bad env var** — fix it in Pages settings, then trigger a redeploy (env changes need a new deployment).

---

## Observability

- **`/api/v1/health`** — the probe. `?deep=true` also pings the DB. Returns 503 and names the failing
  check when config is wrong.
- **`x-request-id`** on every API response. It's also on the log line for that request and on any error
  shown to the user — so a customer-reported error id maps to exactly what failed.
- **Logs** are one JSON line per event, captured by Cloudflare. `npx wrangler tail`, Workers Logs, or
  Logpush (which the owner must enable to retain/search them).
- **Server crashes** anywhere in the App Router are captured by `instrumentation.ts`.
- **Browser crashes** POST to `/api/v1/client-errors` and appear in the logs as `client_error`.
