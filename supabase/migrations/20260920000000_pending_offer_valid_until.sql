-- A quote booking's cart row shows the OFFER's deadline instead of a countdown that never ran.
--
-- The cart's "Awaiting payment" row renders a mm:ss countdown off `holdExpiresAt`. That is the right
-- deadline for a web booking — the 30-minute hold on its seats — but a QUOTE booking has no hold at
-- all: api_convert_quote mints it straight from the quote's lines and never calls create_hold,
-- because a custom line reserves no capacity ("Holds nothing — a free-text line reserves no
-- capacity"). Measured in production: all 24 `web` bookings have a hold row, all 3 `quote` bookings
-- have none.
--
-- So `holdExpiresAt` came back null, the client's `Number.isFinite(NaN)` fallback floored the
-- remaining seconds at 0, and the guest was told "Pay within 00:00" on an offer with three weeks
-- left to run. Nothing was expiring; there was simply no deadline of that kind to show.
--
-- A quote does have a real deadline — `quotes.valid_until`, the date already printed on the offer
-- email and the quote page — so this returns it and the row states that instead.
--
-- DRIFT RULE (see 20260915000000 / 20260916000000, [[gytm-migration-revert-drift]]): the body below
-- is 20260733000001's WINNING body re-applied VERBATIM apart from one join and one key. Re-applying
-- a stale body is how an earlier fix gets silently reverted.
--
-- WHAT IS DELIBERATELY NOT EXPOSED: only the date. `quotes` also holds the link token hash and the
-- guest's email, and this function is `security definer` (so the join bypasses RLS). It stays scoped
-- by `b.user_id = v_uid` exactly as before — the join adds a date to rows the caller could already
-- read, and nothing else.

begin;

create or replace function api_my_pending_bookings(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(t.row order by t.created_at desc), '[]'::jsonb) into v_rows
  from (
    select
      jsonb_build_object(
        'ref', b.ref,
        'status', b.status,
        'paymentState', b.payment_state,
        'totalMinor', b.total_minor,
        'currency', b.currency,
        'createdAt', b.created_at,
        'holdExpiresAt', h.expires_at,
        -- CHANGE 2 of 2: the offer's own deadline. Null for every non-quote booking, which is what
        -- tells the cart to keep showing the seat-hold countdown for those.
        'offerValidUntil', q.valid_until,
        'title', coalesce(a.title, 'Your booking'),
        'startsAt', occ.starts_at
      ) as row,
      b.created_at
    from bookings b
    left join lateral (
      select bh.expires_at from booking_holds bh
      where bh.booking_id = b.id and bh.status = 'active'
      order by bh.expires_at desc
      limit 1
    ) h on true
    -- CHANGE 1 of 2: the quote this booking was converted from, if any. `quotes.booking_id` is
    -- UNIQUE (it is the schema-level half of "one quote never mints two bookings"), so this can
    -- never fan a booking out into duplicate rows.
    left join quotes q on q.booking_id = b.id
    left join lateral (
      select bi.session_occurrence_id, bi.activity_option_id from booking_items bi
      where bi.booking_id = b.id
      order by bi.created_at
      limit 1
    ) item on true
    left join session_occurrences occ on occ.id = item.session_occurrence_id
    left join activity_options ao on ao.id = item.activity_option_id
    left join activities a on a.id = ao.activity_id
    where b.user_id = v_uid
      and b.status = 'payment_pending'
      and b.payment_state = 'pending'
  ) t;
  return v_rows;
end;
$$;

revoke execute on function api_my_pending_bookings(jsonb) from public;
grant execute on function api_my_pending_bookings(jsonb) to authenticated;

commit;
