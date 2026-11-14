import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';

/**
 * The quotes worklist's reads against the REAL schema (back-office redesign, phase 1): real RLS and
 * the real `bookings` money columns (20260912000000). tests/unit/admin-quote-worklist.test.ts pins the
 * grouping rules; this proves the rows those rules are fed are the rows the database holds.
 *
 *  - "balance to collect" reads the converted booking's deposit, balance and total in a SECOND read
 *    (`.in('id', …)`), because PostgREST embeds are not used here and the harness has none.
 *  - a converted quote whose booking row is gone reads `booking: null`, never "paid".
 *  - the editor's "add an item" history and the returning-guest hint read only what staff RLS shows,
 *    and the guest lookup treats `_` and `%` in an email as letters, not wildcards.
 *  - a signed-in customer reads nothing through any of them.
 */

const STAFF = 'b4b4b4b4-b4b4-b4b4-b4b4-b4b4b4b4b4b4';
const CUSTOMER = 'c5c5c5c5-c5c5-c5c5-c5c5-c5c5c5c5c5c5';

type QuotesShim = SupabaseShim & {
  auth: {
    getSession(): Promise<{ data: { session: { access_token: string; user: { id: string } } } }>;
  };
};

const hoisted = vi.hoisted(() => ({ shim: null as QuotesShim | null }));
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => {
    if (!hoisted.shim) throw new Error('shim not initialised');
    return hoisted.shim;
  },
}));

const {
  loadQuotes,
  loadQuote,
  saveQuote,
  loadQuoteLineBriefs,
  loadCustomLineHistory,
  loadGuestHistory,
} = await import('@/lib/admin/quotes');
const { quoteStage } = await import('@/components/admin/quotes/worklist');

function guest(email: string) {
  return {
    customerName: 'Lukas Weber',
    customerEmail: email,
    customerPhone: '+49 170 555 0142',
    validUntil: '2099-12-31',
  };
}

describe('quotes worklist reads (RLS + real schema)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, CUSTOMER]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Owner', 'admin')`, [
      STAFF,
    ]);
    await db.pg.query(
      `insert into profiles (id, full_name, role) values ($1, 'Guest', 'customer')`,
      [CUSTOMER],
    );
    hoisted.shim = {
      ...makeSupabaseShim(db.pg),
      auth: {
        getSession: async () => ({
          data: { session: { access_token: 'staff-token', user: { id: STAFF } } },
        }),
      },
    };
  });

  afterAll(async () => {
    await db.close();
  });

  /** A booking with the money columns set, minted as the owner (only api_convert_quote mints one). */
  async function mintBooking(input: {
    email: string;
    status: string;
    paymentState: string;
    totalMinor: number;
    depositMinor: number;
    balanceDueMinor: number;
  }): Promise<string> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into bookings (customer_name, customer_email, total_minor, deposit_minor,
                             balance_due_minor, status, payment_state)
         values ('Lukas Weber', $1, $2, $3, $4, $5::booking_status, $6::payment_state)
       returning id`,
      [
        input.email,
        input.totalMinor,
        input.depositMinor,
        input.balanceDueMinor,
        input.status,
        input.paymentState,
      ],
    );
    return rows[0]!.id;
  }

  /** Stamp the conversion as api_convert_quote does: booking_id + converted_at + 'accepted'. */
  async function linkConversion(quoteId: string, bookingId: string | null): Promise<void> {
    await db.asOwner();
    await db.pg.query(
      `update quotes set converted_at = now(), status = 'accepted', booking_id = $2 where id = $1`,
      [quoteId, bookingId],
    );
  }

  async function draft(email: string, description: string, unitAmountMinor: number) {
    await db.as({ sub: STAFF, role: 'authenticated' });
    return saveQuote({
      ...guest(email),
      items: [{ kind: 'custom', description, quantity: 1, unitAmountMinor }],
    });
  }

  it('reads each converted quote’s booking money, so a part-paid deposit is a balance to collect', async () => {
    const owing = await draft('owing@example.com', 'Private south tour', 18000);
    const paidInFull = await draft('full@example.com', 'Catamaran day', 9000);
    const open = await draft('open@example.com', 'Sunset dinner', 7000);
    await linkConversion(
      owing,
      await mintBooking({
        email: 'owing@example.com',
        status: 'confirmed',
        paymentState: 'paid',
        totalMinor: 18000,
        depositMinor: 4500,
        balanceDueMinor: 13500,
      }),
    );
    await linkConversion(
      paidInFull,
      await mintBooking({
        email: 'full@example.com',
        status: 'confirmed',
        paymentState: 'paid',
        totalMinor: 9000,
        depositMinor: 9000,
        balanceDueMinor: 0,
      }),
    );

    await db.as({ sub: STAFF, role: 'authenticated' });
    const rows = await loadQuotes();
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(owing)!.booking).toEqual({
      status: 'confirmed',
      totalMinor: 18000,
      depositMinor: 4500,
      balanceDueMinor: 13500,
    });
    expect(quoteStage(byId.get(owing)!)).toMatchObject({
      group: 'balance',
      balanceOwedMinor: 13500,
      paidMinor: 4500,
    });
    expect(quoteStage(byId.get(paidInFull)!)).toMatchObject({ group: 'done', label: 'Paid' });
    // An unconverted quote's booking is not read at all.
    expect(byId.get(open)!.booking).toBeUndefined();
    expect(quoteStage(byId.get(open)!).group).toBe('draft');

    // The editor reads the same summary beside the status it already had.
    await db.as({ sub: STAFF, role: 'authenticated' });
    const detail = await loadQuote(owing);
    expect(detail!.bookingStatus).toBe('confirmed');
    expect(detail!.booking).toMatchObject({ balanceDueMinor: 13500 });
  });

  it('reads a converted quote whose booking row is gone as no booking, never as paid', async () => {
    const id = await draft('erased@example.com', 'Helicopter flight', 42700);
    // An erasure hard-deletes an unpaid booking and the FK nulls booking_id; converted_at stays.
    await linkConversion(id, null);

    await db.as({ sub: STAFF, role: 'authenticated' });
    const row = (await loadQuotes()).find((r) => r.id === id)!;
    expect(row.booking).toBeNull();
    expect(quoteStage(row)).toMatchObject({ group: 'done', label: 'Booking closed' });
  });

  it('lists every quote line briefly, in each quote’s own order', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...guest('lines@example.com'),
      items: [
        { kind: 'custom', description: 'Dolphin swim', quantity: 2, unitAmountMinor: 6000 },
        { kind: 'custom', description: 'Lunch on the island', quantity: 2, unitAmountMinor: 2500 },
      ],
    });
    await db.as({ sub: STAFF, role: 'authenticated' });
    const mine = (await loadQuoteLineBriefs())
      .filter((b) => b.quoteId === id)
      .sort((a, b) => a.position - b.position);
    expect(mine.map((b) => b.description)).toEqual(['Dolphin swim', 'Lunch on the island']);
  });

  it('remembers hand-typed lines with their price and when they were last quoted', async () => {
    await draft('history@example.com', 'Private sega night', 15500);
    await db.as({ sub: STAFF, role: 'authenticated' });
    const history = await loadCustomLineHistory();
    const entry = history.find((h) => h.description === 'Private sega night');
    expect(entry).toMatchObject({ unitAmountMinor: 15500 });
    expect(Number.isNaN(Date.parse(entry!.quotedAt))).toBe(false);
  });

  it('finds a returning guest by email in any case, and treats _ and % as letters', async () => {
    const first = await draft('a_b@example.com', 'Island hop', 10000);
    const second = await draft('A_B@Example.com', 'Island hop again', 10000);
    // `_` is a one-character wildcard to ilike: unescaped, this stranger would be counted.
    await draft('axb@example.com', 'Somebody else', 10000);
    await mintBooking({
      email: 'a_b@example.com',
      status: 'confirmed',
      paymentState: 'paid',
      totalMinor: 10000,
      depositMinor: 10000,
      balanceDueMinor: 0,
    });
    // An abandoned checkout is not a booking.
    await mintBooking({
      email: 'a_b@example.com',
      status: 'expired',
      paymentState: 'pending',
      totalMinor: 10000,
      depositMinor: 0,
      balanceDueMinor: 0,
    });

    await db.as({ sub: STAFF, role: 'authenticated' });
    const found = await loadGuestHistory('  A_b@EXAMPLE.com ');
    expect(found.quotes.map((q) => q.id).sort()).toEqual([first, second].sort());
    expect(found.bookings).toHaveLength(1);
  });

  it('gives a signed-in customer nothing through any of these reads (RLS)', async () => {
    await draft('rls@example.com', 'Private charter', 90000);
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    expect(await loadQuotes()).toEqual([]);
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    expect(await loadQuoteLineBriefs()).toEqual([]);
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    expect(await loadCustomLineHistory()).toEqual([]);
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    expect(await loadGuestHistory('rls@example.com')).toEqual({ quotes: [], bookings: [] });
  });
});
