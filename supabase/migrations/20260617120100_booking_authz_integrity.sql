-- Authorization & integrity hardening (Phase-3 adversarial review).

-- ---------------------------------------------------------------------------
-- F2: bookings may NOT be inserted directly from a browser session.
--
-- enforce_booking_admin_update guards UPDATEs, but there was no INSERT guard and forbid_public_write
-- was wired only to payments/booking_items. The bookings_staff (`for all ... with check(is_staff())`)
-- policy therefore let a signed-in staff/compromised-staff token hand-craft `POST /rest/v1/bookings`
-- with status='confirmed', payment_state='paid' and arbitrary money columns — a fabricated paid
-- booking with no backing payment ledger. All legitimate booking creation goes through the
-- SECURITY DEFINER create_booking/api_book RPCs (which run as the table owner), so blocking
-- anon/authenticated INSERTs closes the forgery without affecting the real flow. INSERT only — the
-- existing UPDATE guard and DELETE cascades are untouched.
-- ---------------------------------------------------------------------------
drop trigger if exists bookings_no_public_insert on bookings;
create trigger bookings_no_public_insert
  before insert on bookings
  for each row execute function forbid_public_write();

-- ---------------------------------------------------------------------------
-- F12: reviews must not be forgeable by any logged-in user.
--
-- reviews_insert was `with check (auth.uid() is not null)` and the table has no ownership column,
-- so any free signup could POST /rest/v1/reviews for any activity with an attacker-chosen author,
-- rating and text — review/ratings manipulation on the public activity page. There is no customer
-- review-submission feature yet, so drop the public insert path entirely; staff retain full manage
-- via reviews_staff. A genuine "verified purchaser" review path (a SECURITY DEFINER RPC that checks
-- a completed booking) can be added later when the feature ships.
-- ---------------------------------------------------------------------------
drop policy if exists reviews_insert on reviews;

-- ---------------------------------------------------------------------------
-- api_book: F23 (idempotency replay must not disclose another account's booking) + F25 (bound the
-- party quantity so an absurd value is a clean 400, not an int4-overflow 502). Preserves the
-- expectedSlug occurrence-binding guard.
-- ---------------------------------------------------------------------------
create or replace function api_book(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ uuid := (p ->> 'occurrenceId')::uuid;
  v_key text := p ->> 'idempotencyKey';
  v_expected_slug text := nullif(p ->> 'expectedSlug', '');
  v_total_qty bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_hold booking_holds;
  v_booking bookings;
  r record;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  -- Bind the occurrence to the activity the caller claims to be booking.
  if v_expected_slug is not null and not exists (
    select 1
    from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  -- Cast each quantity as bigint and bound its magnitude, so a tampered/huge value raises a clean
  -- 'invalid_party' (400) instead of overflowing int4 inside create_booking and surfacing as a 502.
  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  v_hold := create_hold(v_occ, v_total_qty::int, v_key || ':hold');
  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items
  );

  -- F23: create_booking returns the existing row on an idempotency-key replay. Because api_book runs
  -- in a SECURITY DEFINER frame (RLS does not filter the returned DTO), a replay with someone else's
  -- key would otherwise echo back THEIR booking (name, email, ref, items). A fresh booking still has
  -- user_id NULL here (it is claimed just below), so this only fires on a replay of an already-owned
  -- booking by a different caller.
  if v_booking.user_id is not null and v_booking.user_id is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;

  if auth.uid() is not null then
    update bookings set user_id = auth.uid() where id = v_booking.id and user_id is null;
  end if;

  return booking_json(v_booking.id);
end;
$$;
