-- checkout_funnel_events learns the checkout STEPS, not just the card-payment page.
--
-- 2026-10-29: about 3 in 4 checkout opens never reach Pay (556 holds → 146 bookings, 28 Sep–25 Oct),
-- yet a guest who creates an account books ~9 times in 10. So the loss is before the account — at
-- step ① (pickup) or at the step ② account wall — and nothing recorded which. These events do:
--
--   step_1, step_2_signed_out, step_2_signed_in, step_3   a step was shown (once per page load)
--   auth_opened                                           the step ② "Sign in / Create account" tap
--   signup_email_sent                                     sign-up worked; the guest must confirm by email
--   auth_failed                                           the account box showed an error
--   pay_clicked                                           Pay tapped while signed in
--
-- For these rows checkout_id is NOT a Peach checkout id. It is 'hold:<booking_holds.id>' — the hold the
-- widget or cart reserved, so a row joins to booking_holds and, once api_book consumes the hold, to its
-- booking — or 'visit:<random>' for a checkout opened without one (one key per page load). Pay-page
-- rows keep the Peach id, unprefixed.
--
--   select event, count(distinct checkout_id) as checkouts
--     from checkout_funnel_events
--    where checkout_id ~ '^(hold|visit):' and created_at > now() - interval '14 days'
--    group by event order by checkouts desc;
--
-- Re-runnable on its own (catch-up.sql runs it in autocommit): the check is dropped-if-exists then
-- re-added, and the writer is replaced — the 20261017000000 body verbatim except the event list.

alter table checkout_funnel_events drop constraint if exists checkout_funnel_events_event_check;
alter table checkout_funnel_events add constraint checkout_funnel_events_event_check check (event in (
  'widget_ready', 'first_input', 'completed', 'cancelled', 'expired', 'load_failed',
  'page_hidden', 'page_shown',
  'step_1', 'step_2_signed_out', 'step_2_signed_in', 'step_3',
  'auth_opened', 'signup_email_sent', 'auth_failed', 'pay_clicked'
));

comment on column checkout_funnel_events.checkout_id is
  'Pay-page events: the Peach checkout id (= payments.provider_checkout_id). Checkout-step events '
  '(20261029120000): ''hold:<booking_holds.id>'' or ''visit:<random>''.';

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
    'page_hidden', 'page_shown',
    'step_1', 'step_2_signed_out', 'step_2_signed_in', 'step_3',
    'auth_opened', 'signup_email_sent', 'auth_failed', 'pay_clicked'
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
