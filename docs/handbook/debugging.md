# Debugging — finding and fixing a bug

[← Handbook](../HANDBOOK.md)

The other chapters tell you how this system is built. This one tells you what to do when it misbehaves.

The order below is not a suggestion. Most wasted debugging time in this repo has come from skipping
straight to reading code — in a system where the logic lives in SQL, the deploy has three moving parts
and half the failure modes are configuration, the code is usually the last place to look.

---

## 0. Triage — five questions before you open an editor

| Question                                    | How you answer it                                                    | Why it matters                                                                                        |
| ------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Is the deployed build even current?**     | `curl -s .../api/v1/health?deep=true` → compare `releaseSha` to HEAD | You may be debugging code that was never shipped, or a fix that failed to deploy                      |
| **Is the configuration sane?**              | Same call — `"status":"ok"` vs `"degraded"` + which check failed     | A `degraded` answer usually _is_ the bug. Stop and fix that                                           |
| **Everyone, or one customer?**              | `error_logs` — is it one `request_id` or a repeating `route`?        | One customer with a stuck booking is a data problem; everyone is a deploy or config problem           |
| **Prod only, or locally too?**              | Reproduce locally (§3)                                               | Prod-only has [six known causes](#4-prod-only-the-six-usual-suspects) and none of them are your logic |
| **Did it ever work? What shipped nearest?** | `git log --oneline -20`, and the release run in Actions              | The overwhelming majority of regressions here are the most recent SQL or deploy change                |

> **Special case that outranks all five.** If the symptom is _"no emails"_, _"no dates available"_,
> _"no review requests"_, or _"payments stuck pending"_ — check the cron Worker **first**. It is a
> separate deployment, the site looks perfectly healthy without it, and it is the single most common
> root cause of "the site is broken" reports. See
> [operations → the background job](operations.md#the-background-job-gytm-cron--why-it-matters-so-much).

---

## 1. Evidence, in the order to collect it

Six sources. Each one knows something the others don't — and, importantly, each is blind to
something.

### 1.1 The health endpoint — config and provenance

```bash
curl -s "https://bellemaretours.com/api/v1/health?deep=true" | jq
```

```jsonc
{
  "status": "ok",
  "productionLike": true,
  "releaseSha": "c10c166…", // ← compare to `git rev-parse HEAD`
  "releaseRunId": "1234567",
  "paymentMode": "live",
  "checks": {
    "supabaseConfigured": true,
    "serviceRoleConfigured": true,
    "siteUrlConfigured": true, // false ⇒ NOBODY CAN PAY
    "paymentsSafe": true, // false ⇒ the stub provider is live, or Peach keys are missing
    "legacyAuthDisabled": true,
    "internalTasksConfigured": true, // false ⇒ the cron can do nothing
    "emailConfigured": true, // reported, NOT gating
    "paymentsLive": true, // only gates once PEACH_EXPECT_LIVE=true
    "database": true, // only present with ?deep=true
  },
}
```

**Knows:** whether the deploy is configured correctly, and exactly which commit is serving traffic.
**Blind to:** anything that is wrong with your _logic_. A green health check is not a working site.

Two `checks` deserve attention because they are gating and easy to misread: `emailConfigured` is
**reported but never gates** (a partially configured deploy still reads `ok`), while
`internalTasksConfigured` **does** gate — without `INTERNAL_TASK_SECRET` the cron cannot drain the
outbox or expire holds, which is a broken deploy rather than a missing feature.

### 1.2 `error_logs` — what actually broke, for 30 days

In the Supabase SQL Editor:

```sql
-- What is failing most, right now
select event, route, count(*), max(created_at) as last_seen
from error_logs
where created_at > now() - interval '2 days'
group by 1, 2 order by count(*) desc limit 20;

-- One customer's report ("the site gave me a code")
select * from error_logs where request_id = 'paste-the-id';

-- Server-side only, newest first
select created_at, source, route, event, message, stack
from error_logs
where source in ('api', 'ssr') order by created_at desc limit 50;
```

`source` tells you the layer immediately: `api` (an API call), `ssr` (a page failed to render),
`browser` (it broke on the customer's device), `cron` (the background job).

**Two blind spots you must hold in your head:**

- **4xx are deliberately absent.** A sold-out date, a wrong password, an expired hold — those are the
  system correctly refusing a request, and logging them would bury the genuine failures.
  `apiHandler` only writes a row when something _crashed_ **and** the status is ≥ 500. So "customers
  are getting an error on checkout" may leave **no trace here at all**. For that, you need the
  request log lines (§1.4).
- **An empty table plus a broken site means the failure is upstream of the app.** The app cannot
  record an error it never ran to produce. Check health, then Cloudflare.

Also worth knowing before drawing conclusions: rows are pruned at 30 days **by the cron** — so a dead
cron eventually makes this table misleading in a second way — and it carries no personal data by
design (no IPs, no emails, no bodies).

### 1.3 `x-request-id` — the thread that ties it all together

`apiHandler` mints one UUID per request and uses it in four places at once:

```
  ┌─ response header      x-request-id: 5f3c…
  ├─ response body (5xx)  { "error": { "details": { "errorId": "5f3c…" } } }
  ├─ the log line         {"level":"info","event":"request","requestId":"5f3c…","status":500,"ms":812}
  └─ the error_logs row   request_id = '5f3c…'
```

So: a customer screenshot showing an error id → exactly one database row → exactly one log line. Ask
for that id first; it converts a vague report into a precise one. (For a page crash rather than an API
call, the same id reaches `error_logs` via `instrumentation.ts`; browser-side crashes arrive through
`/api/v1/client-errors`.)

### 1.4 Live log streams

```bash
# The website
npx wrangler pages deployment tail --project-name getyourtoursmauritius

# The cron Worker — note the --config flag, it is required on EVERY wrangler command here
npx wrangler tail --config workers/cron/wrangler.toml
```

Every line is one JSON object with a stable `event` field, so it greps cleanly. `event:"request"`
carries `method`, `route`, `status`, `ms` and `requestId` for **every** request — including the 4xx
that never reach `error_logs`.

For the cron, the reply codes are diagnostic on their own:

| You see              | Meaning                                                     |
| -------------------- | ----------------------------------------------------------- |
| `-> 200` every 2 min | Alive and working — the fault is elsewhere                  |
| `-> 401`             | `INTERNAL_TASK_SECRET` differs between Pages and the Worker |
| `-> 503`             | `INTERNAL_TASK_SECRET` is not set on Pages at all           |
| Nothing at all       | Not deployed, or it has no schedule                         |

**Blind to:** anything older than the stream. This is a live tail, not history — that is what
`error_logs` and Logpush are for.

### 1.5 The browser

For anything visual, interactive, or hydration-related, the network panel and console beat every
server-side source. The API error envelope is uniform and worth learning to read:

```jsonc
{ "ok": false, "error": { "code": "sold_out", "message": "…", "details": { … } } }
```

The `code` maps 1:1 onto a `ServiceError` subclass in `src/lib/services/errors.ts` — `validation_error`,
`unauthorized`, `forbidden`, `not_found`, `conflict`, `sold_out`, `booking_not_payable`,
`checkout_pending`, `rate_limited`, `config_error`, `provider_error`, `internal_error`. That name
tells you which service threw, and `src/lib/services/db-errors.ts` tells you which **Postgres**
exception it was mapped from. Working backwards from the code is by far the fastest way into the
right file:

| Envelope code         | Raised by                                                  | Look in                                |
| --------------------- | ---------------------------------------------------------- | -------------------------------------- |
| `sold_out`            | SQL `insufficient_capacity`                                | `create_booking` / `used_capacity`     |
| `conflict`            | `hold_not_active` / `hold_not_found`, or a unique-key race | `create_hold`, idempotency keys        |
| `booking_not_payable` | SQL `booking_not_payable` — already paid or terminal       | `api_create_payment`                   |
| `validation_error`    | Zod, or one of ~12 named SQL guards                        | `src/lib/validation/`, then the RPC    |
| `config_error`        | The fail-closed env gate                                   | `src/lib/config/env.ts` — check health |

Note that 5xx bodies carry **only** a generic message plus the `errorId`. That is deliberate: internal
detail (which env var is missing, upstream specifics) is logged, never returned. Don't try to debug a
500 from the response body — take the id to `error_logs`.

### 1.6 The database itself

Often the fastest answer to "what state is this booking actually in":

```sql
select b.ref, b.status, b.total_minor, b.created_at, b.settlement_review_at,
       p.status as pay_status, p.provider_checkout_id, p.charged_amount_minor, p.charged_currency,
       (select count(*) from payment_events e where e.payment_id = p.id) as events
from bookings b left join payments p on p.booking_id = b.id
where b.ref = 'BMT…';
```

`status = 'payment_pending'` with zero `payment_events` means no settlement was ever ingested.
A non-null `settlement_review_at` means a settled event was **quarantined** rather than credited —
see the currency landmine in [landmines → money](landmines.md#money).

---

## 2. Localise the fault — which layer?

### The request path, so you know what sits between the click and the data

```
 Browser component (app/(site)/…, src/components/…)
     │  fetch /api/v1/…
 Route handler (app/api/v1/…/route.ts)          ← thin adapter, `export const runtime = 'edge'`
     │  apiHandler: request id, CORS, error mapping, error_logs
 Service (src/lib/services/…)                   ← framework-agnostic, gets a ServiceContext
     │  rpc(fn, params)  — src/lib/db/rpc.ts, the ENTIRE database interface
 plpgsql function (supabase/migrations/…)       ← ***the business logic actually lives here***
     │
 Tables + RLS
```

### Symptom → layer

| Symptom                                 | Look first at                                       | Not at              |
| --------------------------------------- | --------------------------------------------------- | ------------------- |
| Wrong price shown, right price charged  | `src/lib/services/pricing.ts` (the display mirror)  | SQL                 |
| Wrong price **charged**                 | The SQL pricing function                            | Any TypeScript      |
| "Sold out" when seats exist             | `used_capacity()`, holds, and the Mauritius-TZ rule | The UI              |
| Booking stuck `payment_pending`         | `reconcile.ts` → `append_payment_event`, then cron  | The widget          |
| Field in `/admin` won't save            | The three-place `extra` rule (schema/write/form)    | RLS                 |
| Data invisible to one role              | RLS: `is_staff()` / `is_content_editor()`           | The sidebar         |
| Owner's edit ignored on the live site   | Something is hardcoded that should be a DB row      | The admin form      |
| French text showing in English          | Exact-string mismatch in `messages.ts`              | The locale plumbing |
| Page renders, then jumps/errors on load | Hydration: server HTML ≠ first client render        | The server          |
| 500 on one route, others fine           | That route's service + its RPC                      | Config              |
| 500 on **every** route                  | `nodejs_compat` flag, or a bad env var              | Your code           |
| Works in `next dev`, fails deployed     | [§4](#4-prod-only-the-six-usual-suspects)           | Your logic          |

### Finding where a behaviour lives

```bash
# A price, a capacity rule, a booking state change — it is SQL. Find the WINNING definition:
grep -ln "function create_booking" supabase/migrations/*.sql   # the LAST file printed wins

# A user-visible string
grep -rn "the exact string" src/ app/

# An endpoint's real logic: route → service → rpc name
grep -rn "rpc(" src/lib/services/bookings.ts
```

---

## 3. Reproduce it — the test ladder

**The rule: reproduce before you fix.** A fix without a reproduction is a guess, and in the money path
a guess is expensive. Write the failing test first — it is also the regression guard you owe the next
person.

Pick the cheapest rung that can actually express the bug:

| Rung            | Where                                       | Proves                                                           | Cost     |
| --------------- | ------------------------------------------- | ---------------------------------------------------------------- | -------- |
| **Unit**        | `tests/unit/` (114 files)                   | Pure logic: formatting, pricing mirror, validation, mappers      | ~instant |
| **Route**       | `tests/unit/` + `tests/db/route-context.ts` | The adapter: status codes, envelope shape, auth gating           | fast     |
| **Integration** | `tests/integration/`                        | **Real Postgres.** Pricing, capacity, idempotency, RLS, triggers | seconds  |
| **E2E**         | `tests/e2e/smoke.spec.ts`                   | The browser actually loads and navigates                         | slowest  |

The integration rung is the important one, and it is better than most projects get: `createTestDb()`
spins up PGlite in-process, applies the auth shim, then **every migration in filename order**. plpgsql,
`SELECT FOR UPDATE`, constraints and RLS all behave exactly as in production.

```ts
import { createTestDb } from '../db/pglite';

const db = await createTestDb();
await db.asOwner(); // bypass RLS to seed
await db.as({ sub: USER_ID, role: 'authenticated' }); // become a customer — RLS applies
await db.as(null); // anonymous
```

Two gotchas that will cost you an hour each:

- Calling a **new** RPC from a service? Add its name to `ALLOWED` in `tests/db/rpc.ts`, or every test
  touching it fails with `unknown rpc <fn>`.
- The harness has **one connection**. It proves logic, not contention. Race conditions — oversell,
  double-charge — are prevented by `SELECT FOR UPDATE` and unique constraints in SQL, and **no test
  here can prove that**. Review the SQL by hand instead.

---

## 4. Prod-only? The six usual suspects

Before you conclude your logic is wrong, rule these out. Every one has bitten this project.

| #   | Cause                                                            | Check                                                               | Fix                                                                               |
| --- | ---------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | **The SQL never reached prod**                                   | Does the function/column exist in Supabase?                         | Ship the migration; `release.yml` applies it on push                              |
| 2   | **An env var is missing or wrong**                               | `/api/v1/health?deep=true`                                          | Set it in Pages, redeploy                                                         |
| 3   | **The cron is dead**                                             | `wrangler tail --config workers/cron/wrangler.toml`                 | Redeploy the Worker; check `INTERNAL_TASK_SECRET` matches                         |
| 4   | **Edge runtime ≠ Node**                                          | Did you use a Node API? Is `export const runtime = 'edge'` present? | The CI _Edge bundle_ step is the only real proof — you cannot build it on Windows |
| 5   | **`next dev` is exempt from the fail-closed gate**               | Locally, payments and email are **always stubs**                    | Never conclude "payments work" from local success                                 |
| 6   | **Local has no Supabase → an in-memory fixture is being served** | The catalogue renders but nothing persists                          | Fill in `.env.local`; "the site loads" proves nothing                             |

Number 6 is the sneakiest: the app **boots fine with no configuration at all**, silently serving fake
data with a stub payment provider whose webhook confirms anything. Local green is not evidence.

---

## 5. Fix it

1. **Failing test first**, at the lowest rung that expresses the bug.
2. **Check the dependency table** in [architecture.md §6](architecture.md#6-the-dependency-table--if-i-change-x-i-must-also-do-y).
   Roughly half the bugs in this repo's history were _incomplete_ changes, not wrong ones — a schema
   edited without regenerating `openapi.json`, an `extra` key added in two of three places, a
   migration not mirrored into `catch-up.sql`.
3. **Read the relevant [landmine](landmines.md)** before touching money, SQL, generated files, or i18n.
4. **Fix the cause, not the symptom.** The rule this project learned the hard way, from the
   drift-gate double-charge: _fix the remedy before sharpening the detection_. Making an alarm quieter
   is not a fix.
5. **Never loosen a fail-closed throw to make an error go away.** Those throws are the last line of
   defence between a misconfigured deploy and real customers' money.

### The two fixes that need extra ceremony

**Changing an existing SQL function.** This is the single most dangerous edit in the repo — a
migration written later but _named_ earlier silently reverts an earlier fix, with a green build and no
failing test. Before any `create or replace`:

```bash
grep -ln "function <name>" supabase/migrations/*.sql   # the LAST path is the WINNING body
```

Base your change on that body, diff it against the guards in every earlier definition, and never edit
a migration that has already run. Full procedure:
[database.md](database.md#-the-worst-one-migration-revert-drift).

**Repairing broken data.** Sometimes the right fix is a row, not a deploy. But:

> ⚠️ **Never `UPDATE bookings SET status='confirmed'`.** It skips the underpayment guard, the capacity
> re-check, the oversell routing and the hold consumption. `append_payment_event` is the only door.
> If a booking is genuinely paid and stuck, fix the reconcile path and let the cron confirm it.

Safe by comparison: setting a tour to Draft (never delete — foreign keys), correcting a fare row,
correcting `activities.extra` via SQL (`buildExtra()` merges, so the admin form won't clobber it).

---

## 6. Verify — and know what verification does not cover

```bash
npm run typecheck && npm run lint && npm run format:check && npm run test:coverage && npm run build
```

CI **fails fast**, so a single formatting slip hides the five checks after it. On 2026-07-30 five
consecutive pushes died at `format:check`, each costing a deploy of everyone's work. Install the
pre-commit hook once per clone — `npm run hooks:install` — and run `npm run format` when it complains
(it checks, it does not fix, because more than one session often shares this working tree).

**What the gate cannot tell you:**

| Not covered                       | Why                                                  | What to do instead                      |
| --------------------------------- | ---------------------------------------------------- | --------------------------------------- |
| The Cloudflare bundle, on Windows | `pages:build` fails with `spawn npx ENOENT`          | Watch CI's final **Edge bundle** step   |
| Race conditions                   | The test DB has a single connection                  | Review the SQL locking by hand          |
| Whether prod ran your SQL         | Tests apply migrations; prod is a different database | Verify in Supabase after the release    |
| Anything config-shaped            | Tests run with test config                           | `/api/v1/health?deep=true` after deploy |

Three drift guards inside the suite are worth recognising on sight: `setup-sql-parity`
(`npm run seed:gen && npm run setup:sql`), `openapi-fresh` (`npm run openapi:write`), and
`catch-up-parity` (you shipped a stale function body — see [database.md](database.md)).

---

## 7. Ship and confirm

```bash
git push origin main
```

That one push deploys the web app, the database and the cron Worker, in that strict order. Then:

1. **Watch the Actions run to green.** Its final step is the only proof the edge bundle built.
2. **Confirm the deploy is live:** `releaseSha` from `/api/v1/health?deep=true` must equal
   `git rev-parse HEAD`. A stale SHA means the deploy silently didn't happen.
3. **Re-run your `error_logs` query.** The rows should stop appearing. If they don't, you fixed
   something else.
4. **Watch for 15 minutes**, and specifically across one cron tick (2 min) and one maintenance
   sweep (5 min) if you touched anything in that path.

Rollback, when it comes to that, is in [deployment.md → rolling back](deployment.md#rolling-back).

---

## 8. Production is broken right now

Work in this order — the first two take under a minute each and answer most incidents:

1. **`/api/v1/health?deep=true`.** Degraded? Fix that; you're done. Stale `releaseSha`? The deploy
   didn't land.
2. **Is the cron alive?** If not, and the symptom is emails/availability/stuck payments, that's it.
3. **`error_logs`, last 2 hours, grouped.** One repeating `route` + `event` names the fault.
4. **Decide: roll back or fix forward.** Roll back if the last deploy caused it and the fix isn't
   obvious in minutes. Fix forward for data problems and config problems — a rollback fixes neither.
5. **Money first.** If customers may have been charged for bookings that didn't confirm, check
   `settlement_review_at` and the quarantine path before anything cosmetic. Do not hand-confirm.

---

## 9. Symptom → cause index

The long version of the table on the [handbook front page](../HANDBOOK.md).

| Symptom                                               | Almost always                                                   |
| ----------------------------------------------------- | --------------------------------------------------------------- |
| No emails of any kind                                 | Cron dead                                                       |
| "No dates available" across many tours                | Cron dead — availability stopped rolling forward                |
| Review-request emails stopped                         | Cron dead                                                       |
| Paid but still `payment_pending` after 10 min         | Settlement never ingested; check reconcile + cron               |
| Booking paid the wrong amount / marked paid ~54× over | The MUR↔EUR settlement pin was bypassed                         |
| A customer can't pay, ever, on one booking            | A dead Peach checkout session being handed back                 |
| Nobody can pay at all                                 | `NEXT_PUBLIC_SITE_URL` — payments fail closed                   |
| Every page 500s                                       | `nodejs_compat` missing on the Pages project                    |
| One new feature 500s                                  | The SQL for it never ran on prod                                |
| New API route 404s or the build fails                 | Missing `export const runtime = 'edge'`                         |
| Admin field silently doesn't persist                  | The three-place `extra` rule — one place missed                 |
| Admin edit ignored on the site                        | The value is hardcoded somewhere it shouldn't be                |
| Page flickers / React hydration error                 | Server HTML ≠ first client render (timers, `Date`, storage)     |
| Language leaks between visitors                       | A cached route missing `Vary: Cookie`                           |
| French falls back to English                          | Exact-string mismatch — usually a curly apostrophe              |
| Photo uploads fail silently                           | The Storage bucket was never created                            |
| `seo` user sees something they shouldn't              | An RLS grant, not the sidebar — the sidebar is cosmetic         |
| Totals don't add up in admin/invoice                  | A charge added to `total_minor` without a `booking_items` row   |
| Tests fail with `unknown rpc <fn>`                    | Add it to `ALLOWED` in `tests/db/rpc.ts`                        |
| CI red but local green                                | `format:check` — or an uncommitted file from a parallel session |

---

## 10. When you cannot reproduce it

- **Get the request id.** It collapses "something went wrong sometimes" into one row and one log line.
- **Add a log line and ship it.** Logs are cheap and the format is stable: `log.info('stable_event_name',
{ requestId, … })`. Use a fixed `event` string and put the variable data in fields, so it greps.
  Never log secrets, card numbers, tokens or raw bodies.
- **Use the `context` column.** `recordError({ …, context: { … } })` takes arbitrary JSON — the right
  place for the two or three values that would have told you the answer.
- **Check the boring explanations before the exotic ones.** Browser rows in `error_logs` include
  crashes caused by ad-blockers, extensions and flaky phone networks. Look for _repeats_, not
  singletons.
- **If it only happens under load**, it is a race, and no local test will show it. Read the SQL
  locking.

---

## 11. A worked example

The [cancelled-checkout trap](landmines.md#but-never-reuse-a-checkout-without-asking-peach-whether-its-still-payable)
(production, 2026-07-24) is the best case study this repo has, because every stage of the method above
was needed.

**Report:** one customer, one booking, could not pay. No error message anywhere.

**Triage:** not everyone (so not config, not a bad deploy) — one booking. Health green. Nothing in
`error_logs`, because nothing ever crashed: every layer returned success.

**Evidence:** the booking row showed `payment_pending` with a `provider_checkout_id` set. Re-querying
Peach for that id returned `100.396.101 Cancelled by user` — the customer had abandoned the widget
once, and Peach had closed that session permanently.

**Localise:** the double-charge guard in `api_create_payment` reuses any checkout created in the last
25 minutes. Nothing had cleared the dead id, so the guard kept handing back a corpse; the widget fired
`onCancelled` on mount and bounced the customer to a page whose only button handed them the same dead
session. A closed loop.

**Second-order finding:** the 25-minute escape hatch could never fire either, because the window was
anchored to `payments.updated_at`, which the reconcile sweep bumps every few minutes even when it
writes nothing. A 25-minute annoyance had become permanent.

**Fix:** check status before reusing; retire terminal sessions via `api_clear_payment_checkout`
(compare-and-clear, so a concurrent request that already minted a replacement doesn't lose it); anchor
the window to `payments.checkout_created_at`, which is stamped only when a session is actually minted.

**The judgement call worth copying:** the fix stayed **conservative in the money direction**. Only a
verified cancellation code licenses minting a replacement. A decline or a timeout usually leaves the
session retryable, and treating those as dead would open a second payable session — recreating the
double charge the original guard existed to prevent.

The lesson generalises: **a bug in the money path is rarely a bug in one function.** It is usually two
mechanisms, each correct alone, that combine into a trap.
