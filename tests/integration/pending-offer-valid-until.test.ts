import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import type { ServiceContext } from '@/lib/services/context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { listMyPendingBookings } from '@/lib/services/bookings';

/**
 * The cart's "Awaiting payment" deadline, per booking kind.
 *
 * The bug: a QUOTE booking has no seat hold — api_convert_quote mints it straight from the quote's
 * lines and never calls create_hold, because a custom line reserves no capacity — so `holdExpiresAt`
 * came back null and the row rendered the countdown arm anyway, printing "Pay within 00:00" on an
 * offer with three weeks left. Measured in production at the time: all 24 `web` bookings had a hold
 * row, all 3 `quote` bookings had none.
 *
 * `offerValidUntil` is what the row shows instead, and the null/non-null split IS the branch the UI
 * keys off — so both halves are asserted here, not just the new one.
 */

const GUEST = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

describe('api_my_pending_bookings: offerValidUntil', () => {
  let db: TestDb;
  let ctx: ServiceContext;

  /** A payment_pending booking. `withHold` mirrors a web checkout; without it, a quote conversion. */
  async function seedBooking(
    ref: string,
    source: string,
    opts: { withHold?: boolean; quoteValidUntil?: string } = {},
  ): Promise<string> {
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into bookings (ref, user_id, customer_name, customer_email, source, currency,
                             total_minor, status, payment_state, locale)
       values ($1, $2, 'Guest', 'guest@example.com', $3::booking_source, 'EUR', 100,
               'payment_pending', 'pending', 'en')
       returning id`,
      [ref, GUEST, source],
    );
    const id = rows[0]!.id;
    if (opts.withHold) {
      const occ = (await db.pg.query<{ id: string }>(`select id from session_occurrences limit 1`))
        .rows[0]!.id;
      await db.pg.query(
        `insert into booking_holds (booking_id, session_occurrence_id, quantity, status, expires_at,
                                   idempotency_key)
         values ($1, $2, 1, 'active', now() + interval '25 minutes', $3)`,
        [id, occ, `hold-${ref}`],
      );
    }
    if (opts.quoteValidUntil) {
      await db.pg.query(
        // `converted_at` alongside `booking_id` is the schema contract (quote_converted_shape):
        // api_erase_user's hard delete nulls booking_id, so converted_at is what proves conversion.
        `insert into quotes (ref, customer_name, customer_email, valid_until, booking_id, converted_at,
                             status, currency, total_minor)
         values ($1, 'Guest', 'guest@example.com', $2::date, $3, now(), 'sent', 'EUR', 100)`,
        [`Q${ref}`, opts.quoteValidUntil, id],
      );
    }
    return id;
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [GUEST]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [GUEST]);
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`))
      .rows[0]!.id;
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'offer-tour', 'activity', 'Offer Tour', 'Sightseeing tours', 'published')
         returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    const optId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Standard') returning id`,
        [actId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
       values ($1, $2, now() + interval '3 days', now() + interval '3 days 3 hours', 50)`,
      [optId, operatorId],
    );

    await seedBooking('BMTOFFERWEB0001', 'web', { withHold: true });
    await seedBooking('BMTOFFERQUOTE01', 'quote', { quoteValidUntil: '2026-08-21' });
    await seedBooking('BMTOFFERBARE001', 'quote'); // a quote row that never got a quotes record

    ctx = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
    };
    await db.as({ sub: GUEST, role: 'authenticated' });
  });

  afterAll(async () => {
    await db.close();
  });

  const rowFor = async (ref: string) =>
    (await listMyPendingBookings(ctx)).find((b) => b.ref === ref);

  it('gives a quote booking the offer deadline and NO hold — the 00:00 case', async () => {
    const row = await rowFor('BMTOFFERQUOTE01');
    expect(row, 'the quote booking is missing from the pending list').toBeDefined();
    expect(
      row!.holdExpiresAt,
      'a quote booking reserves no capacity, so it must have no hold to count down',
    ).toBeNull();
    expect(row!.offerValidUntil).toMatch(/^2026-08-21/);
  });

  it('leaves a web booking exactly as it was: a live hold, no offer date', async () => {
    const row = await rowFor('BMTOFFERWEB0001');
    expect(row!.holdExpiresAt).toBeTruthy();
    expect(row!.offerValidUntil ?? null).toBeNull();
  });

  it('returns null for a booking with neither — the row then shows no deadline at all', async () => {
    const row = await rowFor('BMTOFFERBARE001');
    expect(row!.holdExpiresAt).toBeNull();
    expect(row!.offerValidUntil ?? null).toBeNull();
  });

  it('never duplicates a booking, since quotes.booking_id is UNIQUE', async () => {
    const all = await listMyPendingBookings(ctx);
    expect(all).toHaveLength(3);
    expect(new Set(all.map((b) => b.ref)).size).toBe(3);
  });

  it('exposes ONLY the date from quotes — no token hash, no quote ref', async () => {
    // The function is security definer, so the join bypasses RLS. It must add a date and nothing else.
    const all = await listMyPendingBookings(ctx);
    const serialised = JSON.stringify(all);
    expect(serialised).not.toMatch(/token/i);
    expect(serialised).not.toContain('QBMTOFFERQUOTE01');
  });
});
