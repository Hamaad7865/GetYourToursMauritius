-- The customer's route stops being browser-only.
--
-- WHAT WENT WRONG. A Custom Road Trip (pricing_mode = 'vehicle_custom') is a full-day private
-- vehicle whose entire deliverable IS the list of places. That list travelled from the AI planner to
-- checkout through ONE channel: a sessionStorage key in the visitor's own tab, because the route is
-- too big for the URL. Nothing server-side ever saw it until api_book. On 9 Aug 2026 booking
-- BMTFF77DC5CDD471 confirmed and was paid (€100, 2 guests, 8 Oct) with custom_itinerary NULL — the
-- stash was gone by the time checkout read it, and the same absence shows in the hold record: that
-- booking's consumed hold was created in the SAME instant as the booking (api_book minted one
-- inline) instead of minutes earlier like every healthy one, because the hold id had vanished with
-- it. Two symptoms, one cause. The operator was left with a paid trip and no route, unrecoverable:
-- booking_holds had nowhere to keep one.
--
-- THE FIX, and why it is here rather than in the client. The route is now sent when the HOLD is
-- taken — the first moment the server hears about this booking at all — and stored on the hold. At
-- pay time the server prefers the client's copy (the customer may have edited the day after
-- holding) and falls back to the hold's. The browser stops being the sole custodian of the thing the
-- product is.
--
-- Deliberately NOT done here: api_book is untouched. It already accepts `itinerary`, so the fallback
-- is a resolution step in front of it (services/bookings.ts), and a 376-line money-path function
-- does not get rewritten for a field it already takes.

alter table booking_holds add column if not exists custom_itinerary jsonb;

comment on column booking_holds.custom_itinerary is
  'The customer-built route captured when the spot was held, so a browser that loses its copy before pay cannot lose the route. Read back by resolveCustomRoute at booking time; NULL for every activity that has no custom route.';

-- api_create_hold: unchanged except that it now records the route.
--
-- The store is idempotent-replay-safe in the same shape as created_by directly below it: create_hold
-- returns the EXISTING hold for a repeated idempotency key, and a replay must not blank a route the
-- first call already stored. So it only ever fills a NULL — never overwrites, never clears.
create or replace function api_create_hold(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_occ uuid := (p ->> 'occurrenceId')::uuid;
  v_key text := p ->> 'idempotencyKey';
  v_expected_slug text := nullif(p ->> 'expectedSlug', '');
  v_people bigint := coalesce((p ->> 'people')::bigint, 0);
  v_route jsonb := case when jsonb_typeof(p -> 'itinerary') = 'array'
                          and jsonb_array_length(p -> 'itinerary') > 0
                        then p -> 'itinerary' end;
  v_mode text := 'per_person';
  v_is_private boolean := false;
  v_qty int;
  v_hold booking_holds;
  v_uid uuid;
begin
  if v_occ is null or v_key is null then
    raise exception 'invalid_request';
  end if;
  if v_people <= 0 or v_people > 1000000 then
    raise exception 'invalid_party';
  end if;
  if v_expected_slug is not null and not exists (
    select 1 from session_occurrences so
    join activity_options o on o.id = so.activity_option_id
    join activities a on a.id = o.activity_id
    where so.id = v_occ and a.slug = v_expected_slug
  ) then
    raise exception 'occurrence_activity_mismatch';
  end if;

  select a.pricing_mode, (o.private_base_minor is not null)
    into v_mode, v_is_private
  from session_occurrences so
  join activity_options o on o.id = so.activity_option_id
  join activities a on a.id = o.activity_id
  where so.id = v_occ;
  v_qty := case when coalesce(v_mode, 'per_person') in ('vehicle', 'vehicle_custom')
                  or coalesce(v_is_private, false) then 1 else v_people::int end;

  v_hold := create_hold(v_occ, v_qty, v_key);

  -- Stamp ownership for the server-mediated path (see the function comment). Prefer a real JWT
  -- identity when one exists; only ever fill a NULL created_by (idempotent replays keep the original).
  v_uid := coalesce(auth.uid(), nullif(p ->> 'userId', '')::uuid);
  if v_uid is not null and v_hold.created_by is null then
    update booking_holds set created_by = v_uid where id = v_hold.id and created_by is null;
    select * into v_hold from booking_holds where id = v_hold.id;
  end if;

  if v_route is not null and v_hold.custom_itinerary is null then
    update booking_holds set custom_itinerary = v_route
    where id = v_hold.id and custom_itinerary is null;
  end if;

  return jsonb_build_object('holdId', v_hold.id, 'quantity', v_hold.quantity, 'expiresAt', v_hold.expires_at);
end;
$$;

-- `create or replace` preserves the existing ACL, so this is belt-and-braces — but it is restated in
-- full because the lockdown (20260807000000) is what keeps a bot from squatting a hot occurrence's
-- seats by calling this directly with an anon key, and a future replace that forgets it would reopen
-- that quietly. Same three roles as the lockdown named.
revoke execute on function api_create_hold(jsonb) from public, anon, authenticated;
grant execute on function api_create_hold(jsonb) to service_role;

-- What the server needs at pay time to decide whether a route is required and where to get it.
--
-- Returns the occurrence's pricing mode plus any route the hold kept, in ONE round trip. The mode is
-- read from the occurrence rather than trusted from the caller for the usual reason: it decides
-- whether a missing route is fatal, so a client that could assert it could opt out of the check.
create or replace function api_hold_route(p jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'pricingMode', (
      select a.pricing_mode
      from session_occurrences so
      join activity_options o on o.id = so.activity_option_id
      join activities a on a.id = o.activity_id
      where so.id = (p ->> 'occurrenceId')::uuid
    ),
    'itinerary', (
      select h.custom_itinerary
      from booking_holds h
      where h.id = nullif(p ->> 'holdId', '')::uuid
    )
  );
$$;

-- New function, so its grants DO matter: a fresh function is executable by public by default, and
-- this one reads a hold's route. Service-role only, like every other api_* on the booking path.
revoke execute on function api_hold_route(jsonb) from public, anon, authenticated;
grant execute on function api_hold_route(jsonb) to service_role;
