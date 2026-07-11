-- 20260806000000_security_lockdown
-- Security lockdown + two alert/erase ordering fixes.
--  1. api_cancel_booking: enqueue the tailored owner cancellation alert BEFORE the status flip so
--     the refund_pending trigger's skip-guard sees it (kills the self-cancel double-alert).
--  2. api_erase_user: capture the person's booking ids before the anonymize rewrites customer_email,
--     then scrub outbox/bell/audit by id (guest bookings matched only by email were being missed).
--  3. Revoke anon/authenticated execute on the public mutation RPCs (the anon key could call them
--     through PostgREST and bypass the route rate-limiter); drop the open leads_insert policy.
-- Re-run supabase/catch-up.sql after applying (idempotent).

-- api_cancel_booking: queue the tailored owner cancellation alert BEFORE flipping the status. The
-- status flip fires enqueue_booking_notification's refund_pending branch, whose skip-guard only
-- suppresses the generic refund trio when a 'booking_cancellation' outbox row already exists -- so the
-- insert must precede the update, otherwise every customer self-cancel double-alerts the owner (generic
-- refund trio + this tailored mail). Body otherwise unchanged.
create or replace function api_cancel_booking(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ref text := nullif(p ->> 'ref', '');
  v_uid uuid := auth.uid();
  v_booking bookings;
  v_starts_at timestamptz;
begin
  if v_ref is null then
    raise exception 'invalid_request' using detail = 'cancel: ref required';
  end if;

  select * into v_booking from bookings where ref = v_ref;
  if not found then
    raise exception 'booking_not_found';
  end if;

  -- Ownership: the booking's own customer, or staff. (A definer function bypasses RLS -- check here.)
  if not (is_staff() or (v_uid is not null and v_booking.user_id = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Idempotent: already cancelled / refund in flight / refunded -> return current state, no re-enqueue.
  if v_booking.status in ('refund_pending', 'cancelled', 'refunded') then
    return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', v_booking.status, 'alreadyCancelled', true);
  end if;

  -- Only a confirmed, paid booking can be self-cancelled for a refund.
  if not (v_booking.status = 'confirmed' and v_booking.payment_state = 'paid') then
    raise exception 'not_cancellable'
      using detail = format('booking %s / payment %s', v_booking.status, v_booking.payment_state);
  end if;

  -- The 24-hour window: the EARLIEST occurrence on this booking must start more than 24h from now.
  select min(so.starts_at) into v_starts_at
    from booking_items bi
    join session_occurrences so on so.id = bi.session_occurrence_id
   where bi.booking_id = v_booking.id;
  if v_starts_at is null or v_starts_at <= now() + interval '24 hours' then
    raise exception 'cancellation_window_passed'
      using detail = 'self-service cancellation closes 24 hours before the activity';
  end if;

  -- Heads-up to the owner to process the refund (best-effort; the admin refund_pending queue is the
  -- authoritative work-list). Enqueued BEFORE the status flip so the refund_pending trigger sees this
  -- row and skips its generic trio (no double-alert). The idempotency key stops a double-cancel
  -- enqueuing twice.
  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', 'owner', 'booking_cancellation',
    jsonb_build_object(
      'ref', v_booking.ref, 'customerName', v_booking.customer_name,
      'totalMinor', v_booking.total_minor, 'currency', v_booking.currency
    ),
    v_booking.id, 'booking_cancellation:' || v_booking.id
  )
  on conflict (idempotency_key) do nothing;

  -- Cancel -> refund_pending (refund_pending frees used_capacity, so the seat is resellable at once). The
  -- actual money movement is recorded later through api_mark_refunded -> append_payment_event.
  update bookings set status = 'refund_pending', updated_at = now() where id = v_booking.id;

  return jsonb_build_object('ok', true, 'ref', v_booking.ref, 'status', 'refund_pending');
end;
$$;

-- api_erase_user: capture the person's booking ids BEFORE the anonymize rewrites customer_email to the
-- sentinel. The outbox/bell/audit scrubs that follow match "this person's bookings"; if they re-derived
-- that set AFTER the rewrite, a guest booking matched only by email (user_id null) would fall out of
-- scope and retain the customer's name in queued payloads, staff bell rows, and audit diffs. Fix: match
-- those three scrubs against the pre-captured id array instead of re-selecting by the now-sentinel email.
create or replace function api_erase_user(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := nullif(p ->> 'userId', '')::uuid;
  v_email text := lower(nullif(btrim(p ->> 'email'), ''));
  -- Non-paid booking statuses that are safe to hard-delete (only ever combined with payment_state pending).
  v_del_states text[] := array['draft', 'held', 'payment_pending', 'expired', 'cancelled', 'failed'];
  -- Paid / terminal statuses that must be retained (financial records) and only anonymized.
  v_anon_states text[] := array['confirmed', 'completed', 'refund_pending', 'refunded'];
  v_del_ids uuid[];
  v_anon_ids uuid[];
  v_del_bookings int := 0;
  v_anon_bookings int := 0;
  v_del_leads int := 0;
begin
  -- Guard: staff, or the signed-in user erasing their own account.
  if not (is_staff() or (auth.uid() is not null and v_uid is not null and auth.uid() = v_uid)) then
    raise exception 'forbidden';
  end if;

  -- Bind the email scope to the CALLER'S identity for a non-staff self-erase. The caller-supplied email
  -- is untrusted: a signed-in user could pass a stranger's address and, because the row scope matches on
  -- lower(customer_email) = v_email, sweep that stranger's GUEST bookings/leads (user_id null) -- broken
  -- access control. So for non-staff we IGNORE the supplied email and force v_email to the caller's own
  -- JWT identity, read from auth.users (the SECURITY DEFINER owner can see it; auth.email() is not
  -- relied on here). This still catches the user's own pre-account guest bookings (made under their own
  -- email before they had an account), while making a stranger's email unreachable. Staff keep the
  -- supplied email -- they legitimately erase a pure-guest record by its address.
  if not is_staff() then
    select lower(email) into v_email from auth.users where id = auth.uid();
  end if;

  if v_uid is null and v_email is null then
    raise exception 'invalid_request' using detail = 'erase_user: userId or email required';
  end if;

  -- ---- Hard-delete the non-retained (unpaid/abandoned) bookings + their children -------------------
  -- Identify them first; a booking matches by ownership OR guest email, must be in a deletable status
  -- AND have never carried money (payment_state pending). Anything paid is excluded here on purpose.
  select array_agg(id) into v_del_ids
    from bookings
   where ((v_uid is not null and user_id = v_uid)
          or (v_email is not null and lower(customer_email) = v_email))
     and status = any(v_del_states::booking_status[])
     and payment_state = 'pending';

  if v_del_ids is not null then
    -- FK order: holds (FK on delete set null, so delete explicitly) + items (cascades, but be explicit),
    -- then the parent bookings. payments cannot exist on a pending booking, so none to clear here.
    delete from booking_holds where booking_id = any(v_del_ids);
    delete from booking_items where booking_id = any(v_del_ids);
    delete from bookings where id = any(v_del_ids);
    get diagnostics v_del_bookings = row_count;
  end if;

  -- Snapshot the person's REMAINING booking ids now, before the anonymize below overwrites
  -- customer_email. The unpaid rows are already gone, so this is exactly the retained set; the
  -- outbox/bell/audit scrubs downstream target it by id so an email-only (guest) match is not lost.
  select coalesce(array_agg(id), '{}') into v_anon_ids
    from bookings
   where (v_uid is not null and user_id = v_uid)
      or (v_email is not null and lower(customer_email) = v_email);

  -- ---- Anonymize the retained (paid/terminal) bookings --------------------------------------------
  -- Keep the row + every financial column (total_minor, payouts, payment_state, status); strip the PII.
  -- customer_name + customer_email are NOT NULL in the schema, so they are redacted to placeholders
  -- (a routed-nowhere .invalid sentinel) rather than nulled. customer_phone + notes are nullable -> null.
  -- This is an UPDATE that does NOT touch status, so the status-only enqueue trigger never re-fires.
  update bookings
     set customer_name = '(Deleted user)',
         customer_email = 'deleted@privacy.invalid',
         customer_phone = null,
         notes = null,
         traveller_gender = null,
         traveller_company = null,
         traveller_country = null,
         special_notes = null,
         room_or_cabin = null,
         luggage_details = null,
         child_seat_age = null,
         flight_number = null,
         arrival_time = null,
         return_date = null,
         return_time = null,
         departure_flight_number = null
   where ((v_uid is not null and user_id = v_uid)
          or (v_email is not null and lower(customer_email) = v_email))
     and status = any(v_anon_states::booking_status[])
     -- idempotent: skip rows already anonymized (so a second call updates 0 rows, never re-counts).
     and customer_name is distinct from '(Deleted user)';
  get diagnostics v_anon_bookings = row_count;

  -- ---- Redact the notification outbox -------------------------------------------------------------
  -- Strip recipient (the email) + the customerName key from any queued/sent message for this person,
  -- matched by the recipient address OR by linkage to one of their (still-existing, anonymized) bookings.
  -- recipient is NOT NULL in the schema, so it is redacted to the sentinel rather than nulled. Removing
  -- customerName from the payload (jsonb - key) is a no-op when the key is already absent -> idempotent.
  update notification_outbox
     set recipient = 'deleted@privacy.invalid',
         payload = payload - 'customerName'
   where v_email is not null and lower(recipient) = v_email;
  -- Booking-linked rows keep their RECIPIENT -- they may address the OWNER (the 'owner' sentinel or
  -- the ops inbox), and severing that address would silently kill a pending owner alert for a real
  -- paid booking. Only the person's name leaves the payload. Matched by the pre-captured id set.
  update notification_outbox
     set payload = payload - 'customerName'
   where booking_id = any(v_anon_ids);
  -- Staff bell rows (admin_new_booking / admin_refund_pending) embed the customer's name in `body` --
  -- rebuild them anonymously so no feed retains PII after erasure.
  update notifications n
     set body = '(Deleted user) -- booking ' || coalesce(n.data ->> 'ref', '') || '.'
   where n.type in ('admin_new_booking', 'admin_refund_pending')
     and n.data ->> 'bookingId' = any(v_anon_ids::text[]);

  -- ---- Redact audit_logs diffs that captured this person's PII ------------------------------------
  -- Older admin actions may have snapshotted customer fields into diff. Null the diff on rows whose
  -- entity is one of their bookings (the anonymized financial rows). Counts only; we keep the action row.
  update audit_logs
     set diff = null
   where diff is not null
     and entity_type = 'booking'
     and entity_id = any(v_anon_ids);

  -- ---- Hard-delete the remaining personal data ----------------------------------------------------
  -- leads: PII lives in (name, contact); contact holds the email/phone. Delete by email match.
  if v_email is not null then
    delete from leads where lower(contact) = v_email;
    get diagnostics v_del_leads = row_count;
  end if;

  -- chat: messages cascade from sessions, but delete explicitly for clarity. By user only (no email link).
  if v_uid is not null then
    delete from chat_messages where session_id in (select id from chat_sessions where user_id = v_uid);
    delete from chat_sessions where user_id = v_uid;
    -- profile last (auth.users row itself is removed by the caller's service-role admin.deleteUser).
    delete from profiles where id = v_uid;
  end if;

  -- ---- One audit row, counts only (NO PII) -------------------------------------------------------
  insert into audit_logs (actor_id, actor_role, action, entity_type, entity_id, summary)
  values (
    auth.uid(),
    case when is_staff() then 'staff' else 'user' end,
    'erase_user',
    'user',
    v_uid,
    'gdpr erasure: deleted ' || v_del_bookings || ' booking(s), ' || v_del_leads
      || ' lead(s); anonymized ' || v_anon_bookings || ' retained booking(s)'
  );

  return jsonb_build_object(
    'ok', true,
    'deletedBookings', v_del_bookings,
    'anonymizedBookings', v_anon_bookings,
    'deletedLeads', v_del_leads
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Public mutation lockdown. The Next API routes are the intended throttle / anti-bot boundary, but
-- Supabase's default privileges hand every public-schema function a DIRECT execute grant to `anon`, so a
-- bot with the public anon key could call these mutation RPCs straight through PostgREST and bypass the
-- per-IP route limiter (seat-squatting, abandoned-booking / lead floods). Revoke anon/authenticated on
-- the spam-prone mutations; the server now calls them through a service-role client (see
-- src/lib/http/context.ts serviceRoleRpcContext, the holds + leads routes, and enforceRateLimit).
-- NOTE: `revoke ... from public` is NOT sufficient on stock Supabase -- the ALTER DEFAULT PRIVILEGES
-- direct anon grant survives it -- so anon/authenticated are named explicitly.
-- ---------------------------------------------------------------------------

-- Identity-free, now called by the server via a service-role client -> service_role only.
revoke execute on function api_rate_limit(jsonb) from anon, authenticated;
revoke execute on function api_create_hold(jsonb) from anon, authenticated;
revoke execute on function create_hold(uuid, int, text) from anon, authenticated;
revoke execute on function api_capture_lead(jsonb) from anon, authenticated;
-- create_booking is internal: only api_book calls it (as its definer owner), so no external role needs it.
revoke execute on function create_booking(text, uuid, text, text, text, booking_source, jsonb, boolean)
  from anon, authenticated;

-- api_book + api_create_payment stay callable by AUTHENTICATED (the checkout forces sign-in before
-- booking or pay, and both re-check booking ownership in-body), but never by anon.
revoke execute on function api_book(jsonb) from anon;
revoke execute on function api_create_payment(jsonb) from anon;

-- Defence in depth on the owner/staff-guarded writers flagged as relying on body checks alone. They keep
-- `authenticated` for the staff browser client; the in-body is_staff()/owner guard is the real gate --
-- this just strips the stray anon/PUBLIC grant.
revoke execute on function api_record_payment_charge(jsonb) from anon, public;
revoke execute on function api_reorder_activities(jsonb) from anon, public;

-- Direct lead spam: a baseline `leads_insert ... with check (true)` policy let the anon key INSERT into
-- `leads` straight past api_capture_lead's honeypot + per-IP limit. Every legitimate write goes through
-- the SECURITY DEFINER api_capture_lead (which runs as the table owner, unaffected by this), so drop the
-- open policy and revoke the table grant.
drop policy if exists leads_insert on leads;
revoke insert on leads from anon, authenticated;
