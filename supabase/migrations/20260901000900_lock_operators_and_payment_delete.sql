-- Close two privilege holes on the money path. Both were VERIFIED against production before writing
-- this, and the first was proven end-to-end with nothing but the public anon key:
--
--   GET /rest/v1/operators?select=name,contact_email,phone,payout_details   →   200
--   [{"name":"Belle Mare Tours","contact_email":null,"phone":"…","payout_details":{}}]
--
-- 1) OPERATORS WAS WORLD-READABLE. `anon` holds a table SELECT grant and the `operators_read` policy
--    was `using (true)`, so every anonymous visitor could read the operator row — including
--    payout_details, contact_email and phone. Nothing sensitive was exposed on the day this shipped
--    (payout_details was '{}', contact_email null, the phone already public on the site), so this is
--    a LATENT leak, not an active one: the moment the owner enters real payout/bank details in
--    /admin they become world-readable to anyone holding the key that ships in the client bundle.
--
--    Fix: revoke the anon grant outright, and drop the permissive read policy so the remaining
--    `operators_staff` policy (is_staff()) governs. That also closes the quieter half of the hole —
--    any signed-in CUSTOMER could read the same columns.
--
--    Why `authenticated` keeps its table grant: src/lib/admin/activity-write.ts:170 reads
--    operators.id through the BROWSER client (i.e. as the staff user, not service_role) when creating
--    an activity. Revoking the grant would break admin. RLS now carries the restriction instead —
--    staff pass is_staff(), everyone else matches no policy and sees zero rows.
--
--    The public catalogue is unaffected: it is served by security-definer functions, which run as the
--    owner and never consult these grants.
--
-- 2) A STAFF JWT COULD DELETE PAYMENTS — AND THE LEDGER WITH THEM. `authenticated` held DELETE on
--    payments, `payments_staff` is `for all using (is_staff())`, and payment_events → payments is
--    ON DELETE CASCADE. So one staff account could erase a payment and silently take every
--    payment_event with it: the audit trail of who paid what. (Verified by privilege + policy + the
--    'c' confdeltype, NOT by executing it — proving it would have destroyed a real payment record.)
--
--    Fix: revoke DELETE from authenticated. Refunds and cancellations already go through
--    security-definer RPCs (api_mark_refunded, api_cancel_booking), none of which DELETE a payment —
--    the ledger is append-only by design and nothing in the app deletes from it.
--
-- service_role is untouched throughout: the webhook, the reconcile sweep and the cron all run as
-- service_role and must keep working.

-- ── 1) operators ────────────────────────────────────────────────────────────────────────────────
revoke select on operators from anon;

-- Idempotent: dropping the permissive policy leaves `operators_staff` (for all using is_staff()) as
-- the only policy, so a non-staff session matches nothing and reads zero rows.
drop policy if exists operators_read on operators;

comment on table operators is
  'Operator record. NOT publicly readable: payout_details/contact_email/phone live here. anon has no '
  'grant; authenticated keeps the grant only because the admin UI reads operators.id through the '
  'browser client, and is_staff() in the operators_staff policy is what actually gates the rows.';

-- ── 2) payments ─────────────────────────────────────────────────────────────────────────────────
-- The ledger is append-only. Nothing in the app deletes a payment; the only thing this grant enabled
-- was destroying the audit trail via the ON DELETE CASCADE to payment_events.
revoke delete on payments from authenticated;

comment on column payments.paid_minor is
  'Ledger credit in EUR minor units. The payments row is APPEND-ONLY: DELETE is revoked from '
  'authenticated because payment_events cascades from it, so deleting a payment would erase the '
  'record of what the customer paid.';
