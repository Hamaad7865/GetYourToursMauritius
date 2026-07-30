# Error log table — design

**Date:** 2026-07-30
**Status:** built (migration `20260831000000_error_logs.sql`)

## The problem

Every error already produced one structured JSON line (`src/lib/log.ts`), captured by Cloudflare. But
nothing retained it. Reading it meant holding a live `npx wrangler pages deployment tail` open at the
moment of the failure, or enabling Logpush — which the owner had not done. In practice, "the site
broke for a customer yesterday" had no answer at all.

The owner asked for one thing:

```sql
select * from error_logs order by created_at desc;
```

## What was built

A Postgres table plus the two functions that maintain it, and four call sites that feed it.

### `error_logs`

One row per failure. `created_at desc` is indexed, because that is the query the table exists to serve.
Two more indexes support triage: `(event, created_at desc)` for "what is failing most", and a partial
index on `request_id` for "a customer sent me this error id".

| Column                           | Purpose                                                   |
| -------------------------------- | --------------------------------------------------------- |
| `source`                         | `api` \| `ssr` \| `browser` \| `cron` — which layer broke |
| `event`                          | stable per call site, so recurrences group without regex  |
| `message`, `error_name`, `stack` | the real failure, unredacted                              |
| `route`, `method`, `status`      | where                                                     |
| `request_id`                     | the `x-request-id` the caller saw                         |
| `user_agent`, `context`          | browser triage; whatever else the call site knew          |

### `api_log_error(p jsonb)` — the only write path

`security definer`, granted to `service_role` alone. Every clamp lives here rather than in the caller,
because half the input is attacker-controlled: anyone on the internet can POST to
`/api/v1/client-errors`. Message 2 KB, stack 8 KB, event 100 B, context 4 KB (replaced by a marker
beyond that).

It **normalises instead of raising** — an unknown `source`, a non-numeric `status`, a missing message
all still produce a row. This is not politeness: the function is called from inside catch blocks, so a
raise would convert a handled 500 into an unhandled one, which is exactly the invisible failure the
table was built to expose.

### `api_purge_error_logs(p jsonb)` — retention

Run by the maintenance cron. Two bounds, because either alone leaves a hole:

- **Age** — 30 days. The operator-facing promise.
- **Row cap** — 50,000. A crash loop on a popular page can write more rows in a day than a month of
  normal operation, and "order by created_at desc" against a table nobody wants to open is not a
  feature.

## Decisions worth not re-litigating

**4xx never lands here.** A rejected request is the caller's mistake — a bad date, a sold-out slot, a
booking that isn't theirs. Routine 404s would bury the genuine failures within a day, and the owner's
one query would stop being worth running. `apiHandler` only records when the request actually _threw_
and the resulting status is ≥ 500; a deliberately-returned 5xx (a config gate) is a state, not a crash,
and is excluded too.

**The write is awaited, not fire-and-forget.** The edge runtime may cancel work that outlives the
response, so a floating promise would drop rows exactly when the platform is unhealthy. The cost is
bounded by giving the sink its own **3-second** Supabase client rather than the 15-second default: a
customer already looking at a failing page must not also wait out a sick database.

**The sink can never make things worse.** `recordError` swallows its own failures to a plain
`console.error` (never `log.error`, never a retry, never a recursive record), and does nothing at all
when `SUPABASE_SERVICE_ROLE_KEY` is unset, so local dev and preview builds stay quiet.

**No personal data.** No IP, no email, no request bodies, no tokens. The client-error route still logs
the IP to the console stream for rate-limit forensics; it is deliberately not persisted. `message` and
`stack` do carry internal detail (which env var is missing, which upstream timed out) — which is why
the table is `service_role`-only, RLS on with no policies, and revoked from `public, anon,
authenticated`.

**A failed purge does not turn the cron red.** A red cron on the Cloudflare dashboard means customers
are affected — money, emails, availability. An unpruned diagnostics table is neither, and the failure
records itself _into_ `error_logs`, where anyone reading the table will see it.

## Feeds

| Call site                                  | `source`  | Covers                                       |
| ------------------------------------------ | --------- | -------------------------------------------- |
| `src/lib/http/handler.ts`                  | `api`     | every API route that throws                  |
| `instrumentation.ts`                       | `ssr`     | page/RSC render crashes                      |
| `app/api/v1/client-errors/route.ts`        | `browser` | React boundaries, `window.error`, rejections |
| `app/api/v1/internal/maintenance/route.ts` | `cron`    | each failed maintenance step                 |

## Not built (deliberately)

- **No `/admin` screen.** The owner asked for a SQL query and reads the Supabase SQL Editor already. An
  admin page would need its own auth surface over unredacted internal detail for no gain today.
- **No alerting.** Owner alerts already exist for bookings; wiring error volume into them is a separate
  decision about thresholds and noise.
- **No deduplication / fingerprinting.** One row per failure keeps `select *` honest. The row cap is
  the flood answer; grouping is a `group by event, route` away.
