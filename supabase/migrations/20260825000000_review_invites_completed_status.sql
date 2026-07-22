-- Follow-up to 20260822000000_guest_reviews.sql: api_enqueue_review_invites() filtered candidate
-- bookings with `b.status = 'confirmed'` only, which silently excludes bookings the owner has since
-- marked 'completed' (AdminBookings.tsx "Mark as completed" action / filter tab) — invites are
-- one-shot (unique per booking_id, no retry path), so a booking completed before the sweep runs would
-- NEVER get a review-request email. Align with the sibling per-activity RPC, api_submit_review
-- (20260742000000_reviews.sql), which already accepts `b.status in ('confirmed', 'completed')` as
-- "the trip has definitely happened". Full body carried forward verbatim from
-- 20260822000000_guest_reviews.sql — see the migration-revert-drift lesson — with only the status
-- filter changed.
create or replace function api_enqueue_review_invites()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_candidate record;
  v_token text;
  v_inserted int;
begin
  if auth.role() <> 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  for v_candidate in (
    with last_occurrence as (
      select bi.booking_id, so.ends_at, ao.activity_id,
             row_number() over (partition by bi.booking_id order by so.ends_at desc) as rn
      from booking_items bi
      join session_occurrences so on so.id = bi.session_occurrence_id
      join activity_options ao on ao.id = bi.activity_option_id
    )
    select b.id as booking_id, b.customer_email, b.customer_name,
           a.id as activity_id, a.title as activity_title, lo.ends_at
    from bookings b
    join last_occurrence lo on lo.booking_id = b.id and lo.rn = 1
    join activities a on a.id = lo.activity_id
    where b.status in ('confirmed', 'completed')
      and b.customer_email is not null
      and not exists (select 1 from review_invites ri where ri.booking_id = b.id)
      and ((lo.ends_at at time zone 'Indian/Mauritius')::date + 1 + time '09:00')
            at time zone 'Indian/Mauritius' <= now()
  )
  loop
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');

    insert into review_invites (booking_id, activity_id, token)
    values (v_candidate.booking_id, v_candidate.activity_id, v_token)
    on conflict (booking_id) do nothing;

    -- A concurrent run may have already created this invite (or a duplicate cron tick, if the
    -- previous run overlapped) — skip the matching notification too, so we never send a review
    -- request pointing at a token nobody actually created.
    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      continue;
    end if;

    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', v_candidate.customer_email, 'review_request',
      jsonb_build_object(
        'token', v_token,
        'activityTitle', v_candidate.activity_title,
        'customerName', v_candidate.customer_name
      ),
      v_candidate.booking_id,
      'review_request:' || v_candidate.booking_id
    )
    on conflict (idempotency_key) do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function api_enqueue_review_invites() from public, anon, authenticated;
grant execute on function api_enqueue_review_invites() to service_role;
