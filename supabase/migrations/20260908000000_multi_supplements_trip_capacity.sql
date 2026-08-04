-- 20260908000000_multi_supplements_trip_capacity
--
-- Two owner asks, one schema pass (they share the same rewritten function bodies):
--
-- 1) MULTIPLE optional supplements per activity. The single supplement pair
--    (activities.supplement_name / supplement_minor, 20260905000000) becomes a real child table,
--    `activity_supplements`, so the Ile aux Cerfs trips can sell the lobster lunch AND snorkel gear
--    AND anything else the owner dreams up — each named and priced by him, each per person. What a
--    guest actually bought is snapshot per supplement into `booking_supplements` (name + unit + qty
--    + total at booking time), for the same reason the old scalars were snapshots: a reprinted
--    invoice must show what was paid, not today's menu.
--
--    Money stays in REAL columns ([[gytm-activity-supplement]]): the French label rides as a
--    `name_fr` column on the supplement row itself (per-field coalesce in api_get_activity), never
--    through `extra`, which the FR overlay merges over. The client still only ever sends WHICH
--    supplement (by id) and HOW MANY heads; the unit price is read here, from the row.
--
--    The legacy columns (activities.supplement_name/supplement_minor,
--    activity_translations.supplement_name, bookings.supplement_qty/minor/name) are FROZEN, not
--    dropped: the live seed dump and old booking rows reference them, and this site is live. Their
--    data is migrated into the new tables below; nothing writes or reads them after this.
--
-- 2) Trips/day × guests/trip capacity, for EVERY activity. The availability screen's one number
--    hid two facts the owner actually manages: how many trips can run per day, and how many guests
--    one trip can take. The storage model keeps `daily_capacity` as the POOL in the units it always
--    had (guests for shared per_person/per_group options, trips for private options, vehicles for
--    vehicle mode) — so used_capacity / create_hold / reschedule need NO changes — and adds ONE new
--    fact: `guests_per_trip` (activities default + activity_options override). For a shared option
--    the pool the admin UI writes is trips × guests_per_trip, and create_booking now refuses a
--    single booking bigger than guests_per_trip (the widget caps its party selector from the same
--    number). A private option's "guests per trip" IS private_max_guests (already enforced); a
--    vehicle's is the bracket cap (25). NULL guests_per_trip = no per-booking cap — exactly the old
--    behaviour, so existing activities change nothing until the owner edits the two numbers.
--
-- Re-applied winning bodies (verbatim + delta, per the revert-drift rule):
--   set_daily_capacity_atomic (20260801000000) + guestsPerTrip paths (incl. private_max_guests)
--   create_booking            (20260812000000)  + guests-per-trip guard on the shared branch
--   api_book                  (20260905000000)  + booking_supplements charge loop replaces the scalars
--   booking_json              (20260905000000)  + 'supplements' array replaces the three scalars
--   api_get_activity          (20260905000000)  + 'supplements' array + per-option 'guestsPerTrip'
--
-- Idempotent throughout (this file is appended verbatim to supabase/catch-up.sql).

-- ---------------------------------------------------------------------------
-- 1a) activity_supplements — the owner's per-activity upgrade menu.
-- ---------------------------------------------------------------------------
create table if not exists activity_supplements (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities (id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  -- French label, per-field coalesce like activity_translations.title. The ENGLISH name alone
  -- decides the supplement exists; the price is never translated.
  name_fr text,
  -- Per-PERSON price in minor units. Server-authoritative: api_book reads it here and the client
  -- only ever sends an id + a head count.
  price_minor int not null default 0 check (price_minor >= 0),
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists activity_supplements_activity_idx
  on activity_supplements (activity_id, position, id);

alter table activity_supplements enable row level security;

-- Public reads the published catalogue's supplements (the booking widget prices locally from them);
-- staff manage. Mirrors activity_option_prices exactly.
drop policy if exists activity_supplements_read on activity_supplements;
create policy activity_supplements_read on activity_supplements for select using (
  exists (select 1 from activities a where a.id = activity_id and (a.status = 'published' or is_staff()))
);
drop policy if exists activity_supplements_staff on activity_supplements;
create policy activity_supplements_staff on activity_supplements for all
  using (is_staff()) with check (is_staff());

grant select on activity_supplements to anon, authenticated, service_role;
grant insert, update, delete on activity_supplements to authenticated, service_role;

-- Migrate the single-supplement columns into the table (once — an activity that already has rows is
-- left alone, so re-running never duplicates). The FR label comes along from activity_translations.
insert into activity_supplements (activity_id, name, name_fr, price_minor, position)
select a.id,
       btrim(a.supplement_name),
       nullif(btrim(coalesce(t.supplement_name, '')), ''),
       coalesce(a.supplement_minor, 0),
       0
from activities a
left join activity_translations t on t.activity_id = a.id and t.locale = 'fr'
where nullif(btrim(coalesce(a.supplement_name, '')), '') is not null
  and not exists (select 1 from activity_supplements s where s.activity_id = a.id);

comment on column activities.supplement_name is
  'FROZEN legacy (20260908000000): the single supplement moved to activity_supplements. Kept only '
  'because the live catalogue dump/seed reference the column; nothing writes or reads it.';
comment on column activities.supplement_minor is
  'FROZEN legacy (20260908000000): see activities.supplement_name.';
comment on column activity_translations.supplement_name is
  'FROZEN legacy (20260908000000): the FR label moved to activity_supplements.name_fr.';

-- ---------------------------------------------------------------------------
-- 1b) booking_supplements — what a booking actually bought, snapshot per supplement.
-- ---------------------------------------------------------------------------
create table if not exists booking_supplements (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references bookings (id) on delete cascade,
  -- SET NULL: the owner deleting a supplement from the menu must never break an old booking's
  -- receipt — the name/unit/total below are the snapshot that survives.
  supplement_id uuid references activity_supplements (id) on delete set null,
  name text not null,
  qty int not null check (qty > 0),
  unit_minor int not null check (unit_minor >= 0),
  total_minor int not null check (total_minor >= 0),
  -- The MENU position at booking time, so every reader (booking_json → invoice / alert /
  -- confirmation) lists the supplements in one stable order. Ordering by id would be ordering by
  -- gen_random_uuid() — i.e. random per booking.
  position int not null default 0
);
create index if not exists booking_supplements_booking_idx on booking_supplements (booking_id);
-- One row per supplement per booking (api_book aggregates payload duplicates before inserting;
-- this backstops it). Partial: legacy backfilled rows carry no supplement_id.
create unique index if not exists booking_supplements_booking_supplement_key
  on booking_supplements (booking_id, supplement_id) where supplement_id is not null;

alter table booking_supplements enable row level security;

-- Owner-or-staff read, exactly like booking_items; writes only via the definer RPC below.
drop policy if exists booking_supplements_select on booking_supplements;
create policy booking_supplements_select on booking_supplements for select using (
  exists (select 1 from bookings b where b.id = booking_id and (b.user_id = auth.uid() or is_staff()))
);
drop policy if exists booking_supplements_staff on booking_supplements;
create policy booking_supplements_staff on booking_supplements for all
  using (is_staff()) with check (is_staff());

grant select on booking_supplements to authenticated, service_role;
grant insert, update, delete on booking_supplements to service_role;

-- Backfill the old scalar snapshots (unit price recovered as total/qty — exact, because api_book
-- always wrote total = unit × qty). Once: a booking that already has rows is left alone.
insert into booking_supplements (booking_id, name, qty, unit_minor, total_minor)
select b.id, b.supplement_name, b.supplement_qty,
       (b.supplement_minor / b.supplement_qty)::int, b.supplement_minor
from bookings b
where b.supplement_qty > 0 and b.supplement_name is not null
  and not exists (select 1 from booking_supplements bs where bs.booking_id = b.id);

comment on column bookings.supplement_name is
  'FROZEN legacy (20260908000000): supplements snapshot per row in booking_supplements now. '
  'Backfilled there; nothing writes or reads these three columns.';

-- ---------------------------------------------------------------------------
-- 2) guests_per_trip — how many guests ONE trip (one booking) can take.
--    activities.guests_per_trip is the default; activity_options.guests_per_trip overrides it.
--    NULL = uncapped (the pre-migration behaviour). Only meaningful for shared per_person /
--    per_group options: a private option's cap is private_max_guests, a vehicle's is the bracket.
-- ---------------------------------------------------------------------------
alter table activities
  add column if not exists guests_per_trip int
    check (guests_per_trip is null or guests_per_trip >= 1);
alter table activity_options
  add column if not exists guests_per_trip int
    check (guests_per_trip is null or guests_per_trip >= 1);

comment on column activities.guests_per_trip is
  'Max guests ONE booking may hold on a shared option (the "guests per trip" half of the '
  'availability screen; daily_capacity stays the whole day''s guest pool = trips x this). NULL = '
  'no per-booking cap. Options may override via activity_options.guests_per_trip.';
comment on column activity_options.guests_per_trip is
  'Per-option override of activities.guests_per_trip (shared options only — a private option''s '
  'cap is private_max_guests). NULL = inherit the activity''s number.';

-- ---------------------------------------------------------------------------
-- 3) set_daily_capacity_atomic — the 20260801000000 body VERBATIM, plus guestsPerTrip:
--    * activity path: `guestsPerTrip` (when the key is present) writes activities.guests_per_trip;
--    * option path:   for a SHARED option it writes activity_options.guests_per_trip; for a PRIVATE
--      option it writes private_max_guests (validated against private_included, so the pricing
--      constraint can never be tripped into a 500);
--    * option path now allows a guests-only update (capacity omitted) — the availability screen
--      edits the two numbers of a single-private-option activity through two different rows;
--    * inherit clears guests_per_trip along with daily_capacity (back to the activity's numbers).
-- ---------------------------------------------------------------------------
create or replace function set_daily_capacity_atomic(p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_activity_id uuid := nullif(p ->> 'activityId', '')::uuid;
  v_capacity int := (p ->> 'capacity')::int;
  v_option_id uuid := nullif(p ->> 'optionId', '')::uuid;
  v_inherit boolean := coalesce((p ->> 'inherit')::boolean, false);
  v_has_gpt boolean := p ? 'guestsPerTrip';
  v_gpt int := nullif(p ->> 'guestsPerTrip', '')::int;
  v_activity_capacity int;
  v_private_base int;
  v_private_included int;
begin
  if not is_staff() then
    raise exception 'forbidden';
  end if;
  if v_activity_id is null then
    raise exception 'invalid_request';
  end if;
  if v_has_gpt and v_gpt is not null and v_gpt < 1 then
    raise exception 'invalid_request';
  end if;
  if v_option_id is not null and v_inherit then
    -- Clear the option's overrides; its future occurrences fall back to the activity numbers.
    update activity_options set daily_capacity = null, guests_per_trip = null
     where id = v_option_id and activity_id = v_activity_id;
    if not found then
      raise exception 'invalid_request';
    end if;
    select daily_capacity into v_activity_capacity from activities where id = v_activity_id;
    if v_activity_capacity is not null then
      update session_occurrences so
         set capacity = v_activity_capacity
       where so.activity_option_id = v_option_id
         and so.starts_at >= now();
    end if;
  elsif v_option_id is not null then
    -- Option-scoped: capacity and/or guests-per-trip for THIS option only.
    if v_capacity is null and not v_has_gpt then
      raise exception 'invalid_request';
    end if;
    if v_capacity is not null and v_capacity < 0 then
      raise exception 'invalid_request';
    end if;
    if v_has_gpt then
      select private_base_minor, private_included into v_private_base, v_private_included
        from activity_options where id = v_option_id and activity_id = v_activity_id;
      if not found then
        raise exception 'invalid_request';
      end if;
      if v_private_base is not null then
        -- Private option: "guests per trip" IS private_max_guests. It must stay a number (the
        -- completeness constraint requires one) and cover at least the base's included heads.
        if v_gpt is null or v_gpt < coalesce(v_private_included, 1) then
          raise exception 'invalid_request'
            using detail = format('private guests/trip must be >= %s', coalesce(v_private_included, 1));
        end if;
        update activity_options set private_max_guests = v_gpt
         where id = v_option_id and activity_id = v_activity_id;
      else
        update activity_options set guests_per_trip = v_gpt
         where id = v_option_id and activity_id = v_activity_id;
      end if;
    end if;
    if v_capacity is not null then
      update activity_options set daily_capacity = v_capacity
       where id = v_option_id and activity_id = v_activity_id;
      if not found then
        raise exception 'invalid_request';
      end if;
      update session_occurrences so
         set capacity = v_capacity
       where so.activity_option_id = v_option_id
         and so.starts_at >= now();
    end if;
  else
    if v_capacity is null or v_capacity < 0 then
      raise exception 'invalid_request';
    end if;
    if v_has_gpt then
      update activities set daily_capacity = v_capacity, guests_per_trip = v_gpt
        where id = v_activity_id;
    else
      update activities set daily_capacity = v_capacity where id = v_activity_id;
    end if;
    update session_occurrences so
       set capacity = v_capacity
      from activity_options o
     where so.activity_option_id = o.id
       and o.activity_id = v_activity_id
       and o.daily_capacity is null
       and so.starts_at >= now();
  end if;
  perform materialize_availability(jsonb_build_object('activityId', v_activity_id::text));
end;
$$;
revoke execute on function set_daily_capacity_atomic(jsonb) from public;
grant execute on function set_daily_capacity_atomic(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4) create_booking — the 20260812000000 body VERBATIM, plus the guests-per-trip guard on the
--    shared (per_person / per_group) branch: one booking may not exceed
--    coalesce(option.guests_per_trip, activity.guests_per_trip). Private/vehicle branches keep
--    their own caps (private_max_guests / the bracket) and are untouched.
-- ---------------------------------------------------------------------------
create or replace function create_booking(
  p_idempotency_key text,
  p_hold_id uuid,
  p_customer_name text,
  p_customer_email text,
  p_customer_phone text,
  p_source booking_source,
  p_items jsonb,
  p_suv boolean default false
)
returns bookings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing bookings;
  v_hold booking_holds;
  v_occ session_occurrences;
  v_option_id uuid;
  v_mode text := 'per_person';
  v_trip_cap int;
  v_booking bookings;
  v_item jsonb;
  v_label text;
  v_qty int;
  v_unit bigint;
  v_max int;
  v_total bigint := 0;
  v_qty_total int := 0;
  v_agg jsonb := '{}'::jsonb;
  v_vehicle text;
  v_sedan bigint;
  v_suv_price bigint;
  v_family bigint;
  v_van bigint;
  v_coaster bigint;
  v_pl_standard bigint;
  v_pl_suv bigint;
  v_pl_six bigint;
  v_pl_van bigint;
  v_pl_coach bigint;
  v_pl_max int;
  v_pb bigint;
  v_pi int;
  v_pe bigint;
  v_pm int;
  v_opt_name text;
begin
  select * into v_existing from bookings where idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_hold from booking_holds where id = p_hold_id for update;
  if not found then
    raise exception 'hold_not_found';
  end if;
  if v_hold.status <> 'active' or v_hold.expires_at <= now() then
    raise exception 'hold_not_active';
  end if;
  -- Re-checked HERE, under the FOR UPDATE taken above: attaching to a booking does not change the
  -- hold's status, so the active check alone would let a second booking (different idempotency key)
  -- adopt a hold that booking A already consumed — two payable bookings sharing one capacity unit.
  -- The idempotency-replay path returned earlier, so any booking_id at this point is a conflict.
  if v_hold.booking_id is not null then
    raise exception 'hold_already_used';
  end if;

  select * into v_occ from session_occurrences where id = v_hold.session_occurrence_id for update;
  if v_occ.status <> 'open' then
    raise exception 'occurrence_not_bookable' using detail = v_occ.status::text;
  end if;
  v_option_id := v_occ.activity_option_id;

  -- Pricing mode + the per-booking guest cap for shared options (option override, else the
  -- activity default; NULL = uncapped, the pre-20260908 behaviour).
  select a.pricing_mode, coalesce(o.guests_per_trip, a.guests_per_trip)
    into v_mode, v_trip_cap
  from activity_options o
  join activities a on a.id = o.activity_id
  where o.id = v_option_id;
  v_mode := coalesce(v_mode, 'per_person');

  select private_base_minor, private_included, private_extra_minor, private_max_guests, name
    into v_pb, v_pi, v_pe, v_pm, v_opt_name
  from activity_options
  where id = v_option_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_label := v_item ->> 'price_label';
    v_qty := (v_item ->> 'quantity')::int;
    if v_label is null or v_qty is null or v_qty <= 0 then
      raise exception 'invalid_item';
    end if;
    v_qty_total := v_qty_total + v_qty;
    v_agg := jsonb_set(v_agg, array[v_label], to_jsonb(coalesce((v_agg ->> v_label)::int, 0) + v_qty));
  end loop;
  if v_qty_total <= 0 then
    raise exception 'invalid_item';
  end if;

  if v_pb is not null then
    -- Private option (option-level flag): a flat base covers the first v_pi guests, v_pe per extra
    -- head. Counted like a vehicle: ONE capacity unit per booking (the pool is trips/day), with the
    -- real headcount recorded in pax on the single line item below.
    if v_qty_total < 1 or v_qty_total > v_pm then
      raise exception 'exceeds_max_guests' using detail = format('private: %s > %s', v_qty_total, v_pm);
    end if;
    v_total := v_pb + v_pe * greatest(0, v_qty_total - v_pi);
    v_vehicle := coalesce(nullif(v_opt_name, ''), 'Private');
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('private hold %s', v_hold.quantity);
    end if;
  elsif v_mode = 'vehicle' then
    -- One flat price for the bracket that fits P = v_qty_total (people on board). (Unchanged.)
    if v_qty_total < 1 or v_qty_total > 25 then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    select sedan_minor, suv_minor, family_minor, van_minor, coaster_minor
      into v_sedan, v_suv_price, v_family, v_van, v_coaster
      from sightseeing_pricing limit 1;
    if v_sedan is null then
      raise exception 'sightseeing_pricing_unset';
    end if;
    if v_qty_total <= 4 then
      if p_suv then
        v_total := v_suv_price;
        v_vehicle := 'SUV';
      else
        v_total := v_sedan;
        v_vehicle := 'Sedan';
      end if;
    elsif v_qty_total <= 6 then
      v_total := v_family;
      v_vehicle := 'Family car';
    elsif v_qty_total <= 14 then
      v_total := v_van;
      v_vehicle := 'Van';
    else
      v_total := v_coaster;
      v_vehicle := 'Coaster';
    end if;
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  elsif v_mode = 'vehicle_custom' then
    -- Parallel planner path: same bracket shape, the planner's own prices/names + cap.
    select standard_minor, suv_minor, six_minor, van_minor, coach_minor, max_party
      into v_pl_standard, v_pl_suv, v_pl_six, v_pl_van, v_pl_coach, v_pl_max
      from planner_pricing limit 1;
    if v_pl_standard is null then
      raise exception 'planner_pricing_unset';
    end if;
    if v_qty_total < 1 or v_qty_total > v_pl_max then
      raise exception 'exceeds_vehicle_capacity' using detail = v_qty_total::text;
    end if;
    if v_qty_total <= 4 then
      if p_suv then
        v_total := v_pl_suv;
        v_vehicle := 'SUV';
      else
        v_total := v_pl_standard;
        v_vehicle := 'Standard car';
      end if;
    elsif v_qty_total <= 6 then
      v_total := v_pl_six;
      v_vehicle := '6-seater';
    elsif v_qty_total <= 14 then
      v_total := v_pl_van;
      v_vehicle := 'Van';
    else
      v_total := v_pl_coach;
      v_vehicle := 'Coach';
    end if;
    if v_hold.quantity <> 1 then
      raise exception 'items_quantity_mismatch' using detail = format('vehicle hold %s', v_hold.quantity);
    end if;
  else
    -- Per-person / per-group: one booking may not exceed the option's guests-per-trip (the boat
    -- only seats so many, however big the day's pool is). NULL = uncapped, as before 20260908.
    if v_trip_cap is not null and v_qty_total > v_trip_cap then
      raise exception 'exceeds_max_guests' using detail = format('trip: %s > %s', v_qty_total, v_trip_cap);
    end if;
    -- Price each aggregated tier from the DB. (Unchanged.)
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      if not found then
        raise exception 'unknown_price_tier' using detail = v_label;
      end if;
      if v_mode = 'per_group' and v_max is not null then
        v_total := v_total + (v_unit * ceil(v_qty::numeric / v_max)::int);
      else
        if v_max is not null and v_qty > v_max then
          raise exception 'exceeds_max_guests' using detail = format('%s: %s > %s', v_label, v_qty, v_max);
        end if;
        v_total := v_total + (v_unit * v_qty);
      end if;
    end loop;
    if v_qty_total <> v_hold.quantity then
      raise exception 'items_quantity_mismatch'
        using detail = format('items %s, hold %s', v_qty_total, v_hold.quantity);
    end if;
  end if;

  -- A EUR 0 booking must never exist: an all-free party (infants only) would otherwise mint a
  -- zero-amount payment that flips 'paid' on any event. The client blocks free-only parties;
  -- enforce it zero-trust here too.
  if v_total <= 0 then
    raise exception 'zero_total';
  end if;

  insert into bookings (
    idempotency_key, customer_name, customer_email, customer_phone, source,
    status, total_minor, operator_payout_minor, agency_commission_minor
  )
  values (
    p_idempotency_key, p_customer_name, p_customer_email, p_customer_phone,
    coalesce(p_source, 'web'), 'payment_pending', v_total, v_total, 0
  )
  returning * into v_booking;

  if v_pb is not null or v_mode in ('vehicle', 'vehicle_custom') then
    insert into booking_items (
      booking_id, session_occurrence_id, activity_option_id, price_label,
      quantity, unit_amount_minor, subtotal_minor, pax
    )
    values (
      v_booking.id, v_hold.session_occurrence_id, v_option_id, v_vehicle,
      1, v_total, v_total, v_qty_total
    );
  else
    for v_label, v_qty in select key, (value::text)::int from jsonb_each(v_agg) loop
      select amount_minor, max_guests into v_unit, v_max
      from activity_option_prices
      where activity_option_id = v_option_id and label = v_label;
      insert into booking_items (
        booking_id, session_occurrence_id, activity_option_id, price_label,
        quantity, unit_amount_minor, subtotal_minor
      )
      values (
        v_booking.id, v_hold.session_occurrence_id, v_option_id, v_label, v_qty, v_unit,
        case
          when v_mode = 'per_group' and v_max is not null then v_unit * ceil(v_qty::numeric / v_max)::int
          else v_unit * v_qty
        end
      );
    end loop;
  end if;

  -- Conditional attach, belt-and-braces with the guard above: if anything ever attaches this hold
  -- between our check and here, refuse rather than silently overwrite the other booking's claim.
  update booking_holds set booking_id = v_booking.id where id = v_hold.id and booking_id is null;
  if not found then
    raise exception 'hold_already_used';
  end if;
  return v_booking;
end;
$$;

revoke execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  from public, anon, authenticated;
grant execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  to service_role;

-- ---------------------------------------------------------------------------
-- 5) api_book — the 20260905000000 body VERBATIM, with the single-supplement charge replaced by
--    the booking_supplements loop. The payload's `supplements` is [{id, qty}] only: each id must
--    belong to the activity behind the occurrence (zero-trust — an unknown or foreign id is simply
--    ignored), duplicates are aggregated, each qty is clamped to the head count, and the unit price
--    comes from the supplement row. Replay guards, both required: rows already written (the normal
--    replay) OR a payment exists (a mutated replay must never re-price a booking mid-payment).
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
  v_mode text := 'per_person';
  v_is_private boolean := false;
  v_suv boolean := coalesce((p ->> 'suv')::boolean, false);
  v_hold_id uuid := nullif(p ->> 'holdId', '')::uuid;
  v_want_qty int;
  v_reused boolean := false;
  v_child int;
  v_child_extra bigint;
  v_supp_total bigint := 0;
  v_activity_id uuid;
  v_hold booking_holds;
  v_booking bookings;
  r record;
  v_activity_region text;
  v_pickup_available boolean := false;
  v_pickup_lat double precision;
  v_pickup_lng double precision;
  v_pickup_region text;
  v_transport bigint;
  v_is_airport boolean := false;
  v_is_hotel boolean := false;
  v_dropoff_zone text;
  v_trip_type text;
  v_trip_direction text;
  v_ret_pct int;
  v_fare bigint;
  v_hotel_pickup_region text;
  v_hotel_dropoff_region text;
  v_band text;
  v_actor uuid;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;

  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  for r in select key, (value::text)::bigint as q from jsonb_each(p -> 'party') loop
    if r.q < 0 or r.q > 1000000 then raise exception 'invalid_party'; end if;
    if r.q > 0 then
      v_total_qty := v_total_qty + r.q;
      v_items := v_items || jsonb_build_object('price_label', r.key, 'quantity', r.q);
    end if;
  end loop;
  if v_total_qty <= 0 or v_total_qty > 1000000 then raise exception 'invalid_party'; end if;

  select a.pricing_mode,
         coalesce(a.region, region_from_coords(a.lat, a.lng)),
         coalesce(a.pickup_available, false),
         coalesce(a.is_airport_transfer, false),
         coalesce(a.is_hotel_transfer, false),
         (o.private_base_minor is not null),
         a.id
    into v_mode, v_activity_region, v_pickup_available, v_is_airport, v_is_hotel, v_is_private,
         v_activity_id
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_mode := coalesce(v_mode, 'per_person');
  v_want_qty := case when v_mode in ('vehicle', 'vehicle_custom')
                       or coalesce(v_is_private, false) then 1 else v_total_qty::int end;

  -- Actor identity, resolved BEFORE the hold-reuse gate so ownership can bind reuse. api_book is
  -- service-role-only, so auth.uid() is null; the JWKS-verified caller id arrives as p.actorUserId
  -- (trustworthy BECAUSE only the server can execute this function). auth.uid() stays first as
  -- belt-and-suspenders.
  v_actor := coalesce(auth.uid(), nullif(p ->> 'actorUserId', '')::uuid);

  if v_hold_id is not null then
    -- FOR UPDATE: two concurrent api_book calls quoting the same holdId must serialise here, or both
    -- read booking_id IS NULL and both proceed (create_booking's own lock cannot save the second one
    -- on its own — it re-checks under the lock, but only because of the guard added alongside this).
    -- Ownership: an OWNED hold (created_by set) is only reusable by its owner; an ownerless hold
    -- (guest checkout, or created before sign-in) stays reusable by whoever holds the unguessable id,
    -- which keeps the guest → sign-in-mid-checkout flow working.
    select * into v_hold from booking_holds
    where id = v_hold_id and status = 'active' and expires_at > now() and booking_id is null
      and session_occurrence_id = v_occ and quantity = v_want_qty
      and (created_by is null or created_by = v_actor)
    for update;
    if found then v_reused := true; end if;
  end if;
  -- A REPLAY whose booking already exists must not mint a hold.
  --
  -- create_booking's idempotency check runs before it ever looks at p_hold_id, so on a replay it
  -- returns the existing booking and never attaches whatever hold we passed. The original hold is by
  -- then consumed (booking_id set), so the reuse SELECT above cannot match it and v_reused is false --
  -- and create_hold would mint a fresh one that nothing ever claims. It then sits ACTIVE, counted by
  -- used_capacity, for its whole TTL. Worse, on a nearly-full departure create_hold raises
  -- insufficient_capacity, so a legitimate retry of a booking that ALREADY SUCCEEDED fails instead of
  -- returning it -- the caller is told the booking failed when it did not.
  -- (Only ever one orphan: a second replay finds it by idempotency key. One is enough to sell out a
  -- last vehicle.)
  if not v_reused and not exists (select 1 from bookings where idempotency_key = v_key) then
    v_hold := create_hold(v_occ, v_want_qty, v_key || ':book');
  end if;

  v_booking := create_booking(
    v_key, v_hold.id, p ->> 'customerName', p ->> 'customerEmail', p ->> 'customerPhone',
    coalesce((p ->> 'source')::booking_source, 'web'), v_items, v_suv
  );

  -- F23 (replay-disclosure guard): create_booking returns the existing row on an idempotency-key
  -- replay, and api_book runs SECURITY DEFINER, so RLS does not filter the returned DTO. Refuse to
  -- echo a booking the caller can't prove they own:
  --   * an authenticated user replaying someone else's OWNED booking -> forbidden;
  --   * ANY caller replaying an UNOWNED (guest) booking whose supplied email doesn't match -> forbidden.
  --     A stolen/guessed key alone (authenticated OR anonymous) would otherwise hand back the original
  --     guest's PII / let an authed caller adopt the row. A legitimate retry resends the same email and
  --     passes; a fresh create trivially passes (just inserted with this caller's email).
  if (v_booking.user_id is not null and v_booking.user_id is distinct from v_actor)
     or (v_booking.user_id is null
         and lower(coalesce(v_booking.customer_email, '')) <> lower(coalesce(p ->> 'customerEmail', '')))
  then
    raise exception 'forbidden';
  end if;
  if v_actor is not null then
    update bookings set user_id = v_actor where id = v_booking.id and user_id is null;
  end if;

  -- Ownership for the FALLBACK hold: when no reusable holdId was supplied, api_book mints its own
  -- hold above via create_hold, which runs under service_role here (server-only RPC) and so wrote
  -- created_by = auth.uid() = NULL. Stamp the actor onto it so the customer's owner-scoped hold
  -- status/release endpoints work. A REUSED hold already carries its owner (created_by not null),
  -- so the guard leaves it alone; a guest booking (v_actor null) leaves the hold ownerless as before.
  if v_actor is not null then
    update booking_holds set created_by = v_actor where id = v_hold.id and created_by is null;
  end if;

  -- The language the guest booked in. Email and PDFs render later, often from a cron worker with no
  -- request context, so the locale must be stored rather than inferred at send time. Unconditional: by
  -- this point the F23 guard above has already verified the caller may act on this booking, so re-
  -- asserting the same value on an idempotent replay is harmless. Absent/empty collapses to 'en' (never
  -- SQL NULL, never a failed enum cast), so an older client that sends no locale still books cleanly.
  update bookings
  set locale = coalesce(nullif(p ->> 'locale', ''), 'en')::content_locale
  where id = v_booking.id;

  if p ? 'itinerary'
     and jsonb_typeof(p -> 'itinerary') = 'array'
     and jsonb_array_length(p -> 'itinerary') > 0
     and jsonb_array_length(p -> 'itinerary') <= 30
  then
    update bookings set custom_itinerary = p -> 'itinerary'
    where id = v_booking.id and custom_itinerary is null;
  end if;

  if nullif(btrim(p ->> 'pickupLocation'), '') is not null then
    update bookings set pickup_location = left(btrim(p ->> 'pickupLocation'), 200)
    where id = v_booking.id and pickup_location is null;
  end if;

  -- Drop-off is its OWN field (never merged into pickup_location). pickup_pending records "pickup to be
  -- arranged" — distinct from "no pickup" — and is set on the just-created row only.
  if nullif(btrim(p ->> 'dropoffLocation'), '') is not null then
    update bookings set dropoff_location = left(btrim(p ->> 'dropoffLocation'), 200)
    where id = v_booking.id and dropoff_location is null;
  end if;

  if coalesce((p ->> 'pickupPending')::boolean, false) then
    update bookings set pickup_pending = true
    where id = v_booking.id and pickup_pending = false;
  end if;

  -- Airport transfer (server-authoritative, zero-trust): the destination ZONE comes from the hotel
  -- SLUG via airport_transfer_hotels — never a client-sent zone. When the guest's hotel isn't listed
  -- (no dropoffSlug), classify the zone from the supplied AREA instead (Zone 2 = the near-airport
  -- south-east areas), still never trusting a client price. The whole fare is the zone × vehicle matrix
  -- (vehicle derived from party size + the ≤4 SUV upgrade); a return trip is two legs minus the
  -- configured discount. We OVERRIDE the booking total + payout + the single line item so the receipt's
  -- item == total. Mirrors airportTransferQuoteMinor() in pricing.ts.
  if v_is_airport then
    v_trip_direction := case
      when (p ->> 'tripDirection') in ('arrival', 'departure', 'return') then p ->> 'tripDirection'
      when (p ->> 'tripType') = 'return' then 'return'
      else 'arrival'
    end;
    v_trip_type := case when v_trip_direction = 'return' then 'return' else 'one_way' end;
    if nullif(p ->> 'dropoffSlug', '') is not null then
      select zone into v_dropoff_zone from airport_transfer_hotels
        where slug = nullif(p ->> 'dropoffSlug', '');
    end if;
    if v_dropoff_zone is null then
      v_dropoff_zone := airport_transfer_area_zone(p ->> 'dropoffArea');
    end if;
    v_fare := airport_transfer_fare_minor(v_dropoff_zone, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from airport_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    -- Replay guard, matching the pattern every other post-create mutation in this function already
    -- uses (`and custom_itinerary is null`, `and pickup_location is null`, `and pickup_pending = false`).
    -- create_booking returns the EXISTING row on an idempotency-key replay, so unguarded this silently
    -- re-prices a booking that has already started paying -- moving total_minor out from under the MUR
    -- charge pinned on its payment row and a Peach session already minted for the old amount.
    if v_fare > 0 and not exists (select 1 from payments pay where pay.booking_id = v_booking.id) then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        trip_direction = v_trip_direction,
        flight_number = left(nullif(btrim(p ->> 'flightNumber'), ''), 40),
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        departure_flight_number = left(nullif(btrim(p ->> 'departureFlightNumber'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        child_seat_age = nullif(p ->> 'childSeatAge', '')::int,
        traveller_gender = left(nullif(btrim(p ->> 'travellerGender'), ''), 20),
        traveller_company = left(nullif(btrim(p ->> 'travellerCompany'), ''), 120),
        traveller_country = left(nullif(btrim(p ->> 'travellerCountry'), ''), 80),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
  end if;

  -- Hotel-to-hotel transfer (server-authoritative, zero-trust): derive BOTH endpoints' regions from the
  -- hotel SLUGS via airport_transfer_hotels (or area_region() for a free-text end), reject a same-hotel
  -- trip, classify the distance band (region_distance_band), and price band × vehicle (× return discount).
  -- OVERRIDE the booking total + payout + line item. Mirrors hotelTransferQuoteMinor() in pricing.ts.
  if v_is_hotel then
    if nullif(p ->> 'pickupSlug', '') is not null
       and nullif(p ->> 'pickupSlug', '') = nullif(p ->> 'dropoffSlug', '') then
      raise exception 'same_hotel';
    end if;
    v_trip_type := case when (p ->> 'tripType') = 'return' then 'return' else 'one_way' end;
    v_hotel_pickup_region := hotel_end_region(
      p ->> 'pickupSlug',
      nullif(p ->> 'pickupLat', '')::double precision,
      nullif(p ->> 'pickupLng', '')::double precision,
      p ->> 'pickupArea');
    v_hotel_dropoff_region := hotel_end_region(
      p ->> 'dropoffSlug',
      nullif(p ->> 'dropoffLat', '')::double precision,
      nullif(p ->> 'dropoffLng', '')::double precision,
      p ->> 'dropoffArea');
    v_band := region_distance_band(v_hotel_pickup_region, v_hotel_dropoff_region);
    v_fare := hotel_transfer_fare_minor(v_band, v_total_qty::int, v_suv);
    if v_trip_type = 'return' then
      select coalesce(return_discount_pct, 0) into v_ret_pct from hotel_transfer_config limit 1;
      v_fare := round(v_fare::numeric * 2 * (100 - coalesce(v_ret_pct, 0)) / 100)::bigint;
    end if;
    -- Replay guard, matching the pattern every other post-create mutation in this function already
    -- uses (`and custom_itinerary is null`, `and pickup_location is null`, `and pickup_pending = false`).
    -- create_booking returns the EXISTING row on an idempotency-key replay, so unguarded this silently
    -- re-prices a booking that has already started paying -- moving total_minor out from under the MUR
    -- charge pinned on its payment row and a Peach session already minted for the old amount.
    if v_fare > 0 and not exists (select 1 from payments pay where pay.booking_id = v_booking.id) then
      update bookings
        set total_minor = v_fare, operator_payout_minor = v_fare
        where id = v_booking.id;
      update booking_items
        set unit_amount_minor = v_fare, subtotal_minor = v_fare
        where booking_id = v_booking.id;
    end if;
    update bookings set
        trip_type = v_trip_type,
        arrival_time = left(nullif(btrim(p ->> 'arrivalTime'), ''), 40),
        pickup_hotel_slug = left(nullif(btrim(p ->> 'pickupSlug'), ''), 120),
        pickup_region = v_hotel_pickup_region,
        return_date = nullif(p ->> 'returnDate', '')::date,
        return_time = left(nullif(btrim(p ->> 'returnTime'), ''), 40),
        room_or_cabin = left(nullif(btrim(p ->> 'roomOrCabin'), ''), 60),
        luggage_details = left(nullif(btrim(p ->> 'luggageDetails'), ''), 300),
        special_notes = left(nullif(btrim(p ->> 'specialNotes'), ''), 600)
      where id = v_booking.id;
  end if;

  v_child := least(greatest(coalesce(nullif(p ->> 'childSeats', '')::int, 0), 0), v_total_qty::int);
  if v_child > 0 then
    v_child_extra := greatest(0, v_child - 1) * 600;
    update bookings
    set child_seats = v_child,
        total_minor = total_minor + v_child_extra,
        operator_payout_minor = operator_payout_minor + v_child_extra
    where id = v_booking.id and child_seats = 0;
  end if;

  -- Per-activity supplements (e.g. the lobster lunch upgrade), MANY per activity since 20260908.
  -- Priced PER PERSON from each activity_supplements row, resolved by id AND scoped to the activity
  -- behind the occurrence — an unknown or foreign id simply doesn't join and charges nothing.
  -- Duplicate ids in the payload aggregate; every count clamps to the head count. Replay guards:
  -- rows already snapshot (the normal replay) or a payment already exists (a mutated replay must
  -- never re-price a booking mid-payment — [[gytm-drift-gate-double-charge]]). A configured-but-free
  -- supplement (price 0) still records the guest's request — the kitchen needs the head count.
  -- Sits after the transfer overrides for the same reason the child seats do: those OVERWRITE
  -- total_minor, so additive add-ons belong at the end.
  if p ? 'supplements'
     and jsonb_typeof(p -> 'supplements') = 'array'
     and jsonb_array_length(p -> 'supplements') between 1 and 20
     and not exists (select 1 from booking_supplements bs where bs.booking_id = v_booking.id)
     and not exists (select 1 from payments pay where pay.booking_id = v_booking.id)
  then
    for r in
      select s.id, s.name, s.price_minor, s.position,
             least(
               sum(least(greatest(coalesce(nullif(e ->> 'qty', '')::int, 0), 0), v_total_qty::int)),
               v_total_qty
             )::int as q
      from jsonb_array_elements(p -> 'supplements') e
      join activity_supplements s
        on s.id = nullif(e ->> 'id', '')::uuid
       and s.activity_id = v_activity_id
      group by s.id, s.name, s.price_minor, s.position
      order by s.position, s.id
    loop
      if r.q > 0 then
        insert into booking_supplements (booking_id, supplement_id, name, qty, unit_minor, total_minor, position)
        values (v_booking.id, r.id, r.name, r.q, r.price_minor, r.price_minor::bigint * r.q, r.position)
        on conflict (booking_id, supplement_id) where supplement_id is not null do nothing;
        v_supp_total := v_supp_total + r.price_minor::bigint * r.q;
      end if;
    end loop;
    if v_supp_total > 0 then
      update bookings
      set total_minor = total_minor + v_supp_total,
          operator_payout_minor = operator_payout_minor + v_supp_total
      where id = v_booking.id;
    end if;
  end if;

  -- Region-based transport add-on (per_person / per_group with pickup_available): a fee that scales with
  -- how far the pickup is from the activity's boarding region. The server RE-DERIVES the region from the
  -- pickup coordinates and looks up the fare here — it never trusts a client-sent price. Round-trip rule:
  -- drop-off doesn't change the fare, so it isn't read. Mirrors transportFare() in pricing.ts.
  if v_mode in ('per_person', 'per_group') and v_pickup_available
     and nullif(p ->> 'pickupLat', '') is not null
     and nullif(p ->> 'pickupLng', '') is not null
  then
    v_pickup_lat := (p ->> 'pickupLat')::double precision;
    v_pickup_lng := (p ->> 'pickupLng')::double precision;
    v_pickup_region := region_from_coords(v_pickup_lat, v_pickup_lng);
    if v_pickup_region is not null and v_activity_region is not null then
      v_transport := transport_fare_minor(v_pickup_region, v_activity_region, v_total_qty::int, v_suv);
      if v_transport > 0 then
        update bookings
        set transport_minor = v_transport,
            total_minor = total_minor + v_transport,
            operator_payout_minor = operator_payout_minor + v_transport,
            pickup_region = v_pickup_region,
            pickup_lat = v_pickup_lat,
            pickup_lng = v_pickup_lng
        where id = v_booking.id and transport_minor = 0;
      end if;
    end if;
  end if;

  return booking_json(v_booking.id);
end;
$$;

revoke execute on function api_book(jsonb) from public, anon, authenticated;
grant execute on function api_book(jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 6) booking_json — the 20260905000000 body VERBATIM, with the three supplement scalars replaced by
--    the 'supplements' array (one entry per bought supplement, from the booking's own snapshot
--    rows). Old bookings were backfilled into booking_supplements above, so every reader sees one
--    shape. STAYS `security invoker`.
-- ---------------------------------------------------------------------------
create or replace function booking_json(p_booking_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', b.id, 'ref', b.ref, 'status', b.status, 'paymentState', b.payment_state,
    'customerName', b.customer_name, 'customerEmail', b.customer_email,
    'totalEur', b.total_minor::float / 100, 'currency', b.currency, 'source', b.source,
    'createdAt', b.created_at,
    'customItinerary', b.custom_itinerary,
    'pickupLocation', b.pickup_location,
    'dropoffLocation', b.dropoff_location,
    'pickupPending', b.pickup_pending,
    'pickupHotelSlug', b.pickup_hotel_slug,
    'childSeats', b.child_seats,
    'transportEur', b.transport_minor::float / 100,
    'supplements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', bs.name, 'qty', bs.qty,
        'unitEur', bs.unit_minor::float / 100, 'totalEur', bs.total_minor::float / 100
      ) order by bs.position, bs.name)
      from booking_supplements bs where bs.booking_id = b.id
    ), '[]'::jsonb),
    'pickupRegion', b.pickup_region,
    'tripType', b.trip_type,
    'tripDirection', b.trip_direction,
    'flightNumber', b.flight_number,
    'arrivalTime', b.arrival_time,
    'returnDate', b.return_date,
    'returnTime', b.return_time,
    'departureFlightNumber', b.departure_flight_number,
    'roomOrCabin', b.room_or_cabin,
    'luggageDetails', b.luggage_details,
    'childSeatAge', b.child_seat_age,
    'travellerGender', b.traveller_gender,
    'travellerCompany', b.traveller_company,
    'travellerCountry', b.traveller_country,
    'specialNotes', b.special_notes,
    'disruption', b.disruption,
    'partySize', coalesce((
      select sum(coalesce(bi.pax, bi.quantity))
        from booking_items bi where bi.booking_id = b.id
    ), 0),
    -- The BOOKING-UNIT count, the unit seatsLeft is denominated in. For a per-person option it equals
    -- partySize; for a vehicle/private one it is 1 (one van / one trip, any group size). The date
    -- picker must filter on THIS, not partySize, or a 6-guest transfer is offered nothing.
    'unitsNeeded', coalesce((
      select sum(bi.quantity)
        from booking_items bi where bi.booking_id = b.id
    ), 0),
    'activityOptionId', (
      select bi.activity_option_id
        from booking_items bi where bi.booking_id = b.id order by bi.id limit 1
    ),
    'activitySlug', (
      select a.slug
        from booking_items bi
        join activity_options ao on ao.id = bi.activity_option_id
        join activities a on a.id = ao.activity_id
       where bi.booking_id = b.id
       order by bi.id limit 1
    ),
    'cancellable', (
      b.status = 'confirmed' and b.payment_state = 'paid'
      and (
        booking_awaiting_choice(b.disruption)
        or coalesce((
          select min(so.starts_at)
            from booking_items bi
            join session_occurrences so on so.id = bi.session_occurrence_id
           where bi.booking_id = b.id
        ), 'epoch'::timestamptz) > now() + interval '24 hours'
      )
    ),
    'reschedulable', (
      b.status = 'confirmed' and b.payment_state = 'paid'
      and (
        booking_awaiting_choice(b.disruption)
        or coalesce((
          select min(so.starts_at)
            from booking_items bi
            join session_occurrences so on so.id = bi.session_occurrence_id
           where bi.booking_id = b.id
        ), 'epoch'::timestamptz) > now() + interval '24 hours'
      )
    ),
    'serviceDate', (
      select min(so.starts_at)
        from booking_items bi
        join session_occurrences so on so.id = bi.session_occurrence_id
       where bi.booking_id = b.id
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'priceLabel', bi.price_label, 'quantity', bi.quantity, 'pax', bi.pax,
        'unitAmountEur', bi.unit_amount_minor::float / 100, 'subtotalEur', bi.subtotal_minor::float / 100,
        'occurrenceId', bi.session_occurrence_id
      ))
      from booking_items bi where bi.booking_id = b.id
    ), '[]'::jsonb)
  )
  from bookings b where b.id = p_booking_id;
$$;

-- ---------------------------------------------------------------------------
-- 7) api_get_activity — the 20260905000000 body VERBATIM, with:
--    * 'supplementName'/'supplementEur' replaced by the 'supplements' array (id + locale-resolved
--      name + per-person price), so the widget renders one picker row per supplement;
--    * each option carrying 'guestsPerTrip' (option override, else the activity default) so the
--      party selector caps itself at what one trip can take.
--    STAYS `security invoker` — definer-grants-lockdown.test.ts depends on it.
-- ---------------------------------------------------------------------------
create or replace function api_get_activity(p jsonb)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id, 'slug', a.slug, 'type', a.type, 'title', coalesce(t.title, a.title),
    'summary', coalesce(t.summary, a.summary),
    'description', coalesce(t.description, a.description), 'category', a.category, 'location', a.location,
    'durationMinutes', a.duration_minutes, 'meetingPoint', coalesce(t.meeting_point, a.meeting_point),
    'pickupAvailable', a.pickup_available, 'pricingMode', a.pricing_mode,
    'minAdvanceDays', coalesce(a.min_advance_days, 1),
    'isAirportTransfer', coalesce(a.is_airport_transfer, false),
    'isHotelTransfer', coalesce(a.is_hotel_transfer, false),
    'airportFares', case when coalesce(a.is_airport_transfer, false) then (
      select jsonb_object_agg(f.zone, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from airport_transfer_fare f
    ) else null end,
    'hotelTransferFares', case when coalesce(a.is_hotel_transfer, false) then (
      select jsonb_object_agg(f.band, jsonb_build_object(
        'sedanMinor', f.sedan_minor, 'suvMinor', f.suv_minor, 'familyMinor', f.family_minor,
        'vanMinor', f.van_minor, 'coasterMinor', f.coaster_minor
      )) from hotel_transfer_fare f
    ) else null end,
    'returnDiscountPct', case
      when coalesce(a.is_airport_transfer, false) then (select return_discount_pct from airport_transfer_config limit 1)
      when coalesce(a.is_hotel_transfer, false) then (select return_discount_pct from hotel_transfer_config limit 1)
      else null end,
    'region', coalesce(a.region, region_from_coords(a.lat, a.lng)),
    'lat', a.lat, 'lng', a.lng,
    'transportBands', case
      when a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false) then (
        select jsonb_object_agg(t.band, jsonb_build_object(
          'sedanMinor', t.sedan_minor, 'suvMinor', t.suv_minor, 'familyMinor', t.family_minor,
          'vanMinor', t.van_minor, 'coasterMinor', t.coaster_minor
        )) from transport_band_pricing t
      ) else null end,
    'regionDistances', case
      when (a.pricing_mode in ('per_person', 'per_group') and coalesce(a.pickup_available, false))
        or coalesce(a.is_hotel_transfer, false) then (
        select jsonb_object_agg(d.region_a || '|' || d.region_b, d.band) from region_zone_distance d
      ) else null end,
    'languages', to_jsonb(a.languages),
    'inclusions', to_jsonb(coalesce(nullif(t.inclusions, '{}'), a.inclusions)),
    'exclusions', to_jsonb(coalesce(nullif(t.exclusions, '{}'), a.exclusions)),
    'highlights', to_jsonb(coalesce(nullif(t.highlights, '{}'), a.highlights)), 'cancellationPolicy', a.cancellation_policy,
    'seoTitle', coalesce(t.seo_title, a.seo_title), 'seoDescription', coalesce(t.seo_description, a.seo_description),
    'extra', a.extra || coalesce(t.extra, '{}'::jsonb),
    'supplements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', case
          when coalesce(nullif(p ->> 'locale', ''), 'en') = 'fr'
            then coalesce(nullif(btrim(coalesce(s.name_fr, '')), ''), s.name)
          else s.name end,
        'priceEur', s.price_minor::float / 100
      ) order by s.position, s.id)
      from activity_supplements s where s.activity_id = a.id
    ), '[]'::jsonb),
    'ratingAvg', a.rating_avg, 'ratingCount', a.rating_count,
    'fromPriceEur', case
      when a.pricing_mode = 'vehicle'
        then (select sedan_minor from sightseeing_pricing limit 1)::float / 100
      else (
        -- Per-OPTION front price, then min across options (mirrors api_search_activities).
        select min(case when opt.banded then opt.max_amt else coalesce(opt.min_paid, opt.min_amt) end)::float / 100
        from (
          select bool_or(pr.min_age is not null or pr.max_age is not null) as banded,
                 max(pr.amount_minor) as max_amt,
                 min(pr.amount_minor) filter (where pr.amount_minor > 0) as min_paid,
                 min(pr.amount_minor) as min_amt
          from activity_option_prices pr
          join activity_options o on o.id = pr.activity_option_id
          where o.activity_id = a.id
          group by pr.activity_option_id
        ) opt
      )
    end,
    'vehiclePricing', case when a.pricing_mode = 'vehicle' then (
      select jsonb_build_object(
        'sedanEur', sedan_minor::float / 100,
        'suvEur', suv_minor::float / 100,
        'familyEur', family_minor::float / 100,
        'vanEur', van_minor::float / 100,
        'coasterEur', coaster_minor::float / 100,
        'maxParty', 25
      ) from sightseeing_pricing limit 1
    ) else null end,
    'heroImage', (
      select jsonb_build_object('id', img.id, 'url', img.url, 'alt', img.alt, 'position', img.position)
      from activity_images img where img.activity_id = a.id order by img.position limit 1
    ),
    'images', coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'url', i.url, 'alt', i.alt, 'position', i.position) order by i.position)
      from activity_images i where i.activity_id = a.id
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id, 'name', o.name, 'description', o.description, 'durationMinutes', o.duration_minutes, 'startWindow', o.start_window,
        'privateBaseEur', o.private_base_minor::float / 100,
        'privateIncluded', o.private_included,
        'privateExtraEur', o.private_extra_minor::float / 100,
        'privateMaxGuests', o.private_max_guests,
        'guestsPerTrip', coalesce(o.guests_per_trip, a.guests_per_trip),
        'prices', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', pr.id, 'label', pr.label, 'amountEur', pr.amount_minor::float / 100, 'maxGuests', pr.max_guests, 'minAge', pr.min_age, 'maxAge', pr.max_age
          ) order by pr.position)
          from activity_option_prices pr where pr.activity_option_id = o.id
        ), '[]'::jsonb)
      ) order by o.position)
      from activity_options o where o.activity_id = a.id
    ), '[]'::jsonb),
    'translations', coalesce((
      select jsonb_object_agg(t.locale, jsonb_build_object('title', t.title, 'summary', t.summary, 'description', t.description))
      from activity_translations t where t.activity_id = a.id
    ), '{}'::jsonb),
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rv.id, 'author', rv.author, 'rating', rv.rating, 'text', rv.text, 'createdAt', rv.created_at
      ) order by rv.created_at desc)
      from reviews rv where rv.activity_id = a.id
    ), '[]'::jsonb)
  )
  from activities a
  left join activity_translations t
    on t.activity_id = a.id
   and t.locale = coalesce(nullif(p ->> 'locale', ''), 'en')::content_locale
  where a.slug = p ->> 'slug';
$$;
grant execute on function api_get_activity(jsonb) to anon, authenticated, service_role;
