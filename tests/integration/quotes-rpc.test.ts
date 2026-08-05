import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc, pgliteServiceRoleRpc } from '../db/rpc';
import { seedOccurrence } from '../db/seed';
import { mapDbError } from '@/lib/services/db-errors';
import type { ServiceError } from '@/lib/services/errors';
import type { DbRpc } from '@/lib/db/rpc';

/**
 * api_convert_quote (20260909000000_quotes) — the step that mints a PAYABLE booking.
 *
 * Everything downstream of it (Peach checkout → HMAC webhook → append_payment_event → confirmation
 * + VAT invoice) is the untouched money path, so this function is the only new code standing between
 * a staff-drafted offer and a real charge. The properties that are load-bearing:
 *
 *  - it produces exactly ONE booking, in `payment_pending` with `source = 'quote'`, carrying the
 *    quote's total AND the payout that mirrors it, plus the quote's non-catalogue lines;
 *  - it FAILS CLOSED on a catalogue line. Those lines carry capacity and must travel through the
 *    hold path, which does not exist yet — copying the money without the seat would charge a guest
 *    for a place nobody reserved, and append_payment_event's oversell re-check reads
 *    `booking_items`, which would be empty, so the booking would confirm unconditionally;
 *  - it converts a quote once, where "once" means ONE PAYABLE BOOKING AT A TIME. A booking that
 *    died never having taken money re-arms the quote; a hard-DELETED one never does (that is the
 *    `converted_at` contract from section 4 — api_erase_user hard-deletes unpaid bookings and the
 *    `on delete set null` FK silently clears `booking_id`), and one that took money never does;
 *  - every refusal raises a repo error TOKEN, so mapDbError turns it into a 404/409 the guest can
 *    read — not the `console.error('[db] unmapped …')` + 500 that reads as a broken site;
 *  - it returns the booking DTO (booking_json), the shape the whole service layer expects;
 *  - it is SECURITY DEFINER with no in-function caller guard, so its EXECUTE grant IS its
 *    authorization. `revoke ... from public` alone does not strip Supabase's stock direct grants to
 *    anon/authenticated — the omission that shipped two live holes from this repo (api_booking_receipt,
 *    api_pending_payment_checkouts) — so the revoke has to name all three roles.
 */

const OWNER_CUSTOMER = { name: 'Charter Guest', email: 'charter@example.com' };
const STAFF = 'c0c0c0c0-c0c0-c0c0-c0c0-c0c0c0c0c0c0';

let seq = 0;

interface CustomLine {
  description: string;
  amount: number;
}

interface CatalogueLine {
  occurrenceId: string;
  optionId: string;
  quantity: number;
  amount: number;
}

interface SeededQuote {
  id: string;
  ref: string;
  email: string;
}

describe('api_convert_quote', () => {
  let db: TestDb;
  let callRpc: DbRpc['rpc'];
  let callAsCaller: DbRpc['rpc'];

  /**
   * A quote + its lines, written directly as the owner (the admin service layer that will do this
   * for real is a later task). `total_minor` is the sum of the seeded lines, exactly as the editor
   * will persist it, because the conversion copies that figure onto the booking.
   */
  async function seedQuote(
    input: {
      status?: string;
      customLines?: CustomLine[];
      catalogueLines?: CatalogueLine[];
      validUntilDays?: number;
      email?: string;
    } = {},
  ): Promise<SeededQuote> {
    seq += 1;
    const ref = `Q-CONV-${seq}`;
    const email = input.email ?? OWNER_CUSTOMER.email;
    const custom = input.customLines ?? [];
    const catalogue = input.catalogueLines ?? [];
    const total =
      custom.reduce((sum, line) => sum + line.amount, 0) +
      catalogue.reduce((sum, line) => sum + line.amount * line.quantity, 0);
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, customer_phone, status, valid_until,
                           total_minor)
       values ($1, $2, $3, '+230 5555 0000', $4::quote_status,
               current_date + ($5 || ' days')::interval, $6)
       returning id`,
      [
        ref,
        OWNER_CUSTOMER.name,
        email,
        input.status ?? 'sent',
        String(input.validUntilDays ?? 7),
        total,
      ],
    );
    const id = rows[0]!.id;
    let position = 0;
    for (const line of custom) {
      position += 1;
      await db.pg.query(
        `insert into quote_items
           (quote_id, position, kind, description, starts_at, quantity, unit_amount_minor,
            subtotal_minor)
         values ($1, $2, 'custom', $3, now() + interval '10 days', 1, $4, $4)`,
        [id, position, line.description, line.amount],
      );
    }
    for (const line of catalogue) {
      position += 1;
      await db.pg.query(
        `insert into quote_items
           (quote_id, position, kind, session_occurrence_id, activity_option_id,
            quantity, unit_amount_minor, subtotal_minor)
         values ($1, $2, 'catalogue', $3, $4, $5, $6, $7)`,
        [
          id,
          position,
          line.occurrenceId,
          line.optionId,
          line.quantity,
          line.amount,
          line.amount * line.quantity,
        ],
      );
    }
    return { id, ref, email };
  }

  /** How many bookings exist at all — the "did a second payable booking appear?" counter. */
  async function quoteBookingCount(): Promise<number> {
    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from bookings where source = 'quote'`,
    );
    return rows[0]!.n;
  }

  /**
   * Convert, expect a refusal, and return the error the SERVICE LAYER would surface. The raw
   * Postgres message is fed through the real mapDbError, so a guard that raises a human sentence
   * instead of a repo token fails here with a 500 `provider_error` — which is exactly how it would
   * reach a guest clicking Pay.
   */
  async function refusalFor(quoteId: string): Promise<ServiceError> {
    const raw = await callRpc('api_convert_quote', { quoteId }).then(
      () => null,
      (error: unknown) => error,
    );
    expect(raw, 'api_convert_quote minted a booking instead of refusing').not.toBeNull();
    try {
      mapDbError(raw);
    } catch (mapped) {
      return mapped as ServiceError;
    }
    throw new Error('unreachable — mapDbError always throws');
  }

  beforeAll(async () => {
    db = await createTestDb();
    callRpc = pgliteServiceRoleRpc(db.pg).rpc;
    callAsCaller = pgliteRpc(db.pg).rpc;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [
      STAFF,
    ]);
  });

  afterAll(async () => {
    await db.close();
  });

  it('creates one payment_pending booking with source quote', async () => {
    const quote = await seedQuote({
      customLines: [{ description: 'Private guide', amount: 12000 }],
    });

    const booking = await callRpc<{
      id: string;
      status: string;
      source: string;
      totalEur: number;
      customerEmail: string;
    }>('api_convert_quote', { quoteId: quote.id });

    expect(booking.status).toBe('payment_pending');
    expect(booking.source).toBe('quote');
    expect(booking.totalEur).toBe(120);
    expect(booking.customerEmail).toBe(OWNER_CUSTOMER.email);

    // The negotiated line travels with the booking — booking_items cannot hold it (its occurrence +
    // option are NOT NULL), which is the entire reason booking_custom_items exists.
    const { rows: lines } = await db.pg.query<{
      description: string;
      subtotal_minor: number;
      starts_at: string | null;
    }>(
      `select description, subtotal_minor, starts_at from booking_custom_items
        where booking_id = $1 order by position`,
      [booking.id],
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]!.description).toBe('Private guide');
    expect(lines[0]!.subtotal_minor).toBe(12000);
    expect(lines[0]!.starts_at, 'the custom line lost its own date').not.toBeNull();

    // Both halves of the conversion record, together: booking_id is the UNIQUE, converted_at is the
    // half no foreign key can clear.
    const { rows: after } = await db.pg.query<{
      booking_id: string | null;
      converted_at: string | null;
      status: string;
    }>(`select booking_id, converted_at, status from quotes where id = $1`, [quote.id]);
    expect(after[0]!.booking_id).toBe(booking.id);
    expect(
      after[0]!.converted_at,
      'converted_at was not written alongside booking_id',
    ).not.toBeNull();
    expect(after[0]!.status).toBe('accepted');
  });

  it('mints the booking with operator_payout_minor equal to total_minor', async () => {
    // Every other booking-minting path in the repo maintains payout == total (the bookings table
    // header states it outright, and 20260805000000 inserts `v_total, v_total, 0`). It is not
    // self-healing: enforce_booking_admin_update pins operator_payout_minor for any browser write,
    // so a quote booking minted with the 0 default is permanently wrong in the payout report.
    const quote = await seedQuote({ customLines: [{ description: 'Skipper', amount: 12345 }] });
    const booking = await callRpc<{ id: string }>('api_convert_quote', { quoteId: quote.id });

    const { rows } = await db.pg.query<{
      total_minor: number;
      operator_payout_minor: number;
      agency_commission_minor: number;
    }>(
      `select total_minor, operator_payout_minor, agency_commission_minor
         from bookings where id = $1`,
      [booking.id],
    );
    expect(rows[0]!.total_minor).toBe(12345);
    expect(
      rows[0]!.operator_payout_minor,
      'the operator is owed nothing for a quote booking — payout must mirror total',
    ).toBe(12345);
    expect(rows[0]!.agency_commission_minor).toBe(0);
  });

  it('returns the booking DTO, not the raw bookings row', async () => {
    // Every other booking-returning RPC returns booking_json(id) — the camelCase DTO the service
    // layer and the booking Zod schema expect. `to_jsonb(v_booking)` also silently widens this
    // function's output contract every time a column is added to `bookings`, which for a
    // service_role-only function on the money path is a contract that changes with nobody editing it.
    const quote = await seedQuote({ customLines: [{ description: 'Transfer', amount: 4000 }] });
    const booking = await callRpc<Record<string, unknown>>('api_convert_quote', {
      quoteId: quote.id,
    });

    for (const dtoKey of ['id', 'ref', 'status', 'paymentState', 'customerEmail', 'totalEur']) {
      expect(booking, `the DTO is missing ${dtoKey}`).toHaveProperty(dtoKey);
    }
    for (const rawColumn of ['total_minor', 'customer_email', 'payment_state', 'idempotency_key']) {
      expect(
        booking,
        `${rawColumn} leaked — this is to_jsonb(bookings), not booking_json()`,
      ).not.toHaveProperty(rawColumn);
    }
    expect(booking.paymentState).toBe('pending');
  });

  it('refuses to convert the same quote twice, as a readable 409', async () => {
    const quote = await seedQuote({ customLines: [{ description: 'Charter', amount: 50000 }] });
    await callRpc('api_convert_quote', { quoteId: quote.id });
    const before = await quoteBookingCount();

    const error = await refusalFor(quote.id);
    expect(error.status, 'the convert-once guard reaches the guest as a 500 "Database error"').toBe(
      409,
    );
    expect(error.code).toBe('conflict');
    expect(error.message, 'the guest is shown a raw database token').toMatch(/[a-z] [a-z]/);

    expect(await quoteBookingCount(), 'a second payable booking was minted for one quote').toBe(
      before,
    );
  });

  it('never re-arms after the converted booking is HARD-DELETED by an erasure', async () => {
    // The headline invariant. `booking_id` is `on delete set null` and api_erase_user hard-deletes
    // every unpaid booking, so after an erasure the quote reads booking_id = null — and a guard
    // written against `booking_id is not null` would happily mint a SECOND payable booking from a
    // quote that has already been converted. `converted_at` is the half no foreign key can reach.
    const quote = await seedQuote({
      customLines: [{ description: 'Erased charter', amount: 33000 }],
      email: 'erasure-convert@example.com',
    });
    const booking = await callRpc<{ id: string }>('api_convert_quote', { quoteId: quote.id });

    // The real caller: a staff erasure, through the RPC the FK trap actually fires under.
    await db.as({ sub: STAFF, role: 'authenticated' });
    await callAsCaller('api_erase_user', { email: quote.email });
    await db.asOwner();

    const { rows: gone } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from bookings where id = $1`,
      [booking.id],
    );
    expect(gone[0]!.n, 'the erasure did not hard-delete the unpaid booking').toBe(0);

    const { rows: after } = await db.pg.query<{
      booking_id: string | null;
      converted_at: string | null;
    }>(`select booking_id, converted_at from quotes where id = $1`, [quote.id]);
    expect(after[0]!.booking_id, 'the FK should have nulled booking_id').toBeNull();
    expect(
      after[0]!.converted_at,
      'converted_at went with the booking — the guard has nothing durable left to read',
    ).not.toBeNull();

    const before = await quoteBookingCount();
    const error = await refusalFor(quote.id);
    expect(error.status).toBe(409);
    expect(await quoteBookingCount(), 'an erased quote minted a second payable booking').toBe(
      before,
    );
  });

  it('re-arms a quote whose booking died without ever taking money', async () => {
    // Conversion must not be a one-way door into the repo's documented "unpayable forever" trap: a
    // guest who converts, then leaves to fetch their card, loses the booking to the 30-minute
    // maintenance sweep — and from there api_create_payment refuses ('expired') and the quote is
    // converted_at-locked, so nobody can ever pay it again without hand-editing production.
    const quote = await seedQuote({ customLines: [{ description: 'Slow guest', amount: 21000 }] });
    const first = await callRpc<{ id: string }>('api_convert_quote', { quoteId: quote.id });

    await db.pg.query(`update bookings set created_at = now() - interval '2 hours' where id = $1`, [
      first.id,
    ]);
    const swept = await callRpc<{ bookingsExpired: number }>('run_booking_maintenance', {});
    expect(swept.bookingsExpired, 'the sweep did not expire the abandoned booking').toBe(1);

    const second = await callRpc<{ id: string; status: string }>('api_convert_quote', {
      quoteId: quote.id,
    });
    expect(second.id, 'the same dead booking was handed back').not.toBe(first.id);
    expect(second.status).toBe('payment_pending');

    const { rows } = await db.pg.query<{ booking_id: string; converted_at: string | null }>(
      `select booking_id, converted_at from quotes where id = $1`,
      [quote.id],
    );
    expect(rows[0]!.booking_id, 'the quote still points at the dead booking').toBe(second.id);
    expect(rows[0]!.converted_at).not.toBeNull();

    // The dead one stays dead and stays out of the money path.
    const { rows: old } = await db.pg.query<{ status: string }>(
      `select status from bookings where id = $1`,
      [first.id],
    );
    expect(old[0]!.status).toBe('expired');
  });

  it('never re-arms a quote whose booking TOOK MONEY, however dead it looks', async () => {
    const quote = await seedQuote({
      customLines: [{ description: 'Paid charter', amount: 60000 }],
    });
    const paid = await callRpc<{ id: string }>('api_convert_quote', { quoteId: quote.id });

    // Real ledger, not a hand-set column: a payments row plus a 'paid' event through
    // append_payment_event, exactly as the verified Peach webhook does.
    const { rows: payment } = await db.pg.query<{ id: string }>(
      `insert into payments (booking_id, idempotency_key, amount_minor)
       values ($1, $2, 60000) returning id`,
      [paid.id, `idem-${paid.id}`],
    );
    await db.pg.query(`select append_payment_event($1, 'paid', $2, 60000, now(), '{}'::jsonb)`, [
      payment[0]!.id,
      `evt-${paid.id}`,
    ]);
    // …and then the booking is cancelled, so it LOOKS like a dead booking to the re-arm branch.
    await db.pg.query(`update bookings set status = 'cancelled' where id = $1`, [paid.id]);

    const before = await quoteBookingCount();
    const error = await refusalFor(quote.id);
    expect(error.status).toBe(409);
    expect(
      await quoteBookingCount(),
      'a quote that has already been PAID minted a second payable booking',
    ).toBe(before);
  });

  it('refuses a quote carrying a catalogue line rather than half-converting it', async () => {
    // A catalogue line names an occurrence, so it carries capacity and has to travel through the
    // hold path. Until that exists, copying total_minor while dropping the line would charge the
    // guest for a seat nobody reserved — and append_payment_event's oversell re-check loops over
    // `booking_items`, which would be empty, so the booking would CONFIRM unconditionally with no
    // voucher line and no day-sheet entry. converted_at would then lock the quote forever.
    await db.asOwner();
    const seeded = await seedOccurrence(db, 10);
    const quote = await seedQuote({
      customLines: [{ description: 'Guide', amount: 5000 }],
      catalogueLines: [
        {
          occurrenceId: seeded.occurrenceId,
          optionId: seeded.optionId,
          quantity: 2,
          amount: 30000,
        },
      ],
    });

    const before = await quoteBookingCount();
    const error = await refusalFor(quote.id);
    expect(error.status, 'a catalogue quote fell through as an unmapped 500').toBe(409);
    expect(await quoteBookingCount(), 'a catalogue quote minted a booking anyway').toBe(before);

    // Nothing half-written, and the quote is still convertible once the hold path lands.
    const { rows } = await db.pg.query<{
      booking_id: string | null;
      converted_at: string | null;
      status: string;
    }>(`select booking_id, converted_at, status from quotes where id = $1`, [quote.id]);
    expect(rows[0]!.booking_id).toBeNull();
    expect(rows[0]!.converted_at, 'the quote was locked shut by a refused conversion').toBeNull();
    expect(rows[0]!.status).toBe('sent');
  });

  it('refuses a cancelled quote', async () => {
    const quote = await seedQuote({
      status: 'cancelled',
      customLines: [{ description: 'Withdrawn', amount: 9000 }],
    });
    const error = await refusalFor(quote.id);
    expect(error.status).toBe(409);
    expect(error.code).toBe('conflict');
  });

  it('refuses a DRAFT quote — the owner has not sent it and the total may be mid-edit', async () => {
    const quote = await seedQuote({
      status: 'draft',
      customLines: [{ description: 'Half-built offer', amount: 15000 }],
    });
    const before = await quoteBookingCount();
    const error = await refusalFor(quote.id);
    expect(error.status).toBe(409);
    expect(await quoteBookingCount(), 'a draft quote minted a payable booking').toBe(before);
  });

  it('refuses a quote in the terminal expired status, and one past valid_until', async () => {
    const stale = await seedQuote({
      status: 'expired',
      customLines: [{ description: 'Lapsed', amount: 15000 }],
    });
    expect((await refusalFor(stale.id)).status).toBe(409);

    const lapsed = await seedQuote({
      customLines: [{ description: 'Yesterday', amount: 15000 }],
      validUntilDays: -1,
    });
    expect((await refusalFor(lapsed.id)).status).toBe(409);
  });

  it('refuses a zero-total quote — the booking it would mint can never confirm', async () => {
    // api_create_payment skips the FX pin for a zero amount and append_payment_event carries an
    // explicit guard whose comment says "a zero-amount payment must never read as fully paid
    // (0 >= 0)". So the booking would sit in payment_pending until the sweep expired it, with the
    // quote already converted_at-locked. quotes.total_minor DEFAULTS to 0, so a never-priced draft
    // reaches this by default rather than by accident.
    const quote = await seedQuote({});
    const before = await quoteBookingCount();
    const error = await refusalFor(quote.id);
    expect(error.status).toBe(409);
    expect(await quoteBookingCount(), 'a zero-total quote minted a payable booking').toBe(before);
  });

  it('reports an unknown quote id as a 404, not a database error', async () => {
    const error = await refusalFor('00000000-0000-0000-0000-000000000000');
    expect(error.status).toBe(404);
    expect(error.code).toBe('not_found');
  });

  it('is executable by service_role only — anon and authenticated are revoked', async () => {
    const { rows } = await db.pg.query<{ anon: boolean; auth: boolean; sr: boolean }>(
      `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
              has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
              has_function_privilege('service_role', $1, 'EXECUTE') as sr`,
      ['public.api_convert_quote(jsonb)'],
    );
    expect(rows[0]!.anon, 'anon can mint a payable booking from any quote id').toBe(false);
    expect(
      rows[0]!.auth,
      'any signed-in account can mint a payable booking from any quote id',
    ).toBe(false);
    expect(rows[0]!.sr, 'the server can no longer convert a quote').toBe(true);
  });
});
