-- error_logs: a queryable record of everything that broke.
--
-- Until now every error was a JSON line on stdout, captured by Cloudflare and visible ONLY through a
-- live `wrangler pages deployment tail` — nothing was retained, so "what went wrong last Tuesday?" had
-- no answer. This table is the answer:
--
--     select * from error_logs order by created_at desc;
--
-- Deliberately NOT a general log table: only genuine failures land here (server 5xx and unhandled
-- throws, SSR/render crashes, browser crashes, failed cron steps). 4xx responses stay out — they are
-- the caller's mistake, not ours, and they would bury the real failures. The structured console lines
-- are unchanged; this is an additional, durable sink.
--
-- Privacy: no IP, no email, no request bodies, no tokens. `message`/`stack` are internal detail (which
-- env var was missing, which upstream timed out) and are never returned to a customer — the table is
-- service_role-only, and RLS is on with NO policies so a leaked anon key reads nothing.

create table if not exists error_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Where it broke, so one glance separates "our server" from "that customer's browser".
  source text not null check (source in ('api', 'ssr', 'browser', 'cron')),
  -- Stable name per call site (unhandled_api_error, request_error, client_error, cron_step_failed…),
  -- so `where event = ...` groups a recurring failure without string-matching the message.
  event text not null,
  message text not null,
  error_name text,
  stack text,
  route text,
  method text,
  status int,
  -- The same id returned to the caller as `x-request-id`. A customer quoting an error id maps to
  -- exactly one row here, and to the matching `request` line in the Cloudflare log stream.
  request_id text,
  user_agent text,
  -- Whatever else the call site knew (digest, page url, cron step name…). Size-capped on write.
  context jsonb
);

comment on table error_logs is
  'Durable record of server, SSR, browser and cron failures. Read with '
  '"select * from error_logs order by created_at desc". Written only by api_log_error (service_role); '
  'pruned by api_purge_error_logs on the maintenance cron. Never holds IP, email or request bodies.';
comment on column error_logs.request_id is
  'Matches the x-request-id response header the caller saw, and the requestId on the Cloudflare '
  '"request" log line — one id ties the customer report, the log stream and this row together.';

-- The one index the owner's query actually needs, plus two for triage (recurring event, reported id).
create index if not exists error_logs_created_at_idx on error_logs (created_at desc);
create index if not exists error_logs_event_idx on error_logs (event, created_at desc);
create index if not exists error_logs_request_id_idx on error_logs (request_id)
  where request_id is not null;

alter table error_logs enable row level security; -- no policies: definer/service-role access only

revoke all on error_logs from public, anon, authenticated;
grant select, insert, delete on error_logs to service_role;

-- ── api_log_error: the only write path ──────────────────────────────────────────────────────────
-- Every field is clamped HERE, not just in the caller: the browser half of this feed is attacker-
-- controlled (anyone can POST to /api/v1/client-errors), so a 10 MB "stack" must be impossible to
-- store even if the route's schema is ever loosened. Nothing in this function raises on bad input —
-- it normalises instead. A logging call that throws would turn a handled 500 into an unhandled one,
-- which is precisely the failure mode this table exists to make visible.
create or replace function api_log_error(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_source text := lower(coalesce(nullif(btrim(p ->> 'source'), ''), 'api'));
  v_context jsonb := case when jsonb_typeof(p -> 'context') = 'object' then p -> 'context' end;
  v_id uuid;
begin
  -- Grants are the primary gate (service_role only); defence in depth as in api_record_payment_charge.
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  -- Normalise rather than reject: an unknown source must still be recorded, under 'api'.
  if v_source not in ('api', 'ssr', 'browser', 'cron') then
    v_source := 'api';
  end if;

  -- A context object big enough to matter is replaced by a marker: the row stays useful (message,
  -- stack, route are the triage fields) and one runaway payload can't bloat the table.
  if v_context is not null and length(v_context::text) > 4000 then
    v_context := jsonb_build_object('truncated', true, 'bytes', length(v_context::text));
  end if;

  insert into error_logs (
    source, event, message, error_name, stack, route, method, status, request_id, user_agent, context
  )
  values (
    v_source,
    left(coalesce(nullif(btrim(p ->> 'event'), ''), 'unknown'), 100),
    left(coalesce(nullif(btrim(p ->> 'message'), ''), '(no message)'), 2000),
    left(nullif(btrim(p ->> 'errorName'), ''), 200),
    left(nullif(p ->> 'stack', ''), 8000),
    left(nullif(btrim(p ->> 'route'), ''), 500),
    left(nullif(btrim(p ->> 'method'), ''), 10),
    -- Bad/absent status is null, never an error: `(p->>'status')::int` on garbage would raise.
    case when (p ->> 'status') ~ '^[0-9]{3}$' then (p ->> 'status')::int end,
    left(nullif(btrim(p ->> 'requestId'), ''), 100),
    left(nullif(btrim(p ->> 'userAgent'), ''), 300),
    v_context
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

revoke execute on function api_log_error(jsonb) from public, anon, authenticated;
grant execute on function api_log_error(jsonb) to service_role;

-- ── api_purge_error_logs: keeps the table small enough to stay useful ───────────────────────────
-- Run by the maintenance cron. Two bounds, because either alone leaves a hole:
--   * AGE (default 30 days) — the operator-facing promise: a month of history, then gone.
--   * ROW CAP (default 50k) — the flood backstop. A crash loop on a popular page can write far more
--     rows in a day than a month of normal operation; without this, "order by created_at desc" would
--     be answered from a table nobody wants to open.
create or replace function api_purge_error_logs(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_days int := least(greatest(coalesce((p ->> 'days')::int, 30), 1), 365);
  v_max_rows int := least(greatest(coalesce((p ->> 'maxRows')::int, 50000), 1000), 1000000);
  v_cutoff timestamptz;
  v_aged int := 0;
  v_overflow int := 0;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  delete from error_logs where created_at < now() - make_interval(days => v_days);
  get diagnostics v_aged = row_count;

  -- Anything past the newest v_max_rows goes, oldest first. The offset probe returns no row (and this
  -- whole branch is skipped) whenever the table is already under the cap — the normal case.
  select created_at into v_cutoff
    from error_logs order by created_at desc offset v_max_rows limit 1;
  if found then
    delete from error_logs where created_at <= v_cutoff;
    get diagnostics v_overflow = row_count;
  end if;

  return jsonb_build_object('deleted', v_aged + v_overflow, 'aged', v_aged, 'overflow', v_overflow);
end;
$$;

revoke execute on function api_purge_error_logs(jsonb) from public, anon, authenticated;
grant execute on function api_purge_error_logs(jsonb) to service_role;
