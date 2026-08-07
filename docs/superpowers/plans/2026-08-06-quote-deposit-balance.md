# Quote Deposit + Balance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> **Status:** DESIGN — awaiting owner review. No code until approved.

**Goal:** A quote guest pays a deposit (default 10%, editable per quote; 100% = pay-in-full) which confirms the booking and reserves the seat. Staff later send a second link for the balance. Receipt on the deposit, full VAT invoice only when the balance clears. Deposit is non-refundable; balance chased manually (no cron reminders).

**Architecture:** Reuse the purpose-scoped multi-payment pattern the late-pickup add-on established (`payments.purpose`). The deposit is the existing `purpose='booking'` row **sized to the deposit**, not the full total — so the existing confirm-on-paid path (`append_payment_event`) confirms the booking when the deposit clears, and a pay-in-full quote (`deposit_bps=10000`) is the _unchanged_ current behaviour. The balance is a **new `purpose='balance'` row** minted lazily when staff send the balance link. "How much is still owed" lives in a new `bookings.balance_due_minor` column maintained by `append_payment_event`, so the booking-level `payment_state` roll-up is left intact (no re-threading of the enum, no risk to the sticky-failed fix). `bookings.total_minor` stays the FULL price throughout — it feeds VAT and operator payout.

**Tech Stack:** Supabase Postgres + SECURITY DEFINER RPCs, Next.js edge routes, Zod, Vitest, Peach, Resend.

---

## The core insight (why this is safe)

The map found the single line that decides how much a guest is charged: `create_payment` inserts the first payments row with `amount_minor = v_booking.total_minor` ([20260911000000_quote_checkout_entry.sql:154-156]). `append_payment_event` then confirms a booking when **that row's** `paid_minor >= its own amount_minor` — NOT when the booking total is covered. So if the deposit row's `amount_minor` is the deposit figure, paying it in full confirms the booking, exactly as wanted, with **no change to the confirm logic**. The whole design turns on: (a) size the first row to the deposit, (b) make the balance a separate purpose, (c) track "owed" in a column instead of overloading `payment_state`.

**Rejected alternative:** one full-total `booking` row captured only 10%. This does NOT work — `append_payment_event` treats any `v_paid < amount_minor` as `'pending'` and refuses to confirm ([20260902000000_money_path_recovery_fixes.sql:118, 1309-1310]). A deposit must be a row _sized_ to the deposit, not a partial capture.

**Rejected alternative:** a new `payment_state='partially_paid'` enum value threaded through every reader. Higher blast radius on the most dangerous function and every cancel/reschedule/invoice gate. A `balance_due_minor` column answers "how much is owed" directly and leaves the roll-up (and its sticky-failed protection) untouched.

---

## File / object map (grounded in the survey)

| Object                                                                                                                                   | Change                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `quotes.deposit_bps`                                                                                                                     | NEW column, `int not null default 1000` (basis points; 1000 = 10.00%), `check (deposit_bps between 1 and 10000)`               |
| `bookings.deposit_minor`, `bookings.balance_due_minor`                                                                                   | NEW columns (bigint). Full `total_minor` unchanged                                                                             |
| `payments_purpose_check`                                                                                                                 | widen to add `'balance'` — [20260910000000:49-50] + setup.sql + catch-up.sql                                                   |
| `api_convert_quote`                                                                                                                      | compute deposit/balance onto the booking — [20260909000000:997-1005]                                                           |
| `create_payment`                                                                                                                         | size the `booking` row to `deposit_minor`; add a `'balance'` payability + amount branch — [20260911000000:73, 91-146, 154-156] |
| `api_create_quote_payment`                                                                                                               | allow `purpose='balance'` on a quote booking — [20260911000000:305]                                                            |
| `append_payment_event`                                                                                                                   | maintain `balance_due_minor`; leave the roll-up intact — [20260902000000:63-238]                                               |
| `api_pending_payment_checkouts`                                                                                                          | add a `'balance'` sweep branch — [20260910000000:907-968]                                                                      |
| `enqueue_booking_notification`                                                                                                           | confirmed branch: deposit receipt vs full invoice — [20260817000000:11]                                                        |
| NEW `notify_balance_paid` trigger                                                                                                        | full VAT invoice + owner alert when balance clears — mirror `notify_pickup_set` [20260910000000:501-538, 681-698]              |
| `api_booking_receipt`                                                                                                                    | receipt shows amount-settled + balance-due — [20260910000000:1583, 1623-1671]                                                  |
| `api_mark_refunded`                                                                                                                      | exclude the non-refundable deposit row — [20260910000000:1473-1551]                                                            |
| `src/lib/invoice/model.ts` / `pdf.ts`                                                                                                    | deposit-receipt presentation, fix `fxRate` — [model.ts:279-295, pdf.ts:277-360]                                                |
| `src/lib/admin/quotes.ts`, `AdminQuotes.tsx`, `quotes/state.ts`                                                                          | deposit % field + Send-balance button                                                                                          |
| `quotes.balance_token_hash`                                                                                                              | NEW column (text, nullable) — the DURABLE balance link's token hash, separate from `token_hash` (migration 20260914000000)     |
| NEW `app/api/v1/admin/quotes/[ref]/balance/route.ts`                                                                                     | staff mints a durable balance TOKEN (not a checkout); returns the `/quotes/{ref}/balance` link                                 |
| NEW balance guest flow (page + `balance/open` + `balance/pay` routes, `resolveBalanceForToken`, balance cookie, `QuoteBalancePayButton`) | mint a fresh checkout on each open, mirroring the deposit flow                                                                 |
| `src/lib/validation/booking.ts`, `src/lib/services/payments.ts`                                                                          | widen `purpose` enum/types                                                                                                     |

**Parity (mandatory):** every SQL change is mirrored into `supabase/catch-up.sql` AND `supabase/setup.sql`, and covered by the ledger + openapi artifacts. `resolved-function-bodies.test.ts` must gain a contract row for any re-defined function so a later migration can't silently drop the deposit logic.

---

## Task 1: Schema

**Files:** new migration `supabase/migrations/20260912000000_quote_deposit.sql`; mirror to `catch-up.sql` + `setup.sql`; test `tests/integration/quote-deposit-schema.test.ts`.

- [ ] Write the schema test FIRST (fails: column does not exist), then:

```sql
alter table quotes add column deposit_bps int not null default 1000
  check (deposit_bps between 1 and 10000);
alter table bookings add column deposit_minor  bigint not null default 0;
alter table bookings add column balance_due_minor bigint not null default 0;
alter table payments drop constraint if exists payments_purpose_check;
alter table payments add constraint payments_purpose_check
  check (purpose in ('booking','pickup_addon','balance'));
```

- [ ] Test asserts: `deposit_bps` default 1000, the range check rejects 0 and 10001, `'balance'` is now an accepted `purpose`, and `deposit_minor`/`balance_due_minor` default 0 (so every EXISTING booking reads "nothing owed", not "full amount owed").
- [ ] Run `npm run setup:sql`; diff `setup.sql` (only the quote-deposit block moves); parity tests green.
- [ ] Commit.

**Landmine:** defaulting `balance_due_minor` to `total_minor` would make every legacy booking look part-paid. Default 0.

---

## Task 2: Deposit sizing at conversion + charge

**Files:** the migration (append), `create_payment` + `api_create_quote_payment` in it or a follow-on section; `tests/integration/quote-deposit-convert.test.ts`.

- [ ] Test FIRST: convert a quote with `deposit_bps=1000`, total EUR 1000 → booking has `deposit_minor=10000` (minor), `total_minor=100000`, and `balance_due_minor=100000` (the FULL total — nothing is settled at conversion, so the whole order is owed; `append_payment_event` later recomputes it down to `total - deposit` and then 0 as the deposit and balance settle, pinned in the ledger test). The minted checkout charges the **deposit** (assert `payments.amount_minor` of the `booking` row = 10000). A `deposit_bps=10000` quote charges the full 100000; `balance_due_minor` still reads the full total at conversion and clears to 0 once that deposit settles.

- [ ] `api_convert_quote` ([20260909000000:997-1005]) computes, in the INSERT:
      `deposit_minor := round(v_quote.total_minor * v_quote.deposit_bps / 10000.0)` (the first CHARGE size),
      `balance_due_minor := v_quote.total_minor` (the full total — nothing is settled at conversion, so the
      whole order is owed; NOT `total - deposit`, which would read as if the deposit were already paid and
      would disagree with the `append_payment_event` projection that recomputes this column down as money lands).
      `total_minor` and `operator_payout_minor` stay the FULL `v_quote.total_minor`.

- [ ] `create_payment` booking branch ([20260911000000:154-156]): the first `booking` row is inserted with `amount_minor = v_booking.deposit_minor` (**not** `total_minor`). Everything downstream (the FX pin at :167-194, the MUR charge in payments.ts:173) follows `amount_minor` unchanged.

- [ ] Guard: `deposit_minor` is read from the **booking row**, never caller input (same rule as the FX pin). `api_create_quote_payment` still refuses non-quote bookings.

**Landmines:** do NOT reduce `total_minor` (feeds VAT/payout/operator-payout pin). Only the first payments row's `amount_minor` becomes the deposit. `create_hold` already reserves the FULL seat at conversion regardless of money ([20260909000000:1056-1083]) — do not touch it.

---

## Task 3: `append_payment_event` maintains `balance_due_minor`

**Files:** the migration (re-apply `append_payment_event` — the winning body is [20260902000000:63-238]); `tests/integration/quote-deposit-ledger.test.ts`. Re-apply the oversold/called-off/refund branches VERBATIM around the new logic.

- [ ] Test FIRST: deposit settles → booking `status='confirmed'`, `payment_state='paid'` (roll-up unchanged), **`balance_due_minor` still 90000**. Then the balance settles → `balance_due_minor=0`. A declined balance (failed event) leaves `balance_due_minor` unchanged and does NOT drag the paid booking backwards (roll-up protection).

- [ ] After crediting, set `balance_due_minor = greatest(0, total_minor - (sum of (paid_minor - refunded_minor) over the payment rows whose money actually REACHED total_minor))`. That scope is the `booking` (deposit) and `balance` rows — which ARE the total — PLUS a `pickup_addon` row **only once its request is APPLIED** (a `booking_pickup_requests` row with `applied_at` set and `fee_minor > 0` points at it). An applied pickup GROWS `total_minor` ([20260910000000:666-668]), so its capture MUST count on the summed side to net that growth back out; an ORPHANED pickup capture (zero-fee revision / called-off departure — its fee never reached `total_minor`) must NOT count, or the balance under-collects by the whole fee. Netting `refunded_minor` stops a later refund of a counted row still reading as settled; `greatest(0, …)` clamps any transient negative. (History: first shipped as the naive `purpose in ('booking','balance')` sum — which left a paid pickup add-on falsely owed because the fee grew `total_minor` but the add-on row was excluded; then the all-rows sum — which under-collected on an orphaned capture; the applied-pickup scope is the resolution of both.)

- [ ] Confirmation is unchanged: the `booking` (deposit) row reaching its own `amount_minor` still flips `draft/held/payment_pending → confirmed` ([:163-224]).

**Landmines:** `append_payment_event` is the most dangerous function in the repo — re-declaring it risks reverting the oversold/refund branches (memory: migration-revert-drift). Add a `resolved-function-bodies.test.ts` contract row asserting `balance_due_minor` survives. Do NOT derive any booking-level state from one child row (sticky-failed landmine) — `balance_due_minor` is a SUM over rows.

---

## Task 4: Balance payments row + entry point

**Files:** the migration; `src/lib/validation/booking.ts:322` (`purpose` enum), `src/lib/services/payments.ts:29-56` (`CreatePaymentLinkInput.purpose`); `tests/integration/quote-deposit-balance-pay.test.ts`.

- [ ] Test FIRST: mint a balance link on a deposit-confirmed booking → a `purpose='balance'` payments row with `amount_minor = total_minor - deposit_minor`; charging it clears `balance_due_minor` to 0; a second mint returns the SAME payable session (no fork); anon/authenticated-non-token callers refused.

- [ ] `create_payment` gains a `'balance'` branch mirroring the `pickup_addon` `else` block ([20260911000000:96-118]): its own payability check (allowed on a **confirmed** booking with `balance_due_minor > 0`), amount from the balance row, single-open-lease guard. The balance row is minted here (or a request RPC) — server-owned amount, never caller input.

- [ ] `api_create_quote_payment` ([20260911000000:305]) widens `if v_purpose <> 'booking'` to also allow `'balance'` on a `source='quote'` booking (accountless guest, token-authorized). Keep service-role-only + the revoke-from-public/anon/authenticated lockdown; add to `definer-grants-lockdown.test.ts` if a new function is introduced.

**Landmines:** the balance MUST be a non-`booking` purpose or `create_payment`'s booking-payability guard raises `booking_not_payable` on the confirmed booking ([:91-95]). Two `booking` rows would collide on the `order by created_at desc limit 1` lookup ([:131-134]) — this is exactly why pickup_addon got its own purpose. Ensure the balance checkout mints a DISTINCT `provider_checkout_id` so reconcile resolves by id, never the newest-row fallback ([reconcile.ts:120]).

---

## Task 5: Staff "send balance link" route + the DURABLE guest balance flow + reconcile sweep

> **DESIGN CHANGE (2026-08-06, owner decision).** The first cut minted the balance CHECKOUT at send time and returned `/bookings/{ref}/pay?cid=<checkoutId>`. A Peach checkout session expires in ~30 minutes, so that link died within the hour — and an accountless quote guest has no account to re-mint one, so the balance became uncollectable until staff sent a fresh link. The deposit link never had this problem: the public `/quotes/{ref}` page mints a FRESH checkout on the guest's CLICK. The balance link is now durable the SAME way — a tokenized URL that mints a fresh checkout on each open.

**Files:** the migration `supabase/migrations/20260914000000_quote_balance_link.sql` (one column, `quotes.balance_token_hash`; mirror to catch-up.sql + setup.sql + ledger); `resolveBalanceForToken` in `src/lib/quotes/resolve.ts`; the balance cookie/open/pay-return helpers in `src/lib/quotes/link-cookie.ts` (a DISTINCT cookie from the deposit link's; `isQuotePagePath` widened to admit `/quotes/{ref}/balance` as a re-mint destination); the guest page `app/(site)/quotes/[ref]/balance/page.tsx`; the guest routes `balance/open` (GET, token to cookie) and `balance/pay` (POST, mint on click); the client `balance-pay-client.ts` + `QuoteBalancePayButton.tsx`; the rewritten staff route `app/api/v1/admin/quotes/[ref]/balance/route.ts`; thin client `sendBalanceLink` in `src/lib/admin/quotes.ts`; tests.

- [ ] **SCHEMA.** Add `quotes.balance_token_hash` (text, nullable, no default). App-layer authorization only — the balance's payability, amount, single-flight lease and reconcile sweep all shipped in 20260912000000 (Task 4), so nothing else SQL-side changes.

- [ ] **STAFF ROUTE — mint a durable TOKEN, not a checkout.** Same staff gate as `admin/quotes/send/route.ts` (rate limit, `requireUser`, `callerRole` off `profiles.role`, `SENDING_ROLES` with `'seo'` excluded). Refuse 409 when there is no booking, the booking is not confirmed, or `balance_due_minor <= 0`. Then mint a fresh balance token with `mintQuoteToken`, store `hashQuoteToken()` into `quotes.balance_token_hash` (writing ONLY that column — NEVER `token_hash`, which would break the guest's original quote link), and return the `/quotes/{ref}/balance?t=<rawToken>` URL for the operator's copy button. It mints no checkout.

- [ ] **GUEST PAGE.** `app/(site)/quotes/[ref]/balance/page.tsx` resolves the balance token via `resolveBalanceForToken` (matches `balance_token_hash`, fails closed on a wrong or absent token exactly like `resolveQuoteForToken`, refuses a not-confirmed or fully-paid booking — one single null, no oracle), shows the amount owed + a Pay button, and never selects `internal_notes`. A raw `?t=` is redirected through the balance open route so the token is kept out of the rendered URL (GTM `page_location` / `error_logs`), exactly as the deposit page does.

- [ ] **GUEST PAY ROUTE.** The Pay button posts to `/api/v1/quotes/{ref}/balance/pay` (authenticated by the balance-link cookie), which mints a FRESH balance checkout on the click via `createPaymentLink` with purpose `balance` and `authorizedBy: quote` and the balance page as the return URL — never a stale embedded `cid`. It reuses the shared single-open lease, so two opens of the durable link reuse ONE session rather than fork two. Every refusal to open the balance is the same 404.

- [ ] `api_pending_payment_checkouts` ([20260910000000:942-948]) gains a `'balance'` branch swept by `pay.status in ('pending','failed')` (mirroring pickup_addon), so a lost balance webhook still reconciles. (Shipped in 20260912000000 Task 4.) The DEPOSIT needs no new branch — it's a `booking` row on a `payment_pending` booking, already swept.

**Landmine:** the balance row must not let `run_booking_maintenance` expire the already-confirmed booking's seat. The 30-min payment_pending expiry keys on booking status, which is `confirmed` post-deposit — it cannot touch the balance row.

---

## Task 6: Receipt vs full VAT invoice + owner alerts

**Files:** `enqueue_booking_notification` confirmed branch ([20260817000000:11]); NEW `notify_balance_paid` trigger; owner-alert payload; `tests/integration/quote-deposit-invoice.test.ts`.

- [ ] Test FIRST: deposit clears on a `balance_due_minor>0` booking → a **deposit receipt** notification (new template `deposit_receipt`), NOT the full `booking_confirmation` VAT invoice. Balance clears (`balance_due_minor` reaches 0) → the full `booking_confirmation` VAT invoice fires exactly once. A pay-in-full quote (`deposit_bps=10000`, `balance_due_minor=0` at confirm) → full invoice immediately, unchanged.

- [ ] Confirmed branch: `if new.balance_due_minor > 0 then enqueue 'deposit_receipt' else enqueue 'booking_confirmation'`.
- [ ] NEW trigger `after update of status on payments when (new.purpose='balance' and new.status='paid' and old.status is distinct from 'paid')` → enqueue `booking_confirmation` + an **email-only** owner alert (Telegram/WhatsApp sentinels throw when unset in prod — [20260910000000:465-467]).
- [ ] Owner "deposit paid" alert: the existing `owner_new_booking` payload hard-codes `totalMinor = new.total_minor` ([20260804000000:31-34]) — extend it to convey deposit-collected + balance-outstanding, or use a distinct template, so the owner isn't told the full amount was taken.

**Landmine:** the balance settling is a booking-status NO-OP (already confirmed), so `enqueue_booking_notification` never fires for it — the full invoice MUST come from the new payments-status trigger.

---

## Task 7: Invoice model + PDF + non-refundable deposit

**Files:** `src/lib/invoice/model.ts`, `src/lib/invoice/pdf.ts`, `src/lib/services/receipt.ts` + `receiptSchema`, `api_booking_receipt`, `api_mark_refunded`; tests.

- [ ] Test FIRST: a deposit-receipt document shows amount **paid** (deposit) and **balance due**, with the correct `fxRate` for the deposit charge (not ~10× wrong); a full invoice after balance shows Total = full gross, PAID; `api_mark_refunded` on a deposit-confirmed booking does NOT reverse the deposit row.

- [ ] `buildPaymentBlock` ([model.ts:279-295]) currently derives `fxRate = chargedAmount / totalGrossEur` — feeding a 10% charge poisons the rate. Carry the settled-amount separately from the order total.
- [ ] `pdf.ts` ([:277-360]): a "Deposit paid / Balance due" presentation for the receipt; the unconditional PAID stamp ([:333]) is gated on fully-paid.
- [ ] `api_booking_receipt` ([20260910000000:1623-1671]): compute amount-settled by purpose (`booking` + `balance`), expose `balance_due_minor`. Keep the `booking_custom_items` union and purpose-scoping (contract test).
- [ ] `api_mark_refunded` ([:1473-1551]): exclude the deposit row from the reversal loop (deposit non-refundable). Staff refund manually in Peach if they choose.

**Landmine:** `api_booking_receipt`'s `purpose='booking' order by created_at desc limit 1` understates the charge if two `booking` rows exist — but the deposit is the only `booking` row (balance is `'balance'`), so it's safe; SUM `booking`+`balance` for "settled so far".

---

## Task 8: Admin UI

**Files:** `src/components/admin/quotes/state.ts` (`QuoteFormValues`, `emptyQuoteForm`, `formFromQuote`, `quoteInputFromForm`), `AdminQuotes.tsx`, `src/lib/admin/quotes.ts` (`QuoteRow`, `QuoteInput`, `mapQuote`, `QUOTE_COLUMNS`, `saveQuote` `fields`).

- [ ] Deposit control in the "Who this offer is for" card ([AdminQuotes.tsx:471-534]): a % input defaulting to 10, plus a "Pay in full" toggle that sets it to 100%.
- [ ] `deposit_bps` threads through the type layer AND `QUOTE_COLUMNS`/select lists by hand (the Supabase client doesn't know the quotes tables — structural casts only). Treat `deposit_bps` as a **write-only-when-supplied** field like `currency`/`locale` ([:604-605]), NOT full-replace, so an edit can't silently reset it.
- [ ] "Send balance link" button in the Send card ([:571-642]) beside Send/Withdraw, wired to `sendBalanceLink`; show deposit-paid / balance-outstanding state on converted quotes.
- [ ] Money stays in MINOR units end to end; deposit shown as a % (not a float round-trip).

**Landmine:** `saveQuote` full-replaces guest/note fields; a naive `deposit_bps` in `fields` would be cleared by any form lacking the input. Put it on the write-only-when-supplied side.

---

## Task 9: Docs, contract, CI gate

- [ ] Register the new balance route in `src/lib/openapi/registry.ts`; `npm run openapi:write`.
- [ ] Document in `docs/handbook/quotes.md`: the deposit model, `deposit_bps`, `balance_due_minor` as the "owed" source of truth (never `payment_state`), receipt-vs-invoice split, non-refundable deposit.
- [ ] Full gate: `format:check`, `lint`, `typecheck`, `npm test`, `build`, `openapi:write` — paste real results.

---

## Self-Review

**Product decisions honoured:** deposit default 10% editable per quote (Task 1 `deposit_bps`) · deposit-or-full per quote (Task 1, `deposit_bps=10000` = full) · receipt on deposit, full VAT invoice on balance (Task 6) · deposit non-refundable, balance manual (Task 7 refund exclusion; Task 5 no reminder cron).

**Money-path invariants asserted by tests:** the deposit confirms + reserves the seat (Task 2, 3) · `total_minor` never reduced (Task 2) · `balance_due_minor` summed over rows, never latched from one (Task 3) · no second payable session for deposit or balance (Task 2, 4) · balance can't open on the `booking` purpose (Task 4) · definer lockdown for any new function (Task 4) · full invoice fires once, on balance clear (Task 6).

**Biggest risks, called out:** (1) re-declaring `append_payment_event` — mitigated by verbatim re-apply + a contract test. (2) readers that equate `payment_state='paid'` with fully-settled — audited in Task 3/7; the design keeps them working by adding `balance_due_minor` rather than changing `payment_state`. (3) `fxRate` poisoning in the invoice — Task 7.

**Known open item for the owner:** a deposit-paid booking is confirmed but only part-paid. This plan treats it as a normal confirmed booking (cancel keeps the deposit). If you later want the guest blocked from self-cancelling a part-paid booking, that's a small follow-up, not baked in here.
