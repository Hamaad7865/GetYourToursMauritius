import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';

/**
 * The staff quote service against the REAL schema (20260909000000): real RLS, real CHECK constraints,
 * real foreign keys. tests/unit/admin-quotes.test.ts pins the arithmetic; this file proves the rows
 * that arithmetic produces are the rows the database actually ends up holding.
 *
 * What it is guarding, in the order it matters:
 *
 *  - the stored total is DERIVED. A browser-supplied `totalMinor` is discarded, because that figure is
 *    copied into `bookings.total_minor` at conversion and is what the guest's card is charged.
 *  - the total and the lines AGREE. saveQuote writes them in two statements and api_convert_quote
 *    refuses to mint a booking when they disagree (`quote_total_mismatch`), so a quote that fails this
 *    is one no guest can pay.
 *  - a CONVERTED quote is no longer editable. Its lines are the itemisation behind a charge, and
 *    api_convert_quote can re-arm a quote whose booking died — so an edited total would be charged to
 *    a returning guest against an offer they never saw.
 *  - RLS is the real gate. Staff write through the authenticated client; a signed-in customer gets
 *    nothing, and the module never reaches for the service-role key.
 */

const STAFF = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
const CUSTOMER = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';

/** The shim is the PostgREST query builder; `auth` is the half saveQuote uses for `created_by`. */
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

const { loadQuotes, loadQuote, saveQuote, cancelQuote } = await import('@/lib/admin/quotes');

const GUEST = {
  customerName: 'Marie Dupont',
  customerEmail: 'marie@example.com',
  customerPhone: '+230 5555 1234',
  validUntil: '2099-12-31',
};

describe('admin quote service (RLS + real schema)', () => {
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

  /** The quote row + the sum of its stored line subtotals, read as the owner (RLS bypassed). */
  async function readQuote(id: string): Promise<{
    ref: string;
    status: string;
    total_minor: number;
    created_by: string | null;
    lines_minor: number;
    line_count: number;
  }> {
    await db.asOwner();
    const { rows } = await db.pg.query<{
      ref: string;
      status: string;
      total_minor: number;
      created_by: string | null;
      lines_minor: number;
      line_count: number;
    }>(
      `select q.ref, q.status::text as status, q.total_minor::bigint as total_minor, q.created_by,
              coalesce((select sum(qi.subtotal_minor) from quote_items qi where qi.quote_id = q.id), 0)::bigint
                as lines_minor,
              (select count(*) from quote_items qi where qi.quote_id = q.id)::int as line_count
         from quotes q where q.id = $1`,
      [id],
    );
    return rows[0]!;
  }

  /**
   * Make the guest's payment land in the middle of a save: the next `update` against `quotes` stamps
   * `converted_at` immediately BEFORE its own statement runs. That is the window a read-then-write
   * guard leaves open, and the only way to prove the refusal rests on the write rather than on a
   * read that has already happened. Returns the undo.
   */
  function convertWhileSaving(quoteId: string): () => void {
    const shim = hoisted.shim!;
    const realFrom = shim.from.bind(shim);
    let armed = true;
    shim.from = (table: string) => {
      const builder = realFrom(table);
      if (!armed || table !== 'quotes') return builder;
      const realUpdate = builder.update.bind(builder);
      Object.assign(builder, {
        update(payload: Record<string, unknown>) {
          armed = false;
          const write = realUpdate(payload);
          const exec = write.then.bind(write);
          Object.assign(write, {
            then: (
              onfulfilled?: (value: unknown) => unknown,
              onrejected?: (e: unknown) => unknown,
            ) =>
              (async () => {
                await db.asOwner();
                await db.pg.query(
                  `update quotes set converted_at = now(), status = 'accepted' where id = $1`,
                  [quoteId],
                );
                await db.as({ sub: STAFF, role: 'authenticated' });
                return exec();
              })().then(onfulfilled, onrejected),
          });
          return write;
        },
      });
      return builder;
    };
    return () => {
      shim.from = realFrom;
    };
  }

  it('creates a draft quote whose stored total is the sum of its lines', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      introNote: 'As discussed on the phone.',
      internalNotes: 'margin is thin',
      items: [
        {
          kind: 'custom',
          description: 'Private skipper, full day',
          quantity: 2,
          unitAmountMinor: 5500,
        },
        { kind: 'custom', description: 'Fuel surcharge', quantity: 1, unitAmountMinor: 12000 },
      ],
    });

    const row = await readQuote(id);
    expect(row.ref).toMatch(/^Q[0-9A-F]{12}$/);
    expect(row.status).toBe('draft');
    expect(Number(row.total_minor)).toBe(23000);
    expect(
      Number(row.lines_minor),
      'the lines do not sum to the stored total — api_convert_quote refuses to charge this quote',
    ).toBe(Number(row.total_minor));
    // Who drafted it. `created_by` is nullable, so a missing session degrades to null rather than
    // failing the save — but a signed-in staff member must be recorded.
    expect(row.created_by).toBe(STAFF);
  });

  it('discards a total that arrived from the browser', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      totalMinor: 1,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });
    const row = await readQuote(id);
    expect(
      Number(row.total_minor),
      'the browser dictated the amount the guest would be charged',
    ).toBe(50000);
  });

  it('replaces the lines and re-derives the total when the quote is edited', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [
        { kind: 'custom', description: 'Day one', quantity: 1, unitAmountMinor: 10000 },
        { kind: 'custom', description: 'Day two', quantity: 1, unitAmountMinor: 10000 },
      ],
    });

    await db.as({ sub: STAFF, role: 'authenticated' });
    const sameId = await saveQuote({
      ...GUEST,
      id,
      items: [{ kind: 'custom', description: 'Day one only', quantity: 1, unitAmountMinor: 10000 }],
    });
    expect(sameId).toBe(id);

    const row = await readQuote(id);
    expect(row.line_count, 'the removed line survived the edit').toBe(1);
    expect(Number(row.total_minor)).toBe(10000);
    expect(Number(row.lines_minor)).toBe(Number(row.total_minor));
  });

  it('reads a quote back with its lines in the owner’s order', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [
        { kind: 'custom', description: 'First', quantity: 1, unitAmountMinor: 1000 },
        { kind: 'custom', description: 'Second', quantity: 2, unitAmountMinor: 2000 },
        { kind: 'custom', description: 'Third', quantity: 1, unitAmountMinor: 3000 },
      ],
    });

    await db.as({ sub: STAFF, role: 'authenticated' });
    const detail = await loadQuote(id);
    expect(detail).not.toBeNull();
    expect(detail!.totalMinor).toBe(8000);
    expect(detail!.customerName).toBe('Marie Dupont');
    // A calendar day, not an instant: api_convert_quote compares it against current_date.
    expect(detail!.validUntil).toBe('2099-12-31');
    expect(detail!.internalNotes ?? null).toBeNull();
    expect(detail!.items.map((item) => item.description)).toEqual(['First', 'Second', 'Third']);
    expect(detail!.items.map((item) => item.subtotalMinor)).toEqual([1000, 4000, 3000]);

    const list = await loadQuotes(50);
    expect(list.some((quote) => quote.id === id)).toBe(true);
    // Newest first — the list is what the owner scans for the quote they just drafted.
    const created = list.map((quote) => quote.createdAt);
    expect([...created].sort().reverse()).toEqual(created);
  });

  it('returns null for a quote that is not there, rather than throwing at the screen', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(loadQuote('44444444-4444-4444-4444-444444444444')).resolves.toBeNull();
  });

  it('refuses to rewrite a quote that has already been converted', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });

    // The pay route's conversion, in the one column the guard may read: booking_id is `on delete set
    // null` and an erasure clears it, so `converted_at` is the durable record (migration section 4).
    await db.asOwner();
    await db.pg.query(`update quotes set converted_at = now(), status = 'accepted' where id = $1`, [
      id,
    ]);

    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      saveQuote({
        ...GUEST,
        id,
        items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 5 }],
      }),
      'a charged quote was re-priced from the editor',
    ).rejects.toThrow(/converted/i);

    const row = await readQuote(id);
    expect(Number(row.total_minor), 'the edit was half-applied before it was refused').toBe(50000);
    expect(row.line_count).toBe(1);
    expect(Number(row.lines_minor)).toBe(50000);
  });

  it('refuses a blank line description without touching the stored quote', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 70000 }],
    });

    // `quote_item_shape` requires a non-catalogue line to carry a description, and a whitespace-only
    // one trims to null. Refused at INSERT it would be refused LAST — after the new total is written
    // and the old lines are deleted — leaving the guest holding a link to a quote whose total no
    // longer has any itemisation behind it, which api_convert_quote will not charge.
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      saveQuote({
        ...GUEST,
        id,
        items: [
          { kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 70000 },
          { kind: 'custom', description: '   ', quantity: 1, unitAmountMinor: 5000 },
        ],
      }),
    ).rejects.toThrow(/description/i);

    const row = await readQuote(id);
    expect(Number(row.total_minor), 'the total was re-priced by an edit that was refused').toBe(
      70000,
    );
    expect(row.line_count, 'the itemisation behind the stored total was deleted').toBe(1);
    expect(Number(row.lines_minor)).toBe(70000);
  });

  it('refuses a catalogue line with no occurrence without touching the stored quote', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 70000 }],
    });

    // The other half of `quote_item_shape`, and the same failure mode as the blank description: the
    // editor switches a line's kind in place, so a line switched TO catalogue before a slot is picked
    // carries null ids. Refused at INSERT it would be refused LAST — and because the lines go in as
    // one multi-row insert, the bad line takes the good one with it, leaving the guest's link
    // pointing at a re-priced total with nothing itemised behind it.
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      saveQuote({
        ...GUEST,
        id,
        items: [
          { kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 70000 },
          { kind: 'catalogue', priceLabel: 'Adult', quantity: 2, unitAmountMinor: 5000 },
        ],
      }),
    ).rejects.toThrow(/occurrence/i);

    const row = await readQuote(id);
    expect(Number(row.total_minor), 'the total was re-priced by an edit that was refused').toBe(
      70000,
    );
    expect(row.line_count, 'the itemisation behind the stored total was deleted').toBe(1);
    expect(Number(row.lines_minor)).toBe(70000);
  });

  it('refuses an edit that raced the guest’s payment', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });

    // The conversion lands in the window a read-then-write guard leaves open. It has to be the
    // WRITE that refuses: api_convert_quote re-arms a quote whose booking later dies, so a total
    // rewritten here is a figure a returning guest is charged against an offer they never saw.
    await db.as({ sub: STAFF, role: 'authenticated' });
    const restore = convertWhileSaving(id);
    try {
      await expect(
        saveQuote({
          ...GUEST,
          id,
          items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 5 }],
        }),
      ).rejects.toThrow(/converted/i);
    } finally {
      restore();
    }

    const row = await readQuote(id);
    expect(Number(row.total_minor), 'a converted quote was re-priced under the guard').toBe(50000);
    expect(row.line_count).toBe(1);
    expect(Number(row.lines_minor)).toBe(50000);
  });

  it('withdraws an offer by cancelling it', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });

    await db.as({ sub: STAFF, role: 'authenticated' });
    await cancelQuote(id);

    const row = await readQuote(id);
    // api_convert_quote raises `quote_cancelled` on this status — the link stops being payable.
    expect(row.status).toBe('cancelled');
  });

  it('refuses to withdraw a quote the guest has already paid for', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });

    await db.asOwner();
    await db.pg.query(`update quotes set converted_at = now(), status = 'accepted' where id = $1`, [
      id,
    ]);

    // 'cancelled' means "the offer was withdrawn". On a quote that was taken and paid it is simply
    // false, there is no un-cancel, and it would sit beside a booking_id and a converted_at that say
    // the opposite. Cancelling or refunding the BOOKING is the bookings screen's job.
    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      cancelQuote(id),
      'the offer the guest accepted now reads as withdrawn',
    ).rejects.toThrow(/converted/i);

    const row = await readQuote(id);
    expect(row.status).toBe('accepted');
  });

  it('gives a signed-in customer no way to draft a quote (RLS)', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await expect(
      saveQuote({
        ...GUEST,
        customerEmail: 'forged@example.com',
        items: [{ kind: 'custom', description: 'Forged', quantity: 1, unitAmountMinor: 100 }],
      }),
      'a customer account drafted a quote',
    ).rejects.toThrow(/row-level security/i);

    await db.asOwner();
    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from quotes where customer_email = 'forged@example.com'`,
    );
    expect(rows[0]!.n).toBe(0);
  });

  it('gives a signed-in customer no way to edit or withdraw a staff quote (RLS)', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 90000 }],
    });

    // The INSERT path above is refused by RLS RAISING. The edit and cancel paths are not: RLS
    // refuses an UPDATE by matching zero rows, so the customer lands in updateUnconvertedQuote's
    // zero-row branch — and its follow-up read is refused too, so the quote reads as absent. Both
    // halves are the contract: treating zero rows as success would let a customer withdraw an offer
    // silently, and reporting the row after reading it back would tell them which quote ids exist.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const edit = saveQuote({
      ...GUEST,
      id,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 1 }],
    });
    await expect(edit, 'a customer account re-priced a staff quote').rejects.toThrow();
    const editMessage = await edit.catch((error: unknown) => (error as Error).message);

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const cancel = cancelQuote(id);
    await expect(cancel, 'a customer account withdrew a staff quote').rejects.toThrow();
    const cancelMessage = await cancel.catch((error: unknown) => (error as Error).message);

    // …and the refusal must read identically for a quote that does not exist at all, or it is an
    // oracle a signed-up guest can walk over other people's offers with.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const absentMessage = await cancelQuote('44444444-4444-4444-4444-444444444444').catch(
      (error: unknown) => (error as Error).message,
    );
    expect(editMessage, 'the refusal says a forbidden quote exists').toBe(absentMessage);
    expect(cancelMessage, 'the refusal says a forbidden quote exists').toBe(absentMessage);

    const row = await readQuote(id);
    expect(row.status, 'a customer withdrew an offer they do not own').toBe('draft');
    expect(Number(row.total_minor), 'a customer re-priced an offer they do not own').toBe(90000);
    expect(row.line_count).toBe(1);
    expect(Number(row.lines_minor)).toBe(90000);
  });
});
