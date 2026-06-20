-- P0 (wallet-DoS): a generic, DB-backed per-IP rate limiter the edge routes can share.
--
-- The four public AI/planner endpoints (trip-planner, place-insights, planner/optimize, planner/places)
-- are unauthenticated and each fans out to BILLED Gemini + Google Places (New)/Routes calls, with no
-- throttle. One scripted anonymous client could run up unbounded spend (Google billing was depleted once
-- already). The only existing limiter was inline inside api_capture_lead, coupled to the leads table, so
-- it could not be reused. This factors a generic limiter:
--
--   api_rate_limit(bucket, ip, limit, windowSeconds) -> raises 'rate_limited' once `limit` calls for the
--   same (bucket, ip) land inside the current fixed window; otherwise records the hit and returns.
--
-- DB-backed (not in-process) so it holds across edge isolates / server instances. Anon-granted so the
-- public routes can call it as the anonymous user. Defence in depth — the primary control is still a
-- Cloudflare Rate Limiting rule / Turnstile at the edge.

create table if not exists rate_limits (
  bucket       text not null,
  ip           text not null,
  window_start timestamptz not null,
  hits         int not null default 0,
  primary key (bucket, ip, window_start)
);
-- Lets a sweeper (or a lazy delete) drop stale windows; not required for correctness (old windows simply
-- never match the current window_start again).
create index if not exists rate_limits_window_idx on rate_limits (window_start);

-- No client ever reads/writes this table directly; only the SECURITY DEFINER function below touches it.
alter table rate_limits enable row level security;
revoke all on rate_limits from anon, authenticated;

-- Fixed-window counter. window_start is the call time floored to a `windowSeconds` boundary, so all calls
-- in the same window share one row and increment it atomically (insert-or-bump via ON CONFLICT). When a
-- no-op IP is passed (server-side / unknown client) the call is allowed without recording, matching the
-- lead limiter's "no IP => not throttled" behaviour. Raises BEFORE recording the over-limit hit, so the
-- offending call is rejected and the counter is not inflated past the cap.
create or replace function api_rate_limit(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bucket text := nullif(p ->> 'bucket', '');
  v_ip text := nullif(p ->> 'ip', '');
  v_limit int := greatest(coalesce((p ->> 'limit')::int, 0), 1);
  v_window int := greatest(coalesce((p ->> 'windowSeconds')::int, 60), 1);
  v_start timestamptz;
  v_hits int;
begin
  if v_bucket is null then
    raise exception 'invalid_request' using detail = 'rate_limit: bucket required';
  end if;
  -- No IP (server-side caller / unknown client): allow, like the lead limiter. App-level limiting needs a
  -- client identity; the edge (Cloudflare) is the backstop when the IP is absent.
  if v_ip is null then
    return jsonb_build_object('ok', true, 'remaining', v_limit);
  end if;

  v_start := to_timestamp(floor(extract(epoch from now()) / v_window) * v_window);

  insert into rate_limits (bucket, ip, window_start, hits)
  values (v_bucket, v_ip, v_start, 1)
  on conflict (bucket, ip, window_start)
  do update set hits = rate_limits.hits + 1
  returning hits into v_hits;

  if v_hits > v_limit then
    raise exception 'rate_limited' using detail = format('bucket %s ip %s', v_bucket, v_ip);
  end if;

  return jsonb_build_object('ok', true, 'remaining', greatest(v_limit - v_hits, 0));
end;
$$;

grant execute on function api_rate_limit(jsonb) to anon, authenticated, service_role;
