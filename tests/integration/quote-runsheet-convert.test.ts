import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * api_convert_quote (20260927000000) copies the bespoke-tour run-sheet facts onto the minted booking:
 * a custom line's `guests` + `pickup_label` land on booking_custom_items, and the quote's
 * `room_or_cabin` lands on the booking — so the operations calendar can show "collect N guests from
 * <hotel>, room <X>" for a converted quote. Additive: a quote that states none converts exactly as
 * before, the columns null.
 */
describe('api_convert_quote carries the run-sheet facts onto the booking', () => {
  let db: TestDb;
  let seq = 0;

  async function call<T = unknown>(fn: string, params: unknown): Promise<T> {
    const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
      JSON.stringify(params),
    ]);
    return rows[0]!.data;
  }

  /** A sent quote: one custom line (subtotal == total, so quote_total_mismatch is satisfied) carrying
   *  `guests` + `pickup_label`, and the quote itself carrying `room_or_cabin`. Converted through the
   *  real RPC as service_role. Returns the minted booking ref. */
  async function convert(opts: {
    guests: number | null;
    pickupLabel: string | null;
    room: string | null;
  }): Promise<string> {
    seq += 1;
    await db.asOwner();
    const total = 9000;
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, status, valid_until, total_minor,
                           room_or_cabin, sent_at)
       values ($1, 'Marie Dupont', $2, 'sent', current_date + 7, $3, $4, now()) returning id`,
      [`QRUN${seq}`, `marie${seq}@example.com`, total, opts.room],
    );
    const quoteId = rows[0]!.id;
    await db.pg.query(
      `insert into quote_items (quote_id, position, kind, description, starts_at, quantity,
                                unit_amount_minor, subtotal_minor, guests, pickup_label)
       values ($1, 1, 'custom', 'Private South Tour', now() + interval '10 days', 1, $2, $2, $3, $4)`,
      [quoteId, total, opts.guests, opts.pickupLabel],
    );
    await db.as({ role: 'service_role' });
    const booking = await call<{ ref: string }>('api_convert_quote', { quoteId });
    return booking.ref;
  }

  async function runsheet(ref: string): Promise<{
    room: string | null;
    guests: number | null;
    pickup: string | null;
  }> {
    await db.asOwner();
    const { rows } = await db.pg.query<{
      room_or_cabin: string | null;
      guests: number | null;
      pickup_label: string | null;
    }>(
      `select b.room_or_cabin, ci.guests, ci.pickup_label
         from bookings b
         join booking_custom_items ci on ci.booking_id = b.id
        where b.ref = $1`,
      [ref],
    );
    const r = rows[0]!;
    return {
      room: r.room_or_cabin,
      guests: r.guests == null ? null : Number(r.guests),
      pickup: r.pickup_label,
    };
  }

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('copies guests + pickup onto the custom line and the room onto the booking', async () => {
    const ref = await convert({
      guests: 2,
      pickupLabel: 'Crystals Beach Resort',
      room: 'Room 214',
    });
    expect(await runsheet(ref)).toEqual({
      guests: 2,
      pickup: 'Crystals Beach Resort',
      room: 'Room 214',
    });
  });

  it('leaves them null when the quote states none — additive, nothing regresses', async () => {
    const ref = await convert({ guests: null, pickupLabel: null, room: null });
    expect(await runsheet(ref)).toEqual({ guests: null, pickup: null, room: null });
  });
});
