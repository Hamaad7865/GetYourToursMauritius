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

const { loadQuotes, loadQuote, saveQuote, cancelQuote, reinstateQuote, duplicateQuote } =
  await import('@/lib/admin/quotes');

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
    currency: string;
    locale: string;
    intro_note: string | null;
    lines_minor: number;
    line_count: number;
  }> {
    await db.asOwner();
    const { rows } = await db.pg.query<{
      ref: string;
      status: string;
      total_minor: number;
      created_by: string | null;
      currency: string;
      locale: string;
      intro_note: string | null;
      lines_minor: number;
      line_count: number;
    }>(
      `select q.ref, q.status::text as status, q.total_minor::bigint as total_minor, q.created_by,
              q.currency, q.locale::text as locale, q.intro_note,
              coalesce((select sum(qi.subtotal_minor) from quote_items qi where qi.quote_id = q.id), 0)::bigint
                as lines_minor,
              (select count(*) from quote_items qi where qi.quote_id = q.id)::int as line_count
         from quotes q where q.id = $1`,
      [id],
    );
    return rows[0]!;
  }

  /**
   * A booking in a named state, minted as the owner. The quote module never inserts one — only
   * api_convert_quote does — so this stands in for the conversion's own INSERT.
   */
  async function mintBooking(
    status: string,
    paymentState: string,
  ): Promise<{ id: string; ref: string }> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string; ref: string }>(
      `insert into bookings (customer_name, customer_email, total_minor, status, payment_state)
         values ('Marie Dupont', 'marie@example.com', 50000, $1::booking_status, $2::payment_state)
       returning id, ref`,
      [status, paymentState],
    );
    return rows[0]!;
  }

  /**
   * Stamp the conversion exactly as api_convert_quote does: `booking_id` AND `converted_at`
   * together, which is the section-4 contract (`quote_converted_shape` makes forgetting one
   * impossible) plus the 'accepted' status the whitelist expects on a re-arm.
   */
  async function linkConversion(quoteId: string, bookingId: string): Promise<void> {
    await db.asOwner();
    await db.pg.query(
      `update quotes set converted_at = now(), status = 'accepted', booking_id = $2 where id = $1`,
      [quoteId, bookingId],
    );
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

  /**
   * The OTHER side of the same window: the conversion lands AFTER the guarded UPDATE has matched,
   * while the lines are being replaced. The guard is in the UPDATE's WHERE clause, so it cannot see
   * this one — and the two statements that follow it (the DELETE and the re-insert) carry no guard at
   * all. Armed on the first `quote_items` write. Returns the undo.
   */
  function convertWhileReplacingLines(quoteId: string, bookingId: string): () => void {
    const shim = hoisted.shim!;
    const realFrom = shim.from.bind(shim);
    let armed = true;
    shim.from = (table: string) => {
      const builder = realFrom(table);
      if (!armed || table !== 'quote_items') return builder;
      const realDelete = builder.delete.bind(builder);
      Object.assign(builder, {
        delete() {
          armed = false;
          const write = realDelete();
          const exec = write.then.bind(write);
          Object.assign(write, {
            then: (
              onfulfilled?: (value: unknown) => unknown,
              onrejected?: (e: unknown) => unknown,
            ) =>
              (async () => {
                await db.asOwner();
                await db.pg.query(
                  `update quotes set converted_at = now(), status = 'accepted', booking_id = $2
                     where id = $1`,
                  [quoteId, bookingId],
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

  /**
   * The OTHER way the post-write guard finds nothing: the quote is GONE. api_erase_user_data
   * hard-deletes an unconverted quote outright (migration section 4, `delete from quotes … where
   * converted_at is null and booking_id is null`), so an erasure landing after the new lines are
   * inserted leaves saveQuote's re-assert with no row to match — indistinguishable, to a blind
   * UPDATE, from a quote the guest just paid for. Armed on the `quote_items` INSERT and fired AFTER
   * it, because a quote deleted any earlier takes the FK with it and the insert fails first.
   * Returns the undo.
   */
  function eraseWhileReplacingLines(quoteId: string): () => void {
    const shim = hoisted.shim!;
    const realFrom = shim.from.bind(shim);
    let armed = true;
    shim.from = (table: string) => {
      const builder = realFrom(table);
      if (!armed || table !== 'quote_items') return builder;
      const realInsert = builder.insert.bind(builder);
      Object.assign(builder, {
        insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
          armed = false;
          const write = realInsert(payload);
          const exec = write.then.bind(write);
          Object.assign(write, {
            then: (
              onfulfilled?: (value: unknown) => unknown,
              onrejected?: (e: unknown) => unknown,
            ) =>
              (async () => {
                const result = await exec();
                await db.asOwner();
                await db.pg.query(`delete from quotes where id = $1`, [quoteId]);
                await db.as({ sub: STAFF, role: 'authenticated' });
                return result;
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

  it('keeps a French quote French when the edit form does not send the locale back', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      locale: 'fr',
      items: [{ kind: 'custom', description: 'Bateau privé', quantity: 1, unitAmountMinor: 80000 }],
    });
    expect(await readQuote(id).then((row) => row.locale)).toBe('fr');

    // api_convert_quote copies quotes.locale into bookings.locale, and that is what picks the
    // language of the confirmation email and the VAT invoice. So an edit that simply does not
    // round-trip the field — a re-price from a form that never had a locale input — must not turn a
    // French offer into an English invoice. Same for `currency`: defaulting it on every write is the
    // same silent overwrite, it just happens to have only one legal value today.
    await db.as({ sub: STAFF, role: 'authenticated' });
    await saveQuote({
      ...GUEST,
      id,
      items: [{ kind: 'custom', description: 'Bateau privé', quantity: 1, unitAmountMinor: 75000 }],
    });

    const row = await readQuote(id);
    expect(row.locale, 'the guest reads the offer in French and is invoiced in English').toBe('fr');
    expect(row.currency).toBe('EUR');
    expect(Number(row.total_minor), 'the re-price did not land').toBe(75000);

    // …and a locale the caller DOES supply still wins: this is "omitted means untouched", not
    // "locale is immutable".
    await db.as({ sub: STAFF, role: 'authenticated' });
    await saveQuote({
      ...GUEST,
      id,
      locale: 'en',
      items: [{ kind: 'custom', description: 'Private boat', quantity: 1, unitAmountMinor: 75000 }],
    });
    expect(await readQuote(id).then((r) => r.locale)).toBe('en');
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

  it('names the booking when a conversion lands while the lines are being replaced', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });

    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string; ref: string }>(
      `insert into bookings (customer_name, customer_email, total_minor)
         values ('Marie Dupont', 'marie@example.com', 50000) returning id, ref`,
    );
    const booking = rows[0]!;

    // The guarded UPDATE matches — the quote really was unconverted when it ran — and the guest pays
    // a heartbeat later, while the lines are being rewritten. api_convert_quote copies the lines AS
    // THEY THEN STAND into booking_custom_items and stamps converted_at; saveQuote then rewrites
    // them anyway. `quote_total_mismatch` is no backstop for this: an edit that only reworded a
    // description or moved a line's date converts cleanly and diverges silently afterwards.
    await db.as({ sub: STAFF, role: 'authenticated' });
    const restore = convertWhileReplacingLines(id, booking.id);
    let message = '';
    try {
      message = await saveQuote({
        ...GUEST,
        id,
        items: [
          {
            kind: 'custom',
            description: 'Charter, revised wording',
            quantity: 1,
            unitAmountMinor: 50000,
          },
        ],
      }).then(
        () => '',
        (error: unknown) => (error as Error).message,
      );
    } finally {
      restore();
    }

    // The lines have already been rewritten by the time this is discovered, so silence IS the harm:
    // the operator has to be told, and told which booking to reconcile.
    expect(message, 'the save reported success after the quote had been converted').not.toBe('');
    expect(message, 'the refusal does not name the booking the operator must reconcile').toContain(
      booking.ref,
    );

    const row = await readQuote(id);
    expect(row.status).toBe('accepted');
    expect(row.line_count).toBe(1);
  });

  it('says the quote is gone, not that the guest paid, when an erasure deletes it mid-save', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });

    // A GDPR erasure for this guest lands while the lines are being replaced. Nobody paid: the row
    // is deleted precisely BECAUSE it was unconverted. The post-write guard sees the same zero rows
    // either way, so it must read what is actually there before it names a cause — telling the
    // operator "the guest paid, reconcile the booking" sends them to look for a booking that was
    // never minted, and buries the one fact that matters, which is that the quote is gone.
    await db.as({ sub: STAFF, role: 'authenticated' });
    const restore = eraseWhileReplacingLines(id);
    let message = '';
    try {
      message = await saveQuote({
        ...GUEST,
        id,
        items: [
          { kind: 'custom', description: 'Charter, revised', quantity: 1, unitAmountMinor: 60000 },
        ],
      }).then(
        () => '',
        (error: unknown) => (error as Error).message,
      );
    } finally {
      restore();
    }

    expect(message, 'the save reported success after the quote had been deleted').not.toBe('');
    expect(message, 'the operator was not told the quote is gone').toMatch(/no longer exists/i);
    expect(
      message,
      'a deleted quote was reported as a payment the operator must reconcile',
    ).not.toMatch(/paid|booking/i);

    await db.asOwner();
    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from quotes where id = $1`,
      [id],
    );
    expect(rows[0]!.n, 'the erasure did not actually delete the quote').toBe(0);
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

    const booking = await mintBooking('confirmed', 'paid');
    await linkConversion(id, booking.id);

    // 'cancelled' means "the offer was withdrawn". On a quote that was taken and PAID it is simply
    // false, there is no un-cancel, and it would sit beside a booking_id and a converted_at that say
    // the opposite. Cancelling or refunding the BOOKING is the bookings screen's job.
    await db.as({ sub: STAFF, role: 'authenticated' });
    const message = await cancelQuote(id).then(
      () => '',
      (error: unknown) => (error as Error).message,
    );
    expect(message, 'the offer the guest paid for now reads as withdrawn').not.toBe('');
    expect(message, 'the refusal does not name the booking the operator must act on').toContain(
      booking.ref,
    );

    const row = await readQuote(id);
    expect(row.status).toBe('accepted');
  });

  it('refuses to withdraw a quote whose booking is still alive and unpaid', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });

    // The guest is at Peach with the card in their hand. Withdrawing the offer would not stop that
    // charge — api_create_payment answers to the BOOKING, not the quote — so the quote must not be
    // made to read "withdrawn" beside a booking that is about to confirm. The booking is the thing
    // to cancel, and once it is cancelled the withdrawal below goes through.
    const booking = await mintBooking('payment_pending', 'pending');
    await linkConversion(id, booking.id);

    await db.as({ sub: STAFF, role: 'authenticated' });
    const message = await cancelQuote(id).then(
      () => '',
      (error: unknown) => (error as Error).message,
    );
    expect(message, 'an offer the guest may be paying for right now was withdrawn').not.toBe('');
    expect(message, 'the refusal does not name the booking the operator must act on').toContain(
      booking.ref,
    );
    expect(await readQuote(id).then((row) => row.status)).toBe('accepted');

    // …and the instruction the refusal gives has to actually work. Cancelling the booking is what
    // sets status='cancelled', payment_state='pending' — the re-arm precondition — so if the
    // withdrawal were still refused here the operator's only route out would make the guest's link
    // MORE payable, not less.
    await db.asOwner();
    await db.pg.query(`update bookings set status = 'cancelled' where id = $1`, [booking.id]);

    await db.as({ sub: STAFF, role: 'authenticated' });
    await cancelQuote(id);
    expect(await readQuote(id).then((row) => row.status)).toBe('cancelled');
  });

  it('withdraws an offer whose converted booking died without ever taking money', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 500000 }],
    });

    // The guest converted, went to fetch their card and never came back, so run_booking_maintenance
    // expired the booking. api_convert_quote RE-ARMS exactly this quote (quotes-rpc.test.ts,
    // 're-arms a quote whose booking died without ever taking money'), so the link in the guest's
    // inbox is payable again until valid_until passes — and by then the boat has been resold. A
    // guard on converted_at alone refuses every write to the row, so the offer could not be
    // withdrawn by anyone, nor even have its validity shortened.
    const booking = await mintBooking('expired', 'pending');
    await linkConversion(id, booking.id);

    await db.as({ sub: STAFF, role: 'authenticated' });
    await cancelQuote(id);

    const row = await readQuote(id);
    // api_convert_quote's re-arm branch runs BEFORE the status whitelist, so from here the quote
    // raises `quote_cancelled` rather than minting a second payable booking.
    expect(row.status, 'a live offer could be withdrawn by nobody').toBe('cancelled');
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

  it('gives a signed-in customer no way to READ a staff quote (RLS)', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      introNote: 'Dear Marie, here is the private boat day we discussed.',
      internalNotes: 'she pushed hard on price — hold at this figure',
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 90000 }],
    });

    // `authenticated` is the role a signed-up GUEST actually holds — not `anon`, which
    // quotes-schema.test.ts pins — and `loadQuotes` takes no filter at all: every row it returns
    // carries a name, an email, a phone number and the staff-only internal notes. This repo has
    // shipped a visibility leak three times on the assumption that a policy does what it reads like
    // (docs/handbook/landmines.md), so the read side is asserted rather than inferred from the
    // write side.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    expect(await loadQuotes(50), 'a signed-in guest can list every quote in the business').toEqual(
      [],
    );

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    expect(
      await loadQuote(id),
      'a signed-in guest can read another guest’s quote by id',
    ).toBeNull();
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

  /* ------------------------------------------------------------------------------------------- */
  /* Reinstating a withdrawn offer                                                                 */
  /*                                                                                               */
  /* Withdrawing used to be a one-way door, so the house habit was to withdraw and then retype the  */
  /* whole offer for what was usually a one-line change. These pin the door open — and pin shut the */
  /* two ways it must not open: onto a booking that took money, and onto a live link.               */
  /* ------------------------------------------------------------------------------------------- */

  /** `token_hash` is what makes a link work; sending sets it, reinstating must clear it. */
  async function readLinkState(
    id: string,
  ): Promise<{ tokenHash: string | null; sentAt: string | null }> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ token_hash: string | null; sent_at: string | null }>(
      `select token_hash, sent_at::text as sent_at from quotes where id = $1`,
      [id],
    );
    return { tokenHash: rows[0]!.token_hash, sentAt: rows[0]!.sent_at };
  }

  /** What the send route leaves behind: a stored hash, a `sent` status and a send time. */
  async function markSent(id: string): Promise<void> {
    await db.asOwner();
    await db.pg.query(
      `update quotes set status = 'sent', token_hash = 'stored-hash-of-the-emailed-token', sent_at = now()
        where id = $1`,
      [id],
    );
  }

  it('reinstates a withdrawn quote as a draft, with the withdrawn link left dead', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });
    await markSent(id);

    await db.as({ sub: STAFF, role: 'authenticated' });
    await cancelQuote(id);
    await db.as({ sub: STAFF, role: 'authenticated' });
    await reinstateQuote(id);

    const row = await readQuote(id);
    // 'draft', not 'sent': there is no link any more, and api_convert_quote's whitelist is
    // ('sent', 'accepted'), so this is both the honest state and the unpayable one.
    expect(row.status, 'a reinstated quote did not come back as a draft').toBe('draft');

    const link = await readLinkState(id);
    expect(
      link.tokenHash,
      'reinstating republished the offer at the URL the guest was already holding',
    ).toBeNull();
    expect(
      link.sentAt,
      'reinstating erased the record that this offer had once been emailed',
    ).not.toBeNull();

    // The lines are the whole point: this is the retyping the operator no longer has to do.
    expect(row.line_count).toBe(1);
    expect(Number(row.lines_minor)).toBe(50000);
    expect(Number(row.total_minor)).toBe(50000);
  });

  it('reinstates a quote whose booking died without ever taking money', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });

    // The guest opened checkout and wandered off; the maintenance sweep expired the booking. The
    // gate is the BOOKING's state, never `converted_at` — gating on the latter would refuse every
    // write to a quote api_convert_quote is perfectly willing to re-arm, which is the trap
    // cancelQuote's header documents.
    const booking = await mintBooking('expired', 'pending');
    await linkConversion(id, booking.id);
    await db.as({ sub: STAFF, role: 'authenticated' });
    await cancelQuote(id);

    await db.as({ sub: STAFF, role: 'authenticated' });
    await reinstateQuote(id);

    const row = await readQuote(id);
    expect(row.status, 'a converted-but-dead quote could not be re-drafted').toBe('draft');
  });

  it('refuses to reinstate a quote the guest has already paid for', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });

    const booking = await mintBooking('confirmed', 'paid');
    await linkConversion(id, booking.id);

    // 'draft' beside a booking_id and a converted_at that say the guest paid is simply false, and it
    // would put the offer back on a workbench whose Save button rewrites the itemisation behind a
    // real charge.
    await db.as({ sub: STAFF, role: 'authenticated' });
    const message = await reinstateQuote(id).then(
      () => '',
      (error: unknown) => (error as Error).message,
    );
    expect(message, 'a paid quote was put back to a draft').not.toBe('');
    expect(message, 'the refusal does not name the booking the operator must act on').toContain(
      booking.ref,
    );

    const row = await readQuote(id);
    expect(row.status).toBe('accepted');
  });

  it('refuses to reinstate a quote whose booking is still alive and unpaid', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });

    // The guest is at Peach with the card in their hand. api_create_payment answers to the BOOKING,
    // so re-drafting the offer would not stop that charge — it would only leave the operator editing
    // lines that are about to be paid for.
    const booking = await mintBooking('payment_pending', 'pending');
    await linkConversion(id, booking.id);

    await db.as({ sub: STAFF, role: 'authenticated' });
    const message = await reinstateQuote(id).then(
      () => '',
      (error: unknown) => (error as Error).message,
    );
    expect(message, 'a quote with a live checkout was put back to a draft').not.toBe('');
    expect(message, 'the refusal does not name the booking to cancel first').toContain(booking.ref);
  });

  it('refuses to reinstate a quote that was never withdrawn, leaving its live link alone', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const id = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });
    await markSent(id);

    // THE HARM THIS GUARDS. Reinstating nulls `token_hash`; run it on a SENT quote and the link the
    // guest is reading dies for no reason the operator asked for. The status test lives in the
    // UPDATE's own WHERE clause, so this is not a check that can be raced past.
    await db.as({ sub: STAFF, role: 'authenticated' });
    const message = await reinstateQuote(id).then(
      () => '',
      (error: unknown) => (error as Error).message,
    );
    expect(message, 'a sent quote was silently re-drafted').not.toBe('');
    expect(message, 'the refusal does not say a sent quote can just be edited').toMatch(
      /edited and re-sent/i,
    );

    const link = await readLinkState(id);
    expect(link.tokenHash, 'the guest’s live link was killed by a refused reinstate').toBe(
      'stored-hash-of-the-emailed-token',
    );
    const row = await readQuote(id);
    expect(row.status).toBe('sent');
  });

  /* ------------------------------------------------------------------------------------------- */
  /* Duplicating                                                                                   */
  /*                                                                                               */
  /* The escape hatch for the one quote that genuinely cannot be edited in place — the paid one —   */
  /* and the reason no offer ever has to be re-keyed by hand again.                                 */
  /* ------------------------------------------------------------------------------------------- */

  it('copies a quote into a fresh draft: same lines, new ref, no link and no conversion', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const sourceId = await saveQuote({
      ...GUEST,
      introNote: 'Dear Marie, here is the private boat day we discussed.',
      internalNotes: 'Margin is thin at this price.',
      locale: 'fr',
      depositBps: 2500,
      items: [
        { kind: 'custom', description: 'Private skipper', quantity: 3, unitAmountMinor: 4500 },
        {
          kind: 'custom',
          description: 'Transfert aller/retour',
          quantity: 1,
          unitAmountMinor: 6000,
        },
      ],
    });
    await markSent(sourceId);

    await db.as({ sub: STAFF, role: 'authenticated' });
    const copyId = await duplicateQuote(sourceId);
    expect(copyId, 'the copy is the same row as its source').not.toBe(sourceId);

    await db.as({ sub: STAFF, role: 'authenticated' });
    const copy = await loadQuote(copyId);
    const source = await loadQuote(sourceId);

    // Everything an operator would otherwise re-key, in the owner's order.
    expect(
      copy!.items.map((item) => [item.description, item.quantity, item.unitAmountMinor]),
    ).toEqual(source!.items.map((item) => [item.description, item.quantity, item.unitAmountMinor]));
    expect(Number(copy!.totalMinor)).toBe(19500);
    expect(copy!.customerEmail).toBe(source!.customerEmail);
    expect(copy!.introNote).toBe(source!.introNote);
    expect(copy!.internalNotes).toBe(source!.internalNotes);
    // `locale` picks the language of the confirmation email and the VAT invoice, and `deposit_bps`
    // sizes the first charge — a copy that resets either quietly re-negotiates the offer.
    expect(copy!.locale, 'a French offer was copied into an English one').toBe('fr');
    expect(copy!.depositBps, 'a negotiated deposit was reset to the default by the copy').toBe(
      2500,
    );

    // …and nothing that belongs to the ORIGINAL's identity or its link.
    expect(copy!.ref).not.toBe(source!.ref);
    expect(copy!.status).toBe('draft');
    expect(copy!.convertedAt).toBeNull();
    expect(copy!.bookingId).toBeNull();
    const copyLink = await readLinkState(copyId);
    expect(copyLink.tokenHash, 'the copy inherited the original’s live link').toBeNull();
    expect(copyLink.sentAt, 'the copy claims to have been emailed already').toBeNull();

    // The source is untouched — this is a copy, not a move.
    const sourceRow = await readQuote(sourceId);
    expect(sourceRow.status).toBe('sent');
    expect(sourceRow.line_count).toBe(2);
    const sourceLink = await readLinkState(sourceId);
    expect(sourceLink.tokenHash).toBe('stored-hash-of-the-emailed-token');
  });

  it('duplicates a PAID quote, which is the only way to re-offer one', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const sourceId = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });
    const booking = await mintBooking('confirmed', 'paid');
    await linkConversion(sourceId, booking.id);

    // saveQuote refuses to edit this one, and rightly: its lines are the itemisation behind a real
    // charge. Before duplicate() the operator's only option was to retype the offer.
    await db.as({ sub: STAFF, role: 'authenticated' });
    const copyId = await duplicateQuote(sourceId);

    await db.as({ sub: STAFF, role: 'authenticated' });
    const copy = await loadQuote(copyId);
    expect(copy!.status).toBe('draft');
    expect(copy!.convertedAt, 'the copy inherited the original’s conversion').toBeNull();
    expect(copy!.items).toHaveLength(1);

    // The paid quote and its booking are exactly as they were.
    const sourceRow = await readQuote(sourceId);
    expect(sourceRow.status).toBe('accepted');
    expect(Number(sourceRow.total_minor)).toBe(50000);
  });

  it('re-opens the validity window when the source quote has gone stale', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const sourceId = await saveQuote({
      ...GUEST,
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });

    // The quote most worth duplicating is the one that sat unanswered until its window closed —
    // written straight to the column, because saveQuote refuses a past date by design.
    await db.asOwner();
    await db.pg.query(`update quotes set valid_until = current_date - 30 where id = $1`, [
      sourceId,
    ]);

    await db.as({ sub: STAFF, role: 'authenticated' });
    const copyId = await duplicateQuote(sourceId);
    await db.as({ sub: STAFF, role: 'authenticated' });
    const copy = await loadQuote(copyId);

    const today = new Date().toISOString().slice(0, 10);
    expect(
      copy!.validUntil >= today,
      'the copy was born expired — unopenable by the guest and unchargeable',
    ).toBe(true);
  });

  it('keeps a still-open validity window exactly as the operator negotiated it', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    const sourceId = await saveQuote({
      ...GUEST,
      validUntil: '2099-06-30',
      items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    });

    await db.as({ sub: STAFF, role: 'authenticated' });
    const copyId = await duplicateQuote(sourceId);
    await db.as({ sub: STAFF, role: 'authenticated' });
    const copy = await loadQuote(copyId);

    expect(copy!.validUntil, 'a live deadline was silently rewritten by the copy').toBe(
      '2099-06-30',
    );
  });
});
