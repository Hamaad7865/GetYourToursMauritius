-- Quote deposit + balance: a quote guest pays a DEPOSIT (default 10%, editable per quote; 100% = pay
-- in full) which confirms the booking and reserves the seat, then staff chase the balance later with
-- a second payment link. This migration is the SCHEMA half only — the sizing, the second payments
-- row, the receipt-vs-invoice split and the admin UI land in later tasks of the same plan
-- (docs/superpowers/plans/2026-08-06-quote-deposit-balance.md).
--
-- Three storage facts turn the feature on:
--
--   1. quotes.deposit_bps — the deposit as basis points (1000 = 10.00%). Editable per quote; 10000
--      means "pay in full", which is the UNCHANGED current behaviour (the whole booking total is
--      charged and confirmed exactly as today). The range check forbids 0 (a deposit that charges
--      nothing would never confirm the booking) and anything over 100%.
--
--   2. bookings.deposit_minor / bookings.balance_due_minor — the deposit taken and the amount still
--      owed. bookings.total_minor stays the FULL price throughout (it feeds VAT and operator payout);
--      balance_due_minor is the "how much is still owed" source of truth, kept OUT of the payment_state
--      roll-up so the enum (and its sticky-failed protection) is left untouched.
--
--      DEFAULT 0 IS LOAD-BEARING. Every booking that already exists is fully paid or fully unpaid in
--      the pre-deposit world; defaulting balance_due_minor to total_minor would make every one of them
--      look part-paid to every reader and sweep. A legacy booking must read "nothing owed" (0).
--
--   3. payments.purpose gains 'balance' — the balance is a SEPARATE, purpose-scoped payments row (the
--      same pattern the late-pickup add-on established for 'pickup_addon'), so the existing
--      confirm-on-paid path is untouched and a booking re-pay can never collide with it.

begin;

-- 1) quotes.deposit_bps — the per-quote deposit size, in basis points (1000 = 10.00%).
alter table quotes add column deposit_bps int not null default 1000
  check (deposit_bps between 1 and 10000);

-- 2) bookings.deposit_minor / balance_due_minor — deposit taken and amount still owed.
--    Default 0: an existing booking owes nothing (see header — this is the landmine).
alter table bookings add column deposit_minor     bigint not null default 0;
alter table bookings add column balance_due_minor bigint not null default 0;

-- 3) payments.purpose — widen to admit the balance row alongside 'booking' and 'pickup_addon'.
alter table payments drop constraint if exists payments_purpose_check;
alter table payments add constraint payments_purpose_check
  check (purpose in ('booking', 'pickup_addon', 'balance'));

commit;
