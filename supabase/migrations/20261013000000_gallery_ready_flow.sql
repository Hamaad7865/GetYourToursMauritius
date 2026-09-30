-- 20261013000000_gallery_ready_flow
--
-- The delivery moment for a photography booking. The studio uploads the shoot, then presses
-- "Confirm gallery complete" in /admin/photography: the guest is emailed the link to pay the
-- remaining balance, and once that balance clears they are emailed the link to their private
-- gallery. Three pieces, all keyed off ONE timestamp:
--
--   1. bookings.gallery_ready_at — when the studio confirmed delivery ("Confirm gallery complete",
--      "Send gallery link" or "Request balance" — every staff action that tells the guest their
--      photos are ready stamps it). LOAD-BEARING: until it is set the guest sees no gallery at all
--      (the RLS policy below + the gallery API) and no gallery email goes out. Uploading photos
--      alone never reaches the guest — half a shoot must not be paid for or downloadable.
--      Overwritten on each confirmation, so it reads "last confirmed"; only NULL-ness gates.
--   2. booking_photos_select — re-created so the OWNER reads photos only once the gallery is
--      delivered (gallery_ready_at), paid in full (balance_due_minor <= 0) and the booking is live
--      (confirmed / completed). The files sit in the PUBLIC activity-images bucket, so these ROWS
--      are the only thing that can withhold their URLs: the UI-only lock let an unpaid guest read
--      every URL out of the API response or straight off the table. Staff keep unconditional
--      access. booking_balance_due() cannot be called from a policy (service_role only); the stored
--      bookings.balance_due_minor, maintained by append_payment_event, is what the API reads too.
--   3. notify_balance_paid's settled-in-full branch — a photography booking whose balance just
--      cleared AFTER the studio confirmed the gallery, and that still has photos, gets a
--      'gallery_ready' outbox row, keyed 'gallery_ready:<booking>' so a retried settlement can
--      never double-send. This is the automatic counterpart to the admin confirmation: the guest
--      who just paid their balance is told their photos are waiting, with no staff action. A guest
--      who paid BEFORE the studio confirmed gets no email here — the confirmation itself finds the
--      balance already zero and sends the gallery link directly, so each path mails exactly once.
--      The installment / other branches are byte-identical to 20261001000000.
--
-- The photography test is the same one set_photography_deposit uses, lower-cased:
-- btrim(lower(category)) = 'photography' (isPhotographyCategory in TS). The URL is RELATIVE
-- ('/bookings/<ref>#gallery') — no site origin exists inside the database; the drain renderer
-- absolutises it against the site URL at send time, exactly like every other email template.
--
-- Idempotent throughout (this file is appended verbatim to supabase/catch-up.sql).

alter table bookings add column if not exists gallery_ready_at timestamptz;

-- ── booking_photos_select — the guest reads the gallery only when it is delivered AND paid ────────
-- Replaces the 20261012000000 policy, which admitted the owner unconditionally. Staff branch is
-- unchanged (and booking_photos_staff already grants staff everything). The status guard keeps a
-- cancelled / refunded booking from serving photos even if its balance figure reads zero.
drop policy if exists booking_photos_select on booking_photos;
create policy booking_photos_select on booking_photos for select using (
  exists (
    select 1
      from bookings b
     where b.id = booking_photos.booking_id
       and (
         is_staff()
         or (
           b.user_id = auth.uid()
           and b.gallery_ready_at is not null
           and b.balance_due_minor <= 0
           and b.status in ('confirmed', 'completed')
         )
       )
  )
);

-- ── notify_balance_paid — settled-in-full branch extended with the gallery-ready email ─────────────
-- Re-applied from the 20261001000000 body, unchanged except for the new block at the END of the
-- settled-in-full branch (after the owner_balance_paid insert). The intermediate-installment
-- branch (remaining > 0) and the live-booking guard are untouched. The trigger that calls this
-- (payments_notify_balance_paid, purpose='balance' settling to 'paid') is untouched.
create or replace function notify_balance_paid(p_payment_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_payment payments;
  v_booking bookings;
  v_remaining bigint;
  v_charged bigint;
begin
  select * into v_payment from payments where id = p_payment_id;
  if not found then
    return;
  end if;
  select * into v_booking from bookings where id = v_payment.booking_id;
  if not found then
    return;
  end if;

  -- Only a LIVE booking gets a receipt/invoice. This trigger fires from INSIDE append_payment_event's
  -- `update payments set status='paid'` — BEFORE its status routing — so a balance completing on a
  -- booking that has left 'confirmed' (self-cancelled to refund_pending, then a still-live Peach balance
  -- session lands) must NOT mail a document for money about to be refunded. Mirrors its guard.
  if v_booking.status not in ('confirmed', 'completed') then
    return;
  end if;

  -- FRESH remaining balance — v_booking.balance_due_minor is STALE at this point (see header). The
  -- just-settled payment is already counted (its paid_minor is set), so this is the TRUE amount left.
  v_remaining := booking_balance_due(v_booking.id);

  if v_remaining > 0 then
    -- INTERMEDIATE installment: a running receipt for THIS payment. enrichBookingConfirmation renders a
    -- 'deposit_receipt' against the balance SNAPSHOT carried on the payload (never the live balance, which
    -- a later installment would have lowered), so amountPaid = total − snapshot = paid through this
    -- installment. `installment` flips the wording from "deposit" to "payment". Keyed per PAYMENT so every
    -- installment gets one; a DIFFERENT key namespace from the confirmation-time deposit_receipt:<booking>.
    -- Snapshot the cumulative CHARGE at this same instant, so a receipt that drains AFTER a later
    -- installment settled still shows a "charged" figure (and the MUR fx rate derived from it) consistent
    -- with its Amount paid / Balance due — api_booking_receipt otherwise sums charged LIVE at drain, which
    -- would then contradict the snapshotted balance. Same charge currency only (a legacy EUR row and an
    -- MUR row never add), mirroring api_booking_receipt.
    select coalesce(sum(coalesce(pay.charged_amount_minor, pay.amount_minor)), 0)
      into v_charged
      from payments pay
     where pay.booking_id = v_booking.id
       and pay.purpose in ('booking', 'balance')
       and pay.paid_minor > 0
       and coalesce(pay.charged_currency, pay.currency)
             is not distinct from coalesce(v_payment.charged_currency, v_payment.currency);

    if v_booking.customer_email is not null then
      insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
      values (
        'email', v_booking.customer_email, 'deposit_receipt',
        jsonb_build_object(
          'ref', v_booking.ref, 'customerName', v_booking.customer_name,
          'totalMinor', v_booking.total_minor, 'currency', v_booking.currency,
          'balanceDueMinor', v_remaining, 'chargedAmountMinor', v_charged, 'installment', true
        ),
        v_booking.id, 'installment_receipt:' || v_payment.id
      )
      on conflict (idempotency_key) do nothing;
    end if;
    return;
  end if;

  -- SETTLED IN FULL: the full VAT invoice, keyed per booking so it fires exactly once — on the LAST
  -- payment now, not the first. enrichBookingConfirmation loads it fresh (balance_due_minor = 0 by now)
  -- and renders PAID for the full total.
  if v_booking.customer_email is not null then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', v_booking.customer_email, 'booking_confirmation',
      jsonb_build_object(
        'ref', v_booking.ref, 'customerName', v_booking.customer_name,
        'totalMinor', v_booking.total_minor, 'currency', v_booking.currency
      ),
      v_booking.id, 'booking_confirmation:' || v_booking.id
    )
    on conflict (idempotency_key) do nothing;
  end if;

  -- Owner: EMAIL ONLY on purpose (see header). One glance: the balance on this booking has now been paid.
  insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
  values (
    'email', 'owner', 'owner_balance_paid',
    jsonb_build_object(
      'ref', v_booking.ref, 'customerName', v_booking.customer_name,
      'totalMinor', v_booking.total_minor, 'currency', v_booking.currency
    ),
    v_booking.id, 'owner_balance_paid:' || v_booking.id
  )
  on conflict (idempotency_key) do nothing;

  -- GALLERY-READY: the settled-in-full moment is also the delivery moment for a photography booking.
  -- When the booking is a photography package (the same category test as set_photography_deposit,
  -- lower-cased), the studio has CONFIRMED the gallery complete (gallery_ready_at — merely having
  -- photos uploaded is not enough: a guest who pays mid-upload must not be told, or shown, half a
  -- shoot) and at least one photo is still there, the guest gets the 'gallery_ready' email pointing
  -- at their private gallery — they just paid, so this fires with no staff action. Keyed per booking
  -- so a retried or re-run settlement can never double-send. A guest who paid BEFORE the
  -- confirmation is covered by the confirmation itself (it sees a zero balance and sends the
  -- gallery link directly), so nothing is missed and nothing is sent twice. The one gap is a
  -- confirmation committing in the sub-second window between this trigger reading the booking and
  -- the settlement updating it: the guest is then sent the balance email, not the gallery link (the
  -- gallery itself is open, and the admin card's "Resend gallery link" sends the email).
  if v_booking.customer_email is not null
     and v_booking.gallery_ready_at is not null
     and exists (
       select 1
         from booking_items bi
         join activity_options ao on ao.id = bi.activity_option_id
         join activities a on a.id = ao.activity_id
        where bi.booking_id = v_booking.id
          and btrim(lower(a.category)) = 'photography'
     )
     and exists (select 1 from booking_photos bp where bp.booking_id = v_booking.id)
  then
    insert into notification_outbox (channel, recipient, template, payload, booking_id, idempotency_key)
    values (
      'email', v_booking.customer_email, 'gallery_ready',
      jsonb_build_object(
        'ref', v_booking.ref, 'customerName', v_booking.customer_name,
        'packageTitle', (
          select a.title
            from booking_items bi
            join activity_options ao on ao.id = bi.activity_option_id
            join activities a on a.id = ao.activity_id
           where bi.booking_id = v_booking.id
             and btrim(lower(a.category)) = 'photography'
           order by bi.created_at
           limit 1
        ),
        'photoCount', (select count(*) from booking_photos where booking_id = v_booking.id),
        'locale', v_booking.locale,
        'galleryUrl', '/bookings/' || v_booking.ref || '#gallery'
      ),
      v_booking.id, 'gallery_ready:' || v_booking.id
    )
    on conflict (idempotency_key) do nothing;
  end if;
end;
$$;

revoke execute on function notify_balance_paid(uuid) from public, anon, authenticated;
grant execute on function notify_balance_paid(uuid) to service_role;
