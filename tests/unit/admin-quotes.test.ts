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

const { quoteRowTotal, quoteItemRows, mintQuoteRef, sendQuote } =
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

  it('clears the catalogue-only columns on a custom line', () => {
    // quote_item_shape requires a custom/rental line to name NEITHER an occurrence nor an option. The
    // editor switches a line's kind in place, so the ids of a line that used to be a catalogue one
    // are still in the form object — carrying them through raises a raw check violation the operator
    // cannot act on.
    const [row] = quoteItemRows([
      {
        kind: 'custom',
        description: 'Private guide, full day',
        sessionOccurrenceId: '22222222-2222-2222-2222-222222222222',
        activityOptionId: '33333333-3333-3333-3333-333333333333',
        quantity: 1,
        unitAmountMinor: 12000,
      },
    ]);
    expect(row!.session_occurrence_id).toBeNull();
    expect(row!.activity_option_id).toBeNull();
    expect(row!.description).toBe('Private guide, full day');
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
