# Pre-Launch Bug Report — GetYourToursMauritius (Round 2)

> Generated 2026-06-20 by a second multi-agent read-only sweep (recon + 15 hunters → adversarial
> verification against current HEAD → completeness critic + synthesis). 27 raw → **8 confirmed**, 0 false
> positives, 19 P2. Run after the 9 P0/P1 fixes + the invoice/receipt email + cookie consent.

## 1. GO / NO-GO

**NO-GO until P0-1 is fixed.** Deploy gate green (`tsc` clean, `eslint` clean, `next build` succeeds, 456
vitest pass — the one "failed" suite is a Windows-only PGlite file-handle race, 3/3 on isolated re-run; run
vitest single-threaded in CI for a green exit). The codebase is in genuinely good shape: RLS is sound across
every admin/customer table, the payment-confirmation invariant holds (webhook → `append_payment_event`
only), oversell is guarded, and the recent duplicate-booking / fail-closed-notifications / rate-limiter work
is solid. **But one real money bug remains (P0-1):** a customer who abandons payment and re-books the same
date with a different party/options is charged for the OLD selection while the UI shows the NEW price.

## 2. P0 — LAUNCH BLOCKER

### P0-1 · Re-checkout of the same date with a changed party/options charges the OLD booking while showing the NEW price

**Files:** `src/components/checkout/Checkout.tsx` (readBooking 121-130, rehydrate 207-210, pay() 299-394), `src/components/gyg/detail/BookingProvider.tsx:333`
The duplicate-booking fix persists `{idemKey, bookingRef}` in `gytm:booking:${occ}` **keyed by occurrence
only** — not party/label/childSeats/pickup. The occurrence id is party-independent (derived from date+option).
On re-checkout of the same date with a different party, `bookingRef` rehydrates the stale ref; `pay()`'s
`if (!ref)` is skipped — **including the price-reconciliation gate** — and it POSTs payment for the OLD ref
while the summary shows the NEW total. The customer is charged the old amount and gets the old booking; the
new hold leaks. Self-heals only if the prior booking was already PAID (`booking_not_payable`); the damage
window is the unpaid-abandon → re-book-different-config case (common).
**Fix:** scope the persisted identity to the full price-relevant selection (hash of label/qty/suv/childSeats/
pickup/dropoff/itinerary/total), and only rehydrate `bookingRef` when the hash matches the current selection;
else mint a fresh `idemKey` + create a new booking. Belt-and-braces: gate `readBooking()` on
`(fromWidget || fromCart)` like `readHold()`, AND re-run the price-reconciliation compare even on the
rehydrated-ref path before POSTing payment. Add a test (abandon party=2, re-enter party=4 same occ → new ref,
charge == party-4 total).

## 3. P1 — FIX BEFORE LAUNCH

### P1-1 · `refund_pending` is a dead-end — no code issues the Peach refund or clears it

`supabase/catch-up.sql:2406` (admin cancel → `refund_pending`), only path to `refunded` is a `refunded`
provider webhook event (`reconcile.ts:50`). A manual admin cancel is a pure DB flip — Peach never hears about
it, so the booking sits in `refund_pending` forever and the customer never gets the `booking_refunded` email.
**Fix:** decide the process — confirm whether Peach emits a refund webhook for dashboard-issued refunds; if
not, add an admin "Mark refunded" action calling a service-role RPC that writes a `refunded` payment event
(so the ledger + email fire). Needs an owner decision before the first paid cancellation.

### P1-2 · Invoice PDF + confirmation email print trip time in UTC, not Mauritius (4h wrong)

`src/lib/invoice/pdf.ts:61-70,184` + `src/lib/email/booking-confirmation.ts:37-44,84` format `when` with raw
UTC accessors + a hardcoded "UTC" label. Occurrences are stored at noon Mauritius (08:00 UTC), so a noon tour
prints `08:00 UTC` on the tax invoice PDF + the confirmation email; a 00:00–03:59 MUT occurrence prints the
date one day early. Admin surfaces format with `timeZone:'Indian/Mauritius'` correctly — only these two don't.
**Fix:** `Intl.DateTimeFormat('en-GB',{ timeZone:'Indian/Mauritius', …, hour12:false })` + ` MUT` in both
`formatWhen`/`formatDate`. Add a test (08:00Z → `12:00 MUT`).

### P1-3 · `api_record_payment_charge` — unguarded SECURITY DEFINER writer (authenticated IDOR write)

`supabase/catch-up.sql:4424-4448` + `supabase/migrations/20260723000000_payment_charge.sql`. Granted to
`authenticated`, SECURITY DEFINER, updates `payments.charged_amount_minor/currency` by `paymentId` with **no
owner/staff check** — bypasses RLS + the `forbid_public_write` trigger. A signed-in user can falsify the PAID
amount/currency on any booking's tax invoice/receipt (needs a leaked payment UUID to target another). No money
moves, no PII read → P1, but a broken-access-control write to financial records.
**Fix:** add a guard (`is_staff()` OR the payment's booking `user_id = auth.uid()`) in BOTH the migration and
catch-up.sql; or revoke the `authenticated` grant (service_role only — its sole caller runs right after
`api_create_payment`). Also: never overwrite an already-recorded charge (fixes the P2 FX-drift below).

### P1-4 · Drain re-sends duplicate invoice emails on a transient failure (no Resend Idempotency-Key)

`src/lib/services/notifications.ts:123-130` + `src/lib/notifications/resend.ts:63-70`. `send()` then
`mark_notification('sent')`; if the edge worker dies between them (CPU/wall-time limit mid-batch — each
message does loadBooking + buildInvoice + PDF + base64 + fetch), the row re-claims after the lease and
re-sends. Resend POST sets no `Idempotency-Key`, so the customer gets a 2nd identical invoice email (up to 4×).
**Fix:** set `Idempotency-Key: notif:${message.id}` on the Resend POST (the id is already on the message).

### P1-5 · "Complete payment" on the confirmation page is a dead end

`BookingConfirmation.tsx:341-346` links to `/bookings/${ref}/pay` with no `cid`; the pay page only mounts the
widget when `cid` exists, and only `POST /api/v1/payments` creates one (never the pay page). A returning
customer (email link / new tab, sessionStorage gone) has no working way to pay an unpaid booking.
**Fix:** make the re-pay control `POST /api/v1/payments` then redirect to `/bookings/{ref}/pay?cid=…`; add a
"Pay now" affordance to AccountBookings for `payment_pending`.

### P1-6 · CookieNotice z-40 bottom bar covers the mobile sticky CTAs

`src/components/site/CookieNotice.tsx:42` is `fixed bottom-0 z-40`; the mobile Pay/Proceed/Book bars are also
`z-40`, so a first-time mobile visitor sees the cookie bar paint over the primary CTA until they Accept. Also
missing `pb-[env(safe-area-inset-bottom)]`.
**Fix:** `z-40` → `z-30` (below the CTA bars) + add the safe-area inset; verify on a device.

## 4. P2 / POST-LAUNCH

- **FX-drift receipt mismatch** — `createPaymentLink` overwrites the charge with a fresh FX rate + mints a new
  checkout on every POST; paying an older checkout makes the PAID-USD a few dollars off the card (EUR correct).
  Fix with P1-3 (don't overwrite a recorded charge).
- **Cron `SITE_URL` hardcoded** in `workers/cron/wrangler.toml` — an origin mismatch sends jobs to the wrong
  host (no emails/sweeps). Verify it equals the live origin exactly.
- **Cron swallows persistent 401/503 silently** — an `INTERNAL_TASK_SECRET` mismatch halts emails+maintenance
  with no signal; `.dev.vars.example` omits the secret. Add a healthcheck/alert.
- **i18n dates** hardcoded `en-GB` (FR users see English months); LangCurrencyModal tabs + `/checkout` Suspense
  fallback hardcoded English.
- **Brand-name inconsistency** — `site.ts` `GetYourToursMauritius` vs visible "Belle Mare Tours". Pick one.
- **Unbounded lat/lng** (accept Infinity) in planner/booking validation; `ip` not length-capped before insert.
- **`/api/planner/from-tour`** unthrottled (billed Places per stop); **`/api/planner/photo`** not wrapped in
  `apiHandler` (raw 500).
- **No account-deletion / data-erasure path** (GDPR — see §6).

## 5. UNCERTAIN — NEEDS YOUR EYES

- **P1-1 refund leg:** does Peach emit a refund webhook for **dashboard-issued** refunds your status-requery
  would catch? If yes, the gap is just the missing email + temporary stuck state; if no, you need the "Mark
  refunded" action before launch. (Cannot resolve from code — depends on Peach + your process.)
- **Cron `SITE_URL` value:** confirm the configured origin equals the live customer origin exactly.

## 6. COVERAGE & RESIDUAL RISK

**Audited & SOUND:** admin/customer direct-table RLS (every admin table `*_staff` gated by `is_staff()`; the
`bookings` column-pinning trigger + `forbid_public_write`; AccountProfile pinned to `auth.uid()`); a Google
Maps outage does NOT block checkout (the address inputs render unconditionally); the payment-confirmation
invariant + oversell guard + the `booking_not_payable` guard (still allows the first payment).
**Gaps / no tests:** **GDPR** — no account-deletion/erasure path anywhere; guest PII + `leads.ip` + emailed
invoice PDFs retained indefinitely (compliance gap, not a code bug — confirm a policy + erasure process).
**Accessibility** — no a11y pass on checkout/auth modals or the cookie bar focus order. **Peach-outage hold
behaviour** — each failed `/v2/checkout` leaves a 30-min hold; under a sustained outage holds could exhaust
capacity (not traced). **Email pipeline concurrency** — the at-least-once drain + missing Idempotency-Key
(P1-4) is the real residual risk.

## 7. RECOMMENDED FIX ORDER

1. **P0-1** — config-scoped booking stash key + re-run price-reconciliation on the rehydrated-ref path. (Blocks launch.)
2. **P1-3** — owner/staff guard on `api_record_payment_charge` (one-line SQL, both files; also stop overwriting recorded charges → fixes P2 FX drift).
3. **P1-1** — decide the refund process (Peach webhook? runbook or "Mark refunded" action).
4. **P1-4** — `Idempotency-Key` on the Resend POST (one header).
5. **P1-2** — Mauritius-local time in the PDF + email.
6. **P1-5** — re-pay mints a fresh checkout + AccountBookings "Pay now".
7. **P1-6** — CookieNotice `z-40` → `z-30`.
8. P2 batch + pre-launch process (GDPR erasure, one a11y pass, Peach-outage hold check, vitest single-thread on CI).
