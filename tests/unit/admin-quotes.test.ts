import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * The pure half of the staff quote service: the figures saveQuote DERIVES, and the one call that
 * leaves the browser. The CRUD itself runs against the real schema — real RLS, real CHECK
 * constraints — in tests/integration/admin-quotes.test.ts.
 *
 * Why the arithmetic is pinned here rather than left to totals.ts: `quotes.total_minor` is copied
 * straight into `bookings.total_minor` at conversion, and api_convert_quote refuses to mint a booking
 * unless that figure equals the sum of the quote's stored `subtotal_minor` values
 * (`quote_total_mismatch`). saveQuote writes BOTH sides of that comparison, in two different
 * statements, so "the total and the lines agree" is this module's invariant to keep, not the
 * database's to discover.
 */

// The module reads the signed-in staff session for `created_by` and for the send route's bearer.
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => ({
    auth: {
      getSession: async () => ({
        data: {
          session: {
            access_token: 'staff-token',
            user: { id: '11111111-1111-1111-1111-111111111111' },
          },
        },
      }),
    },
  }),
}));

const { quoteRowTotal, quoteItemRows, mintQuoteRef, sendQuote, saveQuote } =
  await import('@/lib/admin/quotes');

describe('saveQuote totals', () => {
  it('ignores a client-supplied total and recomputes from the lines', () => {
    expect(
      quoteRowTotal({
        totalMinor: 1,
        items: [
          { quantity: 2, unitAmountMinor: 5000 },
          { quantity: 1, unitAmountMinor: 2500 },
        ],
      }),
    ).toBe(12500);
  });

  it('stores line subtotals that sum to exactly the total it stores', () => {
    // api_convert_quote compares the two and refuses to charge on any drift, so a quote whose lines
    // do not sum to its total is not a rounding curiosity — it is a quote the guest cannot pay.
    const items = [
      {
        kind: 'custom' as const,
        description: 'Private skipper',
        quantity: 3,
        unitAmountMinor: 4500,
      },
      {
        kind: 'custom' as const,
        description: 'Fuel surcharge',
        quantity: 1,
        unitAmountMinor: 12000,
      },
    ];
    const lines = quoteItemRows(items).reduce((sum, row) => sum + row.subtotal_minor, 0);
    expect(lines).toBe(quoteRowTotal({ items }));
  });

  it('refuses a fractional quantity instead of writing a rounded line', () => {
    // The rejection has to happen while the rows are being BUILT: saveQuote writes the quote row and
    // its lines as separate statements, so a line that only fails at INSERT time leaves a stored
    // total with no itemisation behind it.
    expect(() =>
      quoteItemRows([
        { kind: 'custom', description: 'Half a guide', quantity: 1.5, unitAmountMinor: 1000 },
      ]),
    ).toThrow(/whole number/i);
  });

  it('refuses a blank description on a custom line, for the same reason', () => {
    // `quote_item_shape` requires a non-catalogue line to carry a description. A whitespace-only one
    // trims to null and only fails at INSERT — i.e. on the edit path, after the new total has been
    // written and the old lines deleted, leaving a stored total with no itemisation behind it. That
    // is a quote api_convert_quote then refuses to charge (`quote_total_mismatch`), against a link
    // the guest already holds.
    expect(() =>
      quoteItemRows([{ kind: 'custom', description: '   ', quantity: 1, unitAmountMinor: 1000 }]),
    ).toThrow(/description/i);
    expect(() => quoteItemRows([{ kind: 'rental', quantity: 1, unitAmountMinor: 1000 }])).toThrow(
      /description/i,
    );
  });

  it('refuses a catalogue line with no occurrence or option, for the same reason', () => {
    // The OTHER half of `quote_item_shape`: a catalogue line must name both an occurrence and an
    // option. The editor switches a line's kind in place, so a line switched TO catalogue before a
    // slot has been picked carries null ids — and, exactly like the blank description above, that
    // only fails at INSERT: last, after the new total is written and the old lines are deleted.
    // Worse, the lines go in as ONE multi-row insert, so the bad line takes the good ones with it
    // and leaves a re-priced total with zero itemisation behind it.
    expect(() =>
      quoteItemRows([
        { kind: 'catalogue', priceLabel: 'Adult', quantity: 2, unitAmountMinor: 7500 },
      ]),
    ).toThrow(/occurrence/i);
    expect(() =>
      quoteItemRows([
        {
          kind: 'catalogue',
          sessionOccurrenceId: '22222222-2222-2222-2222-222222222222',
          quantity: 2,
          unitAmountMinor: 7500,
        },
      ]),
    ).toThrow(/option/i);
  });
});

describe('saveQuote denomination', () => {
  /**
   * `currency` and `locale` are typed narrowly (`'EUR'`, `'en' | 'fr'`) so a UI author cannot widen
   * them, and the runtime guard below is the half that survives a cast or a JSON body. The cast is
   * therefore the point of the test, not a shortcut around the types.
   *
   * Both refusals land before ANY statement is issued — the mocked client here has an `auth` and
   * nothing else, so a guard that ran after the first `from()` would fail with a TypeError instead.
   */
  const widened = saveQuote as unknown as (input: Record<string, unknown>) => Promise<string>;
  const guest = {
    customerName: 'Marie Dupont',
    customerEmail: 'marie@example.com',
    validUntil: '2099-12-31',
    items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
  };

  it('refuses a currency the card can never be charged in', async () => {
    // `payments_ledger_currency_eur` (20260830000000) pins payments.currency = 'EUR', and
    // api_create_payment inserts the payments row without ever reading the booking's currency. A
    // quote saved as 'MUR' would therefore quote and email "MUR 50000" and charge 500 EUR — a silent
    // denomination mismatch, not a failure anyone would see.
    await expect(widened({ ...guest, currency: 'MUR' })).rejects.toThrow(/EUR/);
  });

  it('refuses a locale outside the content_locale enum', async () => {
    // Copied verbatim into quotes.locale, whose type is the content_locale enum: today that fails at
    // INSERT with a raw enum error the operator cannot act on.
    await expect(widened({ ...guest, locale: 'de' })).rejects.toThrow(/locale/i);
  });

  it('refuses a valid-until date that has already gone by', async () => {
    // `valid_until` is not a display field: api_convert_quote raises `quote_expired` on
    // `valid_until < current_date` and resolveQuoteForToken hides the public page outright, so a
    // quote saved with a past date is an offer nobody can open and nobody can pay — while the editor
    // and the send path go on treating it as a live draft. Refusing at the keystroke costs the
    // operator one toast; not refusing costs a guest a priced email above a dead link.
    //
    // Like the two refusals above, this lands before ANY statement is issued: the mocked client here
    // has an `auth` and nothing else, so a guard that ran after the first `from()` would fail with a
    // TypeError instead of this message.
    await expect(widened({ ...guest, validUntil: '2020-01-01' })).rejects.toThrow(/2020-01-01/);
  });
});

describe('quote line rows', () => {
  it('numbers the lines in the order the owner arranged them', () => {
    const rows = quoteItemRows([
      { kind: 'custom', description: 'Day one', quantity: 1, unitAmountMinor: 1000 },
      { kind: 'custom', description: 'Day two', quantity: 1, unitAmountMinor: 2000 },
    ]);
    expect(rows.map((row) => row.position)).toEqual([0, 1]);
    // Everything downstream — the editor, the email, the public page and booking_custom_items —
    // reads the lines by `position`; ordering by id would be ordering by gen_random_uuid().
    expect(rows.map((row) => row.description)).toEqual(['Day one', 'Day two']);
  });

  it('clears every column that belongs to a kind the line no longer is', () => {
    // quote_item_shape requires a custom/rental line to name NEITHER an occurrence nor an option. The
    // editor switches a line's kind in place, so the ids of a line that used to be a catalogue one
    // are still in the form object — carrying them through raises a raw check violation the operator
    // cannot act on.
    //
    // The vehicle slug of a line that used to be a RENTAL one is the same stale field, and no
    // constraint catches it: api_convert_quote copies it into booking_custom_items, whose FK is
    // `on delete restrict`, so a paid custom line would pin a rental vehicle it has nothing to do
    // with — permanently, and against a reference the operator cannot find or clear.
    const [row] = quoteItemRows([
      {
        kind: 'custom',
        description: 'Private guide, full day',
        sessionOccurrenceId: '22222222-2222-2222-2222-222222222222',
        activityOptionId: '33333333-3333-3333-3333-333333333333',
        rentalVehicleSlug: 'nissan-march',
        quantity: 1,
        unitAmountMinor: 12000,
      },
    ]);
    expect(row!.session_occurrence_id).toBeNull();
    expect(row!.activity_option_id).toBeNull();
    expect(row!.rental_vehicle_slug).toBeNull();
    expect(row!.description).toBe('Private guide, full day');
  });

  it('keeps the vehicle on a line that really is a rental', () => {
    const [row] = quoteItemRows([
      {
        kind: 'rental',
        description: 'Nissan March, 5 days',
        rentalVehicleSlug: 'nissan-march',
        quantity: 5,
        unitAmountMinor: 3500,
      },
    ]);
    expect(row!.rental_vehicle_slug).toBe('nissan-march');
    expect(row!.subtotal_minor).toBe(17500);
  });

  it('keeps the occurrence and option on a catalogue line', () => {
    const [row] = quoteItemRows([
      {
        kind: 'catalogue',
        priceLabel: 'Adult',
        sessionOccurrenceId: '22222222-2222-2222-2222-222222222222',
        activityOptionId: '33333333-3333-3333-3333-333333333333',
        quantity: 2,
        unitAmountMinor: 7500,
      },
    ]);
    expect(row!.session_occurrence_id).toBe('22222222-2222-2222-2222-222222222222');
    expect(row!.activity_option_id).toBe('33333333-3333-3333-3333-333333333333');
    expect(row!.subtotal_minor).toBe(15000);
  });
});

describe('mintQuoteRef', () => {
  it('mints a distinct URL-safe ref every time', () => {
    // The ref is the public page's path segment (/quotes/{ref}) and the column is UNIQUE, so a short
    // or guessable ref costs either a collision on save or a quote the wrong guest can find.
    const refs = new Set(Array.from({ length: 500 }, () => mintQuoteRef()));
    expect(refs.size).toBe(500);
    for (const ref of refs) expect(ref).toMatch(/^Q[0-9A-F]{12}$/);
  });
});

describe('sendQuote', () => {
  afterEach(() => vi.unstubAllGlobals());

  /**
   * EVERY TEST BELOW STUBS `fetch`, so none of them can tell whether the route on the other end
   * exists — and for a while it did not: `/api/v1/admin/quotes/send` was never written, so a drafted
   * quote could not be sent to anyone while this block stayed green. What the stub is right to cover
   * is the CLIENT's half (the bearer, the body shape, and refusing to report a link the route never
   * returned); what it cannot cover is that the URL points at something. The test immediately after
   * this one pins that, and the ROUTE's own behaviour is exercised for real — real schema, real
   * refusals, real token — in tests/integration/admin-quote-send.test.ts.
   */
  it('posts the quote id with the staff bearer and returns the public link', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, data: { url: 'https://x/quotes/QABC?t=tok' } }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(sendQuote('quote-id')).resolves.toEqual({
      url: 'https://x/quotes/QABC?t=tok',
    });
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe('/api/v1/admin/quotes/send');
    expect(init.method).toBe('POST');
    // Sending mints the link token and emails the guest — both need the service-role key, so it
    // happens on the staff-authenticated route and never in the browser.
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer staff-token');
    expect(JSON.parse(String(init.body))).toEqual({ quoteId: 'quote-id' });
  });

  it('posts to a URL an App Router route file actually answers', async () => {
    // Derived from the request the client really made, never from a literal repeated here: a rename
    // on either side has to break this, which is the whole point of it.
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, data: { url: 'https://x' } })),
    );
    vi.stubGlobal('fetch', fetchMock);
    await sendQuote('quote-id');
    const [url] = fetchMock.mock.calls[0]! as unknown as [string];

    const file = join(process.cwd(), 'app', url.replace(/^\//, ''), 'route.ts');
    expect(existsSync(file)).toBe(true);
    // …and it answers POST. A route file exporting only GET would satisfy the check above while
    // still 405-ing every send.
    expect(readFileSync(file, 'utf8')).toMatch(/export (const|async function) POST/);
  });

  it("surfaces the route's own refusal instead of a generic failure", async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: { message: 'Quote has no lines' } }), {
            status: 409,
          }),
      ),
    );
    await expect(sendQuote('quote-id')).rejects.toThrow('Quote has no lines');
  });

  it('does not report a link the route never returned', async () => {
    // A 200 with no url would otherwise hand the operator `undefined` to copy and tell them the
    // guest has been emailed.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: true, data: {} }), { status: 200 })),
    );
    await expect(sendQuote('quote-id')).rejects.toThrow(/could not send/i);
  });
});
