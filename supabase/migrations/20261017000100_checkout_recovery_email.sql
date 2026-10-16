-- Checkout recovery: ONE service email to a shopper whose online checkout expired unpaid.
--
-- 2026-10-17 research: 36 customers (~€6.5k) let a web checkout expire and never came back; 20 others
-- did come back and paid. This sends one message per person — never a sequence — pointing at the
-- activity page, where booking again takes a FRESH hold and a FRESH checkout. It never revives the
-- expired booking: append_payment_event stays the only door to `confirmed`, and every new attempt gets
-- its own merchant reference.
--
-- SHIPS SWITCHED OFF. Nothing is queued until the owner sets
--     update business_settings set checkout_recovery_enabled_at = now();
-- and even then only checkouts created AFTER that moment qualify (no backfill of old expiries).
-- Turn it off again with `... set checkout_recovery_enabled_at = null`.
--
-- Who is emailed — every rule is in this SQL, not in the caller:
--   * a WEB booking that EXPIRED, created 2–24 hours ago (Peach closes an idle session at ~30 min; by
--     2 h the people who rebook on their own have mostly done so),
--   * no money moved: no paid/refunded ledger event, nothing paid, no settlement under review
--     (a paid customer told to "book again" would pay twice),
--   * not staff/admin/seo (10 of the first 79 expiries were the team testing),
--   * the person has made NO later booking (any status) since,
--   * the activity is still published and the date still at least 12 hours away,
--   * not on the opt-out list, and not emailed by this feature in the last 30 days.
-- One email per PERSON per run (their latest expired attempt), keyed by lower-cased address.

alter table business_settings
  add column if not exists checkout_recovery_enabled_at timestamptz;

comment on column business_settings.checkout_recovery_enabled_at is
  'NULL = checkout-recovery emails OFF. Set to now() to turn on; only checkouts created after this '
  'moment qualify. See api_enqueue_checkout_recovery.';

-- ── who was emailed (also holds the opt-out token) ─────────────────────────────────────────────
create table if not exists checkout_recovery_emails (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null unique references bookings (id) on delete cascade,
  email_lc text not null,
  -- Opaque, unguessable; the email's "stop these" link carries it. Never derived from the booking.
  token text not null unique,
  created_at timestamptz not null default now()
);
create index if not exists checkout_recovery_emails_email_idx
  on checkout_recovery_emails (email_lc, created_at desc);

alter table checkout_recovery_emails enable row level security; -- no policies: service-role only
revoke all on checkout_recovery_emails from public, anon, authenticated;
grant select, insert, delete on checkout_recovery_emails to service_role;

-- ── opt-out list, by address and kind ──────────────────────────────────────────────────────────
create table if not exists email_suppressions (
  email_lc text not null,
  kind text not null check (kind in ('checkout_recovery')),
  created_at timestamptz not null default now(),
  primary key (email_lc, kind)
);

alter table email_suppressions enable row level security; -- no policies: service-role only
revoke all on email_suppressions from public, anon, authenticated;
grant select, insert, delete on email_suppressions to service_role;

-- ── api_enqueue_checkout_recovery: run by the maintenance cron ─────────────────────────────────
create or replace function api_enqueue_checkout_recovery(p jsonb default '{}'::jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_enabled_at timestamptz;
  v_count int := 0;
  v_c record;
  v_token text;
  v_inserted int;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select checkout_recovery_enabled_at into v_enabled_at from business_settings where id;
  if v_enabled_at is null then
    return 0; -- switched off
  end if;

  -- Two overlapping cron ticks must not both pick the same person.
  perform pg_advisory_xact_lock(hashtext('api_enqueue_checkout_recovery'));

  for v_c in (
    with expired as (
      select distinct on (lower(b.customer_email))
             b.id, lower(b.customer_email) as email_lc, b.customer_email, b.customer_name,
             b.locale, b.created_at
      from bookings b
      left join profiles pr on pr.id = b.user_id
      where b.source = 'web'
        and b.status = 'expired'
        and b.customer_email is not null
        and b.created_at >= v_enabled_at
        and b.created_at <= now() - interval '2 hours'
        and b.created_at >= now() - interval '24 hours'
        and coalesce(pr.role::text, 'customer') not in ('staff', 'admin', 'seo')
        and not exists (
          select 1 from payments p
          where p.booking_id = b.id
            and (p.paid_minor > 0 or p.refunded_minor > 0 or p.settlement_review_at is not null)
        )
        and not exists (
          select 1 from payment_events pe join payments p on p.id = pe.payment_id
          where p.booking_id = b.id and pe.type in ('paid', 'refunded')
        )
      order by lower(b.customer_email), b.created_at desc
    ),
    first_slot as (
      select bi.booking_id, so.starts_at, a.slug, a.title, a.status,
             row_number() over (partition by bi.booking_id order by so.starts_at) as rn
      from booking_items bi
      join session_occurrences so on so.id = bi.session_occurrence_id
      join activity_options ao on ao.id = bi.activity_option_id
      join activities a on a.id = ao.activity_id
      where bi.booking_id in (select id from expired)
    )
    select e.*, fs.starts_at, fs.slug, fs.title
    from expired e
    join first_slot fs on fs.booking_id = e.id and fs.rn = 1
    where fs.status = 'published'
      and fs.slug not in ('hotel-transfer', 'car-and-scooter-rental')
      and fs.starts_at >= now() + interval '12 hours'
      and not exists (
        select 1 from bookings later
        where lower(later.customer_email) = e.email_lc and later.created_at > e.created_at
      )
      and not exists (
        select 1 from email_suppressions s
        where s.email_lc = e.email_lc and s.kind = 'checkout_recovery'
      )
      and not exists (
        select 1 from checkout_recovery_emails r
        where r.email_lc = e.email_lc and r.created_at > now() - interval '30 days'
      )
  )
  loop
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

    insert into checkout_recovery_emails (booking_id, email_lc, token)
    values (v_c.id, v_c.email_lc, v_token)
    on conflict (booking_id) do nothing;
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      continue;
    end if;

    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', v_c.customer_email, 'checkout_recovery',
      jsonb_build_object(
        'token', v_token,
        'customerName', v_c.customer_name,
        'activityTitle', v_c.title,
        'activitySlug', v_c.slug,
        'startsAt', v_c.starts_at,
        'locale', v_c.locale
      ),
      v_c.id,
      'checkout_recovery:' || v_c.id
    )
    on conflict (idempotency_key) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function api_enqueue_checkout_recovery(jsonb) from public, anon, authenticated;
grant execute on function api_enqueue_checkout_recovery(jsonb) to service_role;

-- ── api_checkout_recovery_opt_out: the email's "stop these" link ───────────────────────────────
-- Called by the opt-out route with the token from the link. Idempotent; an unknown token is simply
-- { ok: false } (no oracle beyond that — the token is 64 random hex characters).
create or replace function api_checkout_recovery_opt_out(p jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if nullif(current_setting('request.jwt.claims', true), '') is not null
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select email_lc into v_email
  from checkout_recovery_emails
  where token = left(btrim(coalesce(p ->> 'token', '')), 128);

  if v_email is null then
    return jsonb_build_object('ok', false);
  end if;

  insert into email_suppressions (email_lc, kind)
  values (v_email, 'checkout_recovery')
  on conflict (email_lc, kind) do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function api_checkout_recovery_opt_out(jsonb) from public, anon, authenticated;
grant execute on function api_checkout_recovery_opt_out(jsonb) to service_role;
