import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { computeQuoteSchedule } from '@/lib/quotes/payment-schedule';

/**
 * Per-date payment schedule (20260930000000_payment_schedule).
 *
 * A quote sent payment_mode='per_date' converts into a booking whose balance is split into one
 * installment per activity DATE. The invariant that makes it safe: installments ride on the existing
 * purpose='balance' payments, so append_payment_event is UNCHANGED — an installment is "covered" purely
 * when settlement (total − balance_due) reaches its running total. This suite pins that:
 *
 *   1. convert builds the schedule (one row per date, seq 0 = the deposit) and sizes the deposit to the
 *      earliest date's amount, NOT the % deposit.
 *   2. paying the deposit confirms the booking and covers installment 0; balance_due = the rest.
 *   3. an installment link charges the WATERFALL amount (running total − settled), clamped to the balance.
 *   4. a covered installment refuses; a non-scheduled ('deposit') quote builds no installments.
 *   5. booking_json exposes installments[] with coveredEur; the reminder cron chases upcoming and alerts
 *      the owner on overdue — never asking for money already settled.
 */

interface CreatePaymentOut {
  paymentId: string;
  bookingRef: string;
  amountMinor: number;
}

describe('per-date payment schedule', () => {
  let db: TestDb;
  let seq = 0;

  async function call<T = unknown>(fn: string, params: unknown): Promise<T> {
    const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
      JSON.stringify(params),
    ]);
    return rows[0]!.data;
  }

  /** A sent quote whose lines are `[{ amountMinor, daysFromNow }]`, converted through the real RPC. */
  async function convertQuote(
    lines: Array<{ amountMinor: number; daysFromNow: number | null }>,
    paymentMode: 'deposit' | 'per_date',
    depositBps = 5000,
  ): Promise<{ ref: string }> {
    seq += 1;
    const total = lines.reduce((s, l) => s + l.amountMinor, 0);
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, status, valid_until, total_minor,
                           deposit_bps, payment_mode, sent_at)
       values ($1, 'Marie Dupont', $2, 'sent', current_date + 30, $3, $4, $5, now()) returning id`,
      [`QSCH${seq}`, `sch${seq}@example.com`, total, depositBps, paymentMode],
    );
    const quoteId = rows[0]!.id;
    let pos = 0;
    for (const line of lines) {
      pos += 1;
      await db.pg.query(
        `insert into quote_items (quote_id, position, kind, description, starts_at, quantity,
                                  unit_amount_minor, subtotal_minor)
         values ($1, $2, 'custom', $3,
                 case when $4::int is null then null
                      else (now() + make_interval(days => $4::int)) end,
                 1, $5, $5)`,
        [quoteId, pos, `Line ${pos}`, line.daysFromNow, line.amountMinor],
      );
    }
    await db.as({ role: 'service_role' });
    const booking = await call<{ ref: string }>('api_convert_quote', { quoteId });
    return { ref: booking.ref };
  }

  async function mint(
    ref: string,
    purpose: 'booking' | 'balance',
    key: string,
    installmentSeq?: number,
  ): Promise<CreatePaymentOut> {
    await db.as({ role: 'service_role' });
    return call<CreatePaymentOut>('api_create_quote_payment', {
      bookingRef: ref,
      idempotencyKey: key,
      purpose,
      ...(installmentSeq != null ? { installmentSeq } : {}),
    });
  }

  async function settle(paymentId: string, eventId: string, amountMinor: number): Promise<void> {
    await db.as({ role: 'service_role' });
    await db.pg.query(
      `select append_payment_event($1::uuid, 'paid', $2::text, $3::bigint, now(), '{}'::jsonb)`,
      [paymentId, eventId, amountMinor],
    );
  }

  async function bookingState(ref: string): Promise<{
    status: string;
    depositMinor: number;
    balanceDueMinor: number;
  }> {
    await db.asOwner();
    const { rows } = await db.pg.query<{
      status: string;
      deposit_minor: number;
      balance_due_minor: number;
    }>(
      `select status::text as status, deposit_minor, balance_due_minor from bookings where ref = $1`,
      [ref],
    );
    return {
      status: rows[0]!.status,
      depositMinor: Number(rows[0]!.deposit_minor),
      balanceDueMinor: Number(rows[0]!.balance_due_minor),
    };
  }

  async function installments(
    ref: string,
  ): Promise<Array<{ seq: number; amount: number; dueOn: string }>> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ seq: number; amount_minor: number; due_on: string }>(
      `select bi.seq, bi.amount_minor, bi.due_on::text as due_on
         from booking_installments bi join bookings b on b.id = bi.booking_id
        where b.ref = $1 order by bi.seq`,
      [ref],
    );
    return rows.map((r) => ({ seq: r.seq, amount: Number(r.amount_minor), dueOn: r.due_on }));
  }

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  it('builds one installment per date and sizes the deposit to the earliest date', async () => {
    // Three dates: €90 in 2 days, €180 in 5 days, €140 in 8 days. Two lines share day 5 → one €180 row.
    const { ref } = await convertQuote(
      [
        { amountMinor: 9000, daysFromNow: 2 },
        { amountMinor: 12000, daysFromNow: 5 },
        { amountMinor: 6000, daysFromNow: 5 },
        { amountMinor: 14000, daysFromNow: 8 },
      ],
      'per_date',
    );
    const sched = await installments(ref);
    expect(sched.map((i) => i.amount)).toEqual([9000, 18000, 14000]); // grouped by date, in order
    expect(sched.map((i) => i.seq)).toEqual([0, 1, 2]);
    // seq 0 (the earliest date) IS the deposit — NOT the 50% deposit_bps (which would be 20500).
    expect((await bookingState(ref)).depositMinor).toBe(9000);
  });

  it('deposit confirms the booking + covers installment 0; the rest is the balance', async () => {
    const { ref } = await convertQuote(
      [
        { amountMinor: 9000, daysFromNow: 2 },
        { amountMinor: 18000, daysFromNow: 5 },
      ],
      'per_date',
    );
    const dep = await mint(ref, 'booking', `${ref}-dep`);
    expect(dep.amountMinor).toBe(9000); // sized to installment 0
    await settle(dep.paymentId, `${ref}-dep-evt`, dep.amountMinor);

    const st = await bookingState(ref);
    expect(st.status).toBe('confirmed');
    expect(st.balanceDueMinor).toBe(18000); // installment 1 still owed
  });

  it('an installment link charges the running total minus what is settled', async () => {
    const { ref } = await convertQuote(
      [
        { amountMinor: 9000, daysFromNow: 2 },
        { amountMinor: 18000, daysFromNow: 5 },
        { amountMinor: 14000, daysFromNow: 8 },
      ],
      'per_date',
    );
    const dep = await mint(ref, 'booking', `${ref}-dep`);
    await settle(dep.paymentId, `${ref}-dep-evt`, dep.amountMinor); // installment 0 settled (9000)

    // Installment 1: cumulative(1)=27000, settled=9000 → charge 18000.
    const i1 = await mint(ref, 'balance', `${ref}-i1`, 1);
    expect(i1.amountMinor).toBe(18000);
    await settle(i1.paymentId, `${ref}-i1-evt`, i1.amountMinor);
    expect((await bookingState(ref)).balanceDueMinor).toBe(14000);

    // Installment 2 (the last): the whole remaining balance.
    const i2 = await mint(ref, 'balance', `${ref}-i2`, 2);
    expect(i2.amountMinor).toBe(14000);
    await settle(i2.paymentId, `${ref}-i2-evt`, i2.amountMinor);
    expect((await bookingState(ref)).balanceDueMinor).toBe(0);
  });

  it('refuses an installment that is already covered, and an unknown seq', async () => {
    const { ref } = await convertQuote(
      [
        { amountMinor: 9000, daysFromNow: 2 },
        { amountMinor: 18000, daysFromNow: 5 },
      ],
      'per_date',
    );
    const dep = await mint(ref, 'booking', `${ref}-dep`);
    await settle(dep.paymentId, `${ref}-dep-evt`, dep.amountMinor); // installment 0 covered

    // Installment 0 is the deposit and already covered → refuse.
    await expect(mint(ref, 'balance', `${ref}-i0`, 0)).rejects.toThrow(/installment_already_paid/);
    await expect(mint(ref, 'balance', `${ref}-bad`, 9)).rejects.toThrow(/installment_not_found/);
  });

  it('a deposit-mode quote builds no schedule (unchanged path)', async () => {
    const { ref } = await convertQuote(
      [{ amountMinor: 10000, daysFromNow: 5 }],
      'deposit',
      1000, // 10%
    );
    expect(await installments(ref)).toEqual([]);
    expect((await bookingState(ref)).depositMinor).toBe(1000); // the 10% deposit, untouched
  });

  it('booking_json exposes the schedule with the waterfall coverage', async () => {
    const { ref } = await convertQuote(
      [
        { amountMinor: 9000, daysFromNow: 2 },
        { amountMinor: 18000, daysFromNow: 5 },
      ],
      'per_date',
    );
    const dep = await mint(ref, 'booking', `${ref}-dep`);
    await settle(dep.paymentId, `${ref}-dep-evt`, dep.amountMinor);

    await db.asOwner();
    // booking_json takes a uuid (not jsonb), so call it directly rather than through the jsonb helper.
    const r = await db.pg.query<{
      data: { installments: Array<{ seq: number; amountEur: number; coveredEur: number }> };
    }>(`select booking_json((select id from bookings where ref = $1)) as data`, [ref]);
    const inst = r.rows[0]!.data.installments;
    expect(inst).toHaveLength(2);
    expect(inst[0]).toMatchObject({ seq: 0, amountEur: 90, coveredEur: 90 }); // deposit paid
    expect(inst[1]).toMatchObject({ seq: 1, amountEur: 180, coveredEur: 0 }); // still due
  });

  it('the reminder cron chases an upcoming installment and alerts the owner on an overdue one', async () => {
    // Deposit paid; installment 1 due in 2 days (within the 3-day lead) → guest chase. Then move it to
    // yesterday → owner overdue alert. Nothing asks for money already settled.
    const { ref } = await convertQuote(
      [
        { amountMinor: 9000, daysFromNow: 0 },
        { amountMinor: 18000, daysFromNow: 2 },
      ],
      'per_date',
    );
    const dep = await mint(ref, 'booking', `${ref}-dep`);
    await settle(dep.paymentId, `${ref}-dep-evt`, dep.amountMinor);

    await db.as({ role: 'service_role' });
    const n1 = await call<number>('api_enqueue_installment_reminders', { leadDays: 3 });
    expect(n1).toBeGreaterThanOrEqual(1);

    await db.asOwner();
    const guest = await db.pg.query<{ payload: { amountDueMinor: number } }>(
      `select payload from notification_outbox
        where template = 'installment_reminder' and booking_id = (select id from bookings where ref = $1)`,
      [ref],
    );
    expect(guest.rows).toHaveLength(1);
    expect(Number(guest.rows[0]!.payload.amountDueMinor)).toBe(18000);

    // Make installment 1 overdue and re-run: the owner is alerted.
    await db.pg.query(
      `update booking_installments set due_on = current_date - 1
        where seq = 1 and booking_id = (select id from bookings where ref = $1)`,
      [ref],
    );
    await db.as({ role: 'service_role' });
    await call<number>('api_enqueue_installment_reminders', { leadDays: 3 });
    await db.asOwner();
    const owner = await db.pg.query(
      `select 1 from notification_outbox
        where template = 'owner_installment_overdue' and booking_id = (select id from bookings where ref = $1)`,
      [ref],
    );
    expect(owner.rows).toHaveLength(1);
  });

  // ── Adversarial-review fixes ─────────────────────────────────────────────────────────────────────

  /**
   * FIX 1 (the money bug). Installment charges are CUMULATIVE (seq k = running total up to it − settled),
   * so two links size to OVERLAPPING amounts. Before the fix each minted its own live Peach session
   * (per-seq lease), and completing both settled the overlap twice — a real overcharge. The lease is now
   * booking-wide: one open balance session at a time, whatever installment opened it.
   */
  it('Fix 1: two installment links opened before either settles share ONE session (no overpay)', async () => {
    // €90 / €180 / €140 across three dates. Deposit (seq0 = €90) paid → balance_due €320.
    const { ref } = await convertQuote(
      [
        { amountMinor: 9000, daysFromNow: 2 },
        { amountMinor: 18000, daysFromNow: 5 },
        { amountMinor: 14000, daysFromNow: 8 },
      ],
      'per_date',
    );
    const dep = await mint(ref, 'booking', `${ref}-dep`);
    await settle(dep.paymentId, `${ref}-dep-evt`, dep.amountMinor);

    // Open installment 1 AND installment 2 before settling either. The second must REUSE the first's
    // still-open row — one payable session per booking — not fork a second, overlapping one.
    const i1 = await mint(ref, 'balance', `${ref}-i1`, 1);
    const i2 = await mint(ref, 'balance', `${ref}-i2`, 2);
    expect(i2.paymentId).toBe(i1.paymentId); // reused, not forked
    expect(i2.amountMinor).toBe(i1.amountMinor); // i1's amount (18000), NOT a fresh 32000

    // Exactly one balance row exists for the booking.
    await db.asOwner();
    const balRows = await db.pg.query(
      `select 1 from payments p join bookings b on b.id = p.booking_id
        where b.ref = $1 and p.purpose = 'balance'`,
      [ref],
    );
    expect(balRows.rows).toHaveLength(1);

    // Settle it (€180). balance_due → €140. Only NOW does a fresh installment-2 open mint its own,
    // correctly re-sized row (the earlier one is fully paid, so it is skipped by the reuse filter).
    await settle(i1.paymentId, `${ref}-i1-evt`, i1.amountMinor);
    expect((await bookingState(ref)).balanceDueMinor).toBe(14000);

    const i2b = await mint(ref, 'balance', `${ref}-i2b`, 2);
    expect(i2b.paymentId).not.toBe(i1.paymentId); // a new session; the old one is settled
    expect(i2b.amountMinor).toBe(14000);
    await settle(i2b.paymentId, `${ref}-i2b-evt`, i2b.amountMinor);

    // Everything settled; total paid == booking total, never a cent more (the overlap is not paid twice).
    expect((await bookingState(ref)).balanceDueMinor).toBe(0);
    await db.asOwner();
    const paid = await db.pg.query<{ total: number }>(
      `select coalesce(sum(p.paid_minor), 0)::int as total from payments p
         join bookings b on b.id = p.booking_id where b.ref = $1`,
      [ref],
    );
    expect(Number(paid.rows[0]!.total)).toBe(41000); // 9000 + 18000 + 14000, exactly the total
  });

  it('Fix 1: the plain balance link and an installment link also share ONE session', async () => {
    const { ref } = await convertQuote(
      [
        { amountMinor: 9000, daysFromNow: 2 },
        { amountMinor: 18000, daysFromNow: 5 },
      ],
      'per_date',
    );
    const dep = await mint(ref, 'booking', `${ref}-dep`);
    await settle(dep.paymentId, `${ref}-dep-evt`, dep.amountMinor); // balance_due €180

    const plain = await mint(ref, 'balance', `${ref}-bal`); // the whole balance, €180
    expect(plain.amountMinor).toBe(18000);
    const i1 = await mint(ref, 'balance', `${ref}-i1`, 1); // must reuse the plain session, not fork
    expect(i1.paymentId).toBe(plain.paymentId);
  });

  /**
   * FIX 2 (parity). The guest email + public page compute the schedule in TS (computeQuoteSchedule) so
   * they can state the terms BEFORE the booking exists. This pins that TS to the SQL split the booking
   * is actually made with — same amounts, same Mauritius-local dates — including a line whose UTC
   * instant crosses the +4h boundary into the next Mauritius day.
   */
  it('Fix 2: computeQuoteSchedule matches booking_installments exactly (incl. the tz boundary)', async () => {
    // 06:00Z = 10:00 MU (same day); 21:00Z on the 5th = 01:00 MU on the 6th → its OWN installment.
    const starts = [
      { iso: '2026-09-05T06:00:00Z', amountMinor: 9000 },
      { iso: '2026-09-05T21:00:00Z', amountMinor: 5000 },
      { iso: '2026-09-08T06:00:00Z', amountMinor: 12000 },
    ];
    seq += 1;
    const total = starts.reduce((s, l) => s + l.amountMinor, 0);
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, status, valid_until, total_minor,
                           deposit_bps, payment_mode, sent_at)
       values ($1, 'Marie', $2, 'sent', current_date + 30, $3, 5000, 'per_date', now()) returning id`,
      [`QPAR${seq}`, `par${seq}@example.com`, total],
    );
    const quoteId = rows[0]!.id;
    let pos = 0;
    for (const s of starts) {
      pos += 1;
      await db.pg.query(
        `insert into quote_items (quote_id, position, kind, description, starts_at, quantity,
                                  unit_amount_minor, subtotal_minor)
         values ($1, $2, 'custom', $3, $4::timestamptz, 1, $5, $5)`,
        [quoteId, pos, `Line ${pos}`, s.iso, s.amountMinor],
      );
    }
    await db.as({ role: 'service_role' });
    const booking = await call<{ ref: string }>('api_convert_quote', { quoteId });

    const dbSchedule = await installments(booking.ref);
    const tsSchedule = computeQuoteSchedule(
      starts.map((s) => ({ startsAt: s.iso, subtotalMinor: s.amountMinor, transportFareMinor: 0 })),
    );
    // The TS helper the guest email/page render from agrees with the SQL the booking is split by.
    expect(tsSchedule.map((i) => ({ seq: i.seq, dueOn: i.dueOn, amount: i.amountMinor }))).toEqual(
      dbSchedule.map((i) => ({ seq: i.seq, dueOn: i.dueOn, amount: i.amount })),
    );
    // The boundary line really landed on 6 Sep as its own installment — Mauritius-local, not UTC.
    expect(dbSchedule.map((i) => i.dueOn)).toEqual(['2026-09-05', '2026-09-06', '2026-09-08']);
    expect(dbSchedule.map((i) => i.amount)).toEqual([9000, 5000, 12000]);
  });

  /**
   * A per_date quote whose EARLIEST date is a complimentary (€0) activity. A zero seq-0 would set
   * deposit_minor = 0, which create_payment reads as the "no deposit" sentinel and would then charge the
   * WHOLE total at the deposit step — the guest shown "Pay 0" but billed everything. The deposit must be
   * the first POSITIVE date, and the zero date must not be an installment.
   */
  it('excludes a zero earliest date: deposit is the first positive date, not the full total', async () => {
    const { ref } = await convertQuote(
      [
        { amountMinor: 0, daysFromNow: 2 }, // a free activity on the earliest date
        { amountMinor: 30000, daysFromNow: 5 },
        { amountMinor: 20000, daysFromNow: 8 },
      ],
      'per_date',
    );
    // The €0 date is NOT an installment; seq 0 is the first payable date.
    const sched = await installments(ref);
    expect(sched.map((i) => i.amount)).toEqual([30000, 20000]);
    // The deposit is the first positive date (€300), NOT €0 and NOT the €500 full total.
    expect((await bookingState(ref)).depositMinor).toBe(30000);

    // And create_payment charges that €300 at the deposit step — never the full total via the sentinel.
    const dep = await mint(ref, 'booking', `${ref}-dep`);
    expect(dep.amountMinor).toBe(30000);
    await settle(dep.paymentId, `${ref}-dep-evt`, dep.amountMinor);
    expect((await bookingState(ref)).balanceDueMinor).toBe(20000);
  });
});
