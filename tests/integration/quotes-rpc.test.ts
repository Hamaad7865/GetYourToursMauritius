import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteServiceRoleRpc } from '../db/rpc';
import type { DbRpc } from '@/lib/db/rpc';

/**
 * api_convert_quote (20260909000000_quotes) — the step that mints a PAYABLE booking.
 *
 * Everything downstream of it (Peach checkout → HMAC webhook → append_payment_event → confirmation
 * + VAT invoice) is the untouched money path, so this function is the only new code standing between
 * a staff-drafted offer and a real charge. Three properties are load-bearing:
 *
 *  - it produces exactly ONE booking, in `payment_pending` with `source = 'quote'`, carrying the
 *    quote's total and its non-catalogue lines (catalogue lines take the hold/capacity path in the
 *    pay route, so this function deliberately copies only the custom/rental ones);
 *  - a quote converts ONCE. The guard reads `converted_at`, never `booking_id` — section 4 of the
 *    migration exists because api_erase_user hard-deletes unpaid bookings and the `on delete set
 *    null` FK silently clears `booking_id`, which would re-arm a converted quote to mint a second
 *    payable booking. Both columns are written together (quote_converted_shape enforces it);
 *  - it is SECURITY DEFINER with no in-function caller guard, so its EXECUTE grant IS its
 *    authorization. `revoke ... from public` alone does not strip Supabase's stock direct grants to
 *    anon/authenticated — the omission that shipped two live holes from this repo (api_booking_receipt,
 *    api_pending_payment_checkouts) — so the revoke has to name all three roles.
 */

const OWNER_CUSTOMER = { name: 'Charter Guest', email: 'charter@example.com' };

let seq = 0;

interface CustomLine {
  description: string;
  amount: number;
}

interface SeededQuote {
  id: string;
  ref: string;
}

describe('api_convert_quote', () => {
  let db: TestDb;
  let callRpc: DbRpc['rpc'];

  /**
   * A quote + its lines, written directly as the owner (the admin service layer that will do this
   * for real is a later task). `total_minor` is the sum of the seeded lines, exactly as the editor
   * will persist it, because the conversion copies that figure onto the booking.
   */
  async function seedQuote(
    input: { status?: string; customLines?: CustomLine[]; validUntilDays?: number } = {},
  ): Promise<SeededQuote> {
    seq += 1;
    const ref = `Q-CONV-${seq}`;
    const lines = input.customLines ?? [];
    const total = lines.reduce((sum, line) => sum + line.amount, 0);
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, customer_phone, status, valid_until,
                           total_minor)
       values ($1, $2, $3, '+230 5555 0000', $4::quote_status,
               current_date + ($5 || ' days')::interval, $6)
       returning id`,
      [
        ref,
        OWNER_CUSTOMER.name,
        OWNER_CUSTOMER.email,
        input.status ?? 'sent',
        String(input.validUntilDays ?? 7),
        total,
      ],
    );
    const id = rows[0]!.id;
    for (const [index, line] of lines.entries()) {
      await db.pg.query(
        `insert into quote_items
           (quote_id, position, kind, description, starts_at, quantity, unit_amount_minor,
            subtotal_minor)
         values ($1, $2, 'custom', $3, now() + interval '10 days', 1, $4, $4)`,
        [id, index + 1, line.description, line.amount],
      );
    }
    return { id, ref };
  }

  beforeAll(async () => {
    db = await createTestDb();
    callRpc = pgliteServiceRoleRpc(db.pg).rpc;
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
      total_minor: number;
      customer_email: string;
    }>('api_convert_quote', { quoteId: quote.id });

    expect(booking.status).toBe('payment_pending');
    expect(booking.source).toBe('quote');
    expect(booking.total_minor).toBe(12000);
    expect(booking.customer_email).toBe(OWNER_CUSTOMER.email);

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

  it('refuses to convert the same quote twice', async () => {
    const quote = await seedQuote({ customLines: [{ description: 'Charter', amount: 50000 }] });
    await callRpc('api_convert_quote', { quoteId: quote.id });
    await expect(callRpc('api_convert_quote', { quoteId: quote.id })).rejects.toThrow(
      /already converted/i,
    );

    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from bookings where total_minor = 50000 and source = 'quote'`,
    );
    expect(rows[0]!.n, 'a second payable booking was minted for one quote').toBe(1);
  });

  it('refuses a cancelled quote', async () => {
    const quote = await seedQuote({ status: 'cancelled' });
    await expect(callRpc('api_convert_quote', { quoteId: quote.id })).rejects.toThrow(/cancelled/i);
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
