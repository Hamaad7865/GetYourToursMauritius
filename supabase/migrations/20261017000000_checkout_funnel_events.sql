-- checkout_funnel_events: what happens on the card-payment page, one row per event.
--
-- About 3 in 10 web checkouts ended inside the Peach card widget (2026-10-17 research), and the
-- ledger cannot say why. Peach reports an idle session as "100.396.104 probably cancelled by user"
-- ~30 minutes after it opened, whether the shopper walked away at second 5 or had their card refused
-- (a decline reaches us only as a "cancel" — the code lives in the Peach dashboard). This table records
-- what the pay page itself saw, so abandonment time, device and "never touched the form" vs "tried"
-- become answerable:
--
--     select f.event, f.device, f.in_app, f.ms_since_mount, b.status, b.total_minor
--       from checkout_funnel_events f
--       join payments p on p.provider_checkout_id = f.checkout_id
--          or p.prev_provider_checkout_id = f.checkout_id
--       join bookings b on b.id = p.booking_id
--      order by f.created_at desc;
--
-- Privacy: no IP, no email, no raw user agent — the route reduces the UA to a device class, a browser
-- family and an in-app-webview flag before calling the writer. The checkout id joins to the booking
-- server-side; nothing personal is stored here. service_role only; RLS on with no policies.

create table if not exists checkout_funnel_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- The Peach checkout session the pay page mounted (= payments.provider_checkout_id).
  checkout_id text not null,
  event text not null check (event in (
    'widget_ready', 'first_input', 'completed', 'cancelled', 'expired', 'load_failed',
    'page_hidden', 'page_shown'
  )),
  -- Milliseconds since the pay page started mounting the widget (client clock; display only).
  ms_since_mount int,
  device text not null check (device in ('mobile', 'tablet', 'desktop', 'unknown')),
  browser text not null,
  -- Facebook/Instagram/TikTok/… in-app browsers are a classic place for 3-D Secure to break.
  in_app boolean not null default false
);

comment on table checkout_funnel_events is
  'Pay-page funnel (widget ready, first input, cancel, page hidden…), keyed by Peach checkout id. '
  'Written only by api_log_checkout_event (service_role); pruned by api_purge_checkout_funnel_events '
  'on the maintenance cron. Holds no IP, email or raw user agent.';

create index if not exists checkout_funnel_events_created_at_idx
  on checkout_funnel_events (created_at desc);
create index if not exists checkout_funnel_events_checkout_idx
  on checkout_funnel_events (checkout_id, created_at);

alter table checkout_funnel_events enable row level security; -- no policies: service-role only

revoke all on checkout_funnel_events from public, anon, authenticated;
grant select, insert, delete on checkout_funnel_events to service_role;

-- ── api_log_checkout_event: the only write path ─────────────────────────────────────────────────
-- The feed is attacker-controlled (the route is unauthenticated so navigator.sendBeacon can reach it
-- on page unload), so every field is clamped HERE as well as in the route schema, and nothing raises
-- on bad input: an unknown event is dropped (returns ok:false), never an error.
create or replace function api_log_checkout_event(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_event text := lower(btrim(coalesce(p ->> 'event', '')));
  v_checkout text := left(btrim(coalesce(p ->> 'checkoutId', '')), 64);
  v_device text := lower(btrim(coalesce(p ->> 'device', 'unknown')));
  v_ms int;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  if v_checkout = '' or v_event not in (
    'widget_ready', 'first_input', 'completed', 'cancelled', 'expired', 'load_failed',
    'page_hidden', 'page_shown'
  ) then
    return jsonb_build_object('ok', false);
  end if;
  if v_device not in ('mobile', 'tablet', 'desktop', 'unknown') then
    v_device := 'unknown';
  end if;
  -- Bad/absent/absurd timing is null, never an error (a day is the ceiling worth keeping).
  if (p ->> 'msSinceMount') ~ '^[0-9]{1,8}$' then
    v_ms := least((p ->> 'msSinceMount')::int, 86400000);
  end if;

  insert into checkout_funnel_events (checkout_id, event, ms_since_mount, device, browser, in_app)
  values (
    v_checkout,
    v_event,
    v_ms,
    v_device,
    left(coalesce(nullif(btrim(p ->> 'browser'), ''), 'other'), 30),
    coalesce((p ->> 'inApp') = 'true', false)
  );

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function api_log_checkout_event(jsonb) from public, anon, authenticated;
grant execute on function api_log_checkout_event(jsonb) to service_role;

-- ── api_purge_checkout_funnel_events: retention + flood cap ─────────────────────────────────────
-- Same two bounds as api_purge_error_logs. Default 120 days: long enough to compare the
-- November–December season against the autumn baseline.
create or replace function api_purge_checkout_funnel_events(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_days int := least(greatest(coalesce((p ->> 'days')::int, 120), 1), 365);
  v_max_rows int := least(greatest(coalesce((p ->> 'maxRows')::int, 200000), 1000), 2000000);
  v_cutoff timestamptz;
  v_aged int := 0;
  v_overflow int := 0;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden';
  end if;

  delete from checkout_funnel_events where created_at < now() - make_interval(days => v_days);
  get diagnostics v_aged = row_count;

  select created_at into v_cutoff
    from checkout_funnel_events order by created_at desc offset v_max_rows limit 1;
  if found then
    delete from checkout_funnel_events where created_at <= v_cutoff;
    get diagnostics v_overflow = row_count;
  end if;

  return jsonb_build_object('deleted', v_aged + v_overflow, 'aged', v_aged, 'overflow', v_overflow);
end;
$$;

revoke execute on function api_purge_checkout_funnel_events(jsonb) from public, anon, authenticated;
grant execute on function api_purge_checkout_funnel_events(jsonb) to service_role;
