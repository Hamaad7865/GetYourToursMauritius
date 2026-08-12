/**
 * The runner's own clock is pinned to UTC, and that is load-bearing rather than tidy: the owner's
 * machine sits in Indian/Mauritius (UTC+4), which is the very offset one of these tests asserts. An
 * implementation that read a custom line's date/time in LOCAL time instead of Mauritius time would
 * pass here by coincidence and fail on CI. Everything else in this file formats through an explicit
 * `timeZone`, so nothing else is affected.
 */
process.env.TZ = 'UTC';

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PREVIEW_LINK_TOKEN,
  QUOTE_PANES,
  catalogueLineRefusal,
  convertedBookingKind,
  customLineDraft,
  defaultValidUntil,
  emptyQuoteForm,
  formFromQuote,
  formTotalMinor,
  formatMinorAsEuros,
  moveLine,
  parseEurosToMinor,
  previewEmailInput,
  quoteInputFromForm,
  refusalMessage,
  sendRefusal,
  tourLineDrafts,
  type QuoteFormValues,
  type QuoteLineDraft,
} from '@/components/admin/quotes/state';
import { quoteItemRows, quoteRowTotal, type QuoteDetail } from '@/lib/admin/quotes';
import { renderQuoteEmail } from '@/lib/email/quote';
import { navForRole } from '@/components/admin/nav';
import { fmtDate } from '@/lib/admin/format';

/**
 * The quotes editor's decisions, separated from its markup exactly as the tour editor's are
 * (`src/components/admin/activity/sections.ts` + tests/unit/activity-editor-sections.test.ts).
 *
 * What is pinned here is everything about the screen that is not a pixel: how a typed price becomes
 * MINOR UNITS, what a picked departure costs, which line shapes the money path will refuse, what the
 * operator is shown before an email leaves, and how a refusal thrown by src/lib/admin/quotes.ts
 * reaches them. Every one of those has a silent failure mode — a rounded price, an unpayable offer,
 * a leaked internal note, a "Something went wrong" over a message that named the fix.
 */

/** The day `form()` builds its quote on. Passed to anything that would otherwise read a clock. */
const TODAY = '2026-08-06';

const OCCURRENCE = '22222222-2222-2222-2222-222222222222';
const OPTION = '33333333-3333-3333-3333-333333333333';
/** 09:00 in Mauritius (UTC+4), which is the timezone the whole back office renders in. */
const DEPARTURE = '2026-08-23T05:00:00.000Z';

function form(over: Partial<QuoteFormValues> = {}): QuoteFormValues {
  return {
    ...emptyQuoteForm(TODAY),
    customerName: 'Marie Dupont',
    customerEmail: 'marie@example.com',
    ...over,
  };
}

function custom(over: Partial<QuoteLineDraft> = {}): QuoteLineDraft {
  return { ...customLineDraft(), description: 'Private guide', unitText: '120', ...over };
}

describe('money in the editor', () => {
  it('reads what the operator typed as minor units', () => {
    expect(parseEurosToMinor('129.99', 'Unit price')).toBe(12999);
    expect(parseEurosToMinor('129', 'Unit price')).toBe(12900);
    expect(parseEurosToMinor('129.9', 'Unit price')).toBe(12990);
    expect(parseEurosToMinor('0.05', 'Unit price')).toBe(5);
    // The two shapes an operator actually types: a euro sign, and a comma for the decimal point.
    expect(parseEurosToMinor(' €1299 ', 'Unit price')).toBe(129900);
    expect(parseEurosToMinor('129,99', 'Unit price')).toBe(12999);
  });

  it('refuses a third decimal instead of silently rounding money nobody typed', () => {
    // This is the whole reason the editor parses the STRING rather than multiplying a float by 100:
    // Math.round(parseFloat('45.678') * 100) is 4568, i.e. a price the operator never wrote and the
    // guest is then charged. src/lib/quotes/totals.ts refuses fractional money for the same reason,
    // but only once the line has been built — by then the figure has already been rounded.
    expect(() => parseEurosToMinor('45.678', 'Unit price')).toThrow(/two decimals/i);
  });

  it('refuses a blank, a negative and a non-number, naming the field', () => {
    expect(() => parseEurosToMinor('', 'Unit price')).toThrow(/unit price/i);
    expect(() => parseEurosToMinor('-5', 'Unit price')).toThrow(/unit price/i);
    expect(() => parseEurosToMinor('12.5.6', 'Unit price')).toThrow(/unit price/i);
  });

  it('formats minor units back without a float round-trip', () => {
    expect(formatMinorAsEuros(12999)).toBe('129.99');
    expect(formatMinorAsEuros(5)).toBe('0.05');
    expect(formatMinorAsEuros(129900)).toBe('1299.00');
    expect(parseEurosToMinor(formatMinorAsEuros(123456789), 'Unit price')).toBe(123456789);
  });
});

describe('valid until', () => {
  it('defaults to a fortnight out', () => {
    expect(defaultValidUntil('2026-08-06')).toBe('2026-08-20');
    expect(emptyQuoteForm('2026-08-06').validUntil).toBe('2026-08-20');
  });

  it('crosses a month and a year without arithmetic on local midnight', () => {
    // api_convert_quote compares valid_until against `current_date` in UTC, and
    // src/lib/quotes/validity.ts reads "today" the same way. Doing this in local time would make the
    // default a day out for every operator in Mauritius (UTC+4) for part of the day.
    expect(defaultValidUntil('2026-12-25')).toBe('2027-01-08');
    expect(defaultValidUntil('2026-02-20')).toBe('2026-03-06');
  });
});

describe('adding a tour', () => {
  const pick = {
    activityTitle: 'Catamaran cruise',
    optionName: 'Full day',
    activityOptionId: OPTION,
    sessionOccurrenceId: OCCURRENCE,
    startsAt: DEPARTURE,
    tiers: [
      { label: 'Adult', amountMinor: 5500, quantity: 2 },
      { label: 'Child', amountMinor: 3000, quantity: 1 },
      { label: 'Infant', amountMinor: 0, quantity: 0 },
    ],
  };

  it('prices the party from the catalogue and skips tiers nobody is travelling on', () => {
    const lines = tourLineDrafts(pick);
    expect(lines).toHaveLength(2);
    expect(lines.map((l) => l.quantityText)).toEqual(['2', '1']);
    expect(lines.map((l) => l.unitText)).toEqual(['55.00', '30.00']);
    expect(lines.map((l) => l.catalogueUnitMinor)).toEqual([5500, 3000]);
  });

  it('describes the line in the words the guest will read in the email', () => {
    const [line] = tourLineDrafts(pick);
    expect(line!.description).toContain('Catamaran cruise');
    expect(line!.description).toContain('Full day');
    expect(line!.description).toContain('Adult');
    // Mauritius time, like every other date in the back office — never the operator's own zone.
    expect(line!.description).toContain(fmtDate(DEPARTURE));
  });

  it('keeps the occurrence, the option and the tier label the money path reads', () => {
    const [line] = tourLineDrafts(pick);
    const [row] = quoteItemRows(quoteInputFromForm(form({ lines: [line!] })).items);
    expect(row!.kind).toBe('catalogue');
    expect(row!.session_occurrence_id).toBe(OCCURRENCE);
    expect(row!.activity_option_id).toBe(OPTION);
    // api_convert_quote's re-price gate looks the line up by (option, price_label); a line that
    // loses its tier label can never be proven to still stand and is refused at pay time.
    expect(row!.price_label).toBe('Adult');
    expect(row!.subtotal_minor).toBe(11000);
  });

  it('refuses the option shapes the conversion cannot map onto a seat', () => {
    // api_convert_quote raises quote_not_convertible on both, so an offer carrying one is one the
    // guest can be emailed and can never pay.
    expect(
      catalogueLineRefusal({ pricingMode: 'per_person', isPrivate: true, priceCount: 2 }),
    ).toMatch(/private/i);
    expect(
      catalogueLineRefusal({ pricingMode: 'vehicle', isPrivate: false, priceCount: 2 }),
    ).toMatch(/vehicle/i);
    // No price tier means nothing for the pay route's re-price gate to compare against.
    expect(
      catalogueLineRefusal({ pricingMode: 'per_person', isPrivate: false, priceCount: 0 }),
    ).toMatch(/price/i);
    expect(
      catalogueLineRefusal({ pricingMode: 'per_person', isPrivate: false, priceCount: 3 }),
    ).toBeNull();
  });
});

describe('an overridden tour price', () => {
  const [tourLine] = tourLineDrafts({
    activityTitle: 'Catamaran cruise',
    optionName: 'Full day',
    activityOptionId: OPTION,
    sessionOccurrenceId: OCCURRENCE,
    startsAt: DEPARTURE,
    tiers: [{ label: 'Adult', amountMinor: 5500, quantity: 2 }],
  });

  it('stops being a catalogue line, because the pay route re-prices catalogue lines', () => {
    // app/api/v1/quotes/[ref]/pay/route.ts recomputes every CATALOGUE line from
    // activity_option_prices and refuses the payment outright when the recomputed total differs
    // from quotes.total_minor. A catalogue line held at a negotiated price is therefore an offer
    // the guest is emailed, opens, and cannot pay — 409, "this quote's prices have changed".
    // Quoting it as a custom line is the shape that is chargeable.
    const [row] = quoteItemRows(
      quoteInputFromForm(form({ lines: [{ ...tourLine!, unitText: '49.50' }] })).items,
    );
    expect(row!.kind).toBe('custom');
    expect(row!.session_occurrence_id).toBeNull();
    expect(row!.activity_option_id).toBeNull();
    expect(row!.unit_amount_minor).toBe(4950);
    // …and it keeps the departure it was quoted against, both for the guest reading the email and
    // for the day sheet that will surface dated custom lines.
    expect(row!.description).toContain('Catamaran cruise');
    expect(row!.starts_at).toBe(DEPARTURE);
  });

  it('stays a catalogue line when only the party size changes', () => {
    const [row] = quoteItemRows(
      quoteInputFromForm(form({ lines: [{ ...tourLine!, quantityText: '4' }] })).items,
    );
    expect(row!.kind).toBe('catalogue');
    expect(row!.quantity).toBe(4);
    expect(row!.subtotal_minor).toBe(22000);
  });
});

describe('the line list', () => {
  it('renumbers positions from the order on screen, because position is what is read downstream', () => {
    const lines = [
      custom({ description: 'Day one' }),
      custom({ description: 'Day two' }),
      custom({ description: 'Day three' }),
    ];
    const moved = moveLine(lines, 2, -1);
    const rows = quoteItemRows(quoteInputFromForm(form({ lines: moved })).items);
    expect(rows.map((r) => r.description)).toEqual(['Day one', 'Day three', 'Day two']);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
  });

  it('leaves the list alone at either end rather than dropping a line', () => {
    const lines = [custom({ description: 'Only' })];
    expect(moveLine(lines, 0, -1)).toEqual(lines);
    expect(moveLine(lines, 0, 1)).toEqual(lines);
    expect(moveLine(lines, 5, 1)).toEqual(lines);
  });

  it('gives a custom line its date and time as a Mauritius instant', () => {
    const [row] = quoteItemRows(
      quoteInputFromForm(form({ lines: [custom({ date: '2026-08-23', time: '09:00' })] })).items,
    );
    // Part 3 reads booking_custom_items.starts_at to put these on the day sheet, and the day sheet
    // is bounded in Mauritius time. Stored as UTC-of-the-Mauritius-wall-clock, never as bare local.
    expect(new Date(row!.starts_at!).toISOString()).toBe(DEPARTURE);
  });

  it('names the line whose quantity or price it cannot read', () => {
    expect(() =>
      quoteInputFromForm(form({ lines: [custom(), custom({ quantityText: '0' })] })),
    ).toThrow(/line 2/i);
    expect(() => quoteInputFromForm(form({ lines: [custom({ unitText: 'free' })] }))).toThrow(
      /line 1/i,
    );
    expect(() => quoteInputFromForm(form({ lines: [custom({ description: '  ' })] }))).toThrow(
      /line 1/i,
    );
  });

  it('stores a total the stored lines add up to, whatever the operator typed', () => {
    // api_convert_quote refuses to charge a quote whose total and lines disagree
    // (quote_total_mismatch), and the editor writes both. The one arithmetic they must share is
    // this one.
    const input = quoteInputFromForm(
      form({
        lines: [
          custom({ description: 'Skipper', unitText: '45', quantityText: '3' }),
          custom({ description: 'Fuel', unitText: '120.50' }),
        ],
      }),
    );
    const rows = quoteItemRows(input.items);
    expect(rows.reduce((sum, r) => sum + r.subtotal_minor, 0)).toBe(quoteRowTotal(input));
    expect(formTotalMinor(form({ lines: [] }))).toBe(0);
  });
});

describe('re-opening a saved quote', () => {
  const detail: QuoteDetail = {
    id: 'quote-1',
    bookingStatus: null,
    ref: 'Q0123456789AB',
    customerName: 'Marie Dupont',
    customerEmail: 'marie@example.com',
    customerPhone: '+230 5xxx',
    status: 'sent',
    currency: 'EUR',
    totalMinor: 28500,
    validUntil: '2026-08-20',
    introNote: 'As discussed.',
    internalNotes: 'margin is thin',
    sentAt: '2026-08-06T09:00:00.000Z',
    bookingId: null,
    convertedAt: null,
    locale: 'fr',
    createdAt: '2026-08-06T08:00:00.000Z',
    updatedAt: '2026-08-06T09:00:00.000Z',
    items: [
      {
        id: 'i1',
        position: 0,
        kind: 'catalogue',
        sessionOccurrenceId: OCCURRENCE,
        activityOptionId: OPTION,
        priceLabel: 'Adult',
        description: 'Catamaran cruise — Full day',
        startsAt: DEPARTURE,
        endsAt: null,
        rentalVehicleSlug: null,
        quantity: 2,
        unitAmountMinor: 5500,
        subtotalMinor: 11000,
        transportPickupLabel: null,
        transportDropoffLabel: null,
        transportFareMinor: null,
      },
      {
        id: 'i2',
        position: 1,
        kind: 'custom',
        sessionOccurrenceId: null,
        activityOptionId: null,
        priceLabel: null,
        description: 'Private guide',
        startsAt: null,
        endsAt: null,
        rentalVehicleSlug: null,
        quantity: 1,
        unitAmountMinor: 12000,
        subtotalMinor: 12000,
        transportPickupLabel: null,
        transportDropoffLabel: null,
        transportFareMinor: null,
      },
      {
        id: 'i3',
        position: 2,
        kind: 'rental',
        sessionOccurrenceId: null,
        activityOptionId: null,
        priceLabel: null,
        description: 'Nissan March, 5 days',
        startsAt: null,
        endsAt: null,
        rentalVehicleSlug: 'nissan-march',
        quantity: 5,
        unitAmountMinor: 1100,
        subtotalMinor: 5500,
        transportPickupLabel: null,
        transportDropoffLabel: null,
        transportFareMinor: null,
      },
    ],
  };

  it('parses an attached transport add-on into rows, lifts the total, and never on a rental', () => {
    const form = formFromQuote(detail);
    // Attach a €60 transfer to the catalogue tour, and (defensively) to the rental too.
    form.lines[0]!.transport = { pickupLabel: 'Le Récif Hotel', dropoffLabel: '', fareText: '60' };
    form.lines[2]!.transport = { pickupLabel: 'Le Récif Hotel', dropoffLabel: '', fareText: '99' };
    const input = quoteInputFromForm(form);
    // The tour line carries the transfer; the rental's transport is dropped (a car IS the transport).
    expect(input.items[0]!.transportFareMinor).toBe(6000);
    expect(input.items[0]!.transportPickupLabel).toBe('Le Récif Hotel');
    expect(input.items[2]!.transportFareMinor ?? null).toBeNull();
    // The fare lifts the total (Σ subtotals + Σ transport fares): 11000 + 12000 + 5500 + 6000.
    expect(quoteRowTotal({ items: input.items })).toBe(34500);
    // …and it survives the round-trip to storage rows.
    const rows = quoteItemRows(input.items);
    expect(rows[0]!.transport_fare_minor).toBe(6000);
    expect(rows[0]!.transport_pickup_label).toBe('Le Récif Hotel');
    expect(rows[2]!.transport_fare_minor).toBeNull();
  });

  it('round-trips every line back to exactly the rows it was loaded from', () => {
    const rows = quoteItemRows(quoteInputFromForm(formFromQuote(detail)).items);
    expect(rows.map((r) => r.kind)).toEqual(['catalogue', 'custom', 'rental']);
    expect(rows.map((r) => r.unit_amount_minor)).toEqual([5500, 12000, 1100]);
    expect(rows.map((r) => r.quantity)).toEqual([2, 1, 5]);
    expect(rows[0]!.price_label).toBe('Adult');
    // A rental line is Part 2's, and this editor cannot draft one — but it must not mangle one on
    // its way through. booking_custom_items.rental_vehicle_slug is an `on delete restrict` FK, so a
    // slug dropped here (or invented here) is a reference the operator can neither find nor clear.
    expect(rows[2]!.rental_vehicle_slug).toBe('nissan-march');
    expect(quoteRowTotal(quoteInputFromForm(formFromQuote(detail)))).toBe(detail.totalMinor);
  });

  it('keeps the guest fields, the notes and the language the offer was drafted in', () => {
    const values = formFromQuote(detail);
    const input = quoteInputFromForm(values);
    expect(values.internalNotes).toBe('margin is thin');
    expect(input.introNote).toBe('As discussed.');
    // saveQuote is a FULL REPLACE: a field the form does not hand back is CLEARED, and `locale`
    // picks the language of the guest's confirmation email and VAT invoice after conversion.
    expect(input.locale).toBe('fr');
    expect(input.customerPhone).toBe('+230 5xxx');
    expect(input.validUntil).toBe('2026-08-20');
    expect(input.id).toBe('quote-1');
  });
});

describe('the email preview', () => {
  const previewForm = form({
    ref: 'Q0123456789AB',
    introNote: 'As discussed on the phone.',
    internalNotes: 'margin is thin, do not discount further',
    lines: [
      custom({ description: 'Private guide, full day', unitText: '120' }),
      custom({ description: 'Airport transfer', unitText: '55', quantityText: '2' }),
    ],
  });

  it('renders the very email the send route would, from the unsaved form', () => {
    const { html } = renderQuoteEmail(previewEmailInput(previewForm));
    expect(html).toContain('Private guide, full day');
    expect(html).toContain('Airport transfer');
    expect(html).toContain('As discussed on the phone.');
    expect(html).toContain('230.00');
  });

  it('never shows the internal note, which is the note that is never sent', () => {
    const { html } = renderQuoteEmail(previewEmailInput(previewForm));
    expect(html).not.toContain('margin is thin');
  });

  it('shows the total that would be STORED, not a second sum of its own', () => {
    // renderQuoteEmail prints the caller's totalMinor and refuses when it does not equal the sum of
    // the lines — the same comparison api_convert_quote makes before charging. Handing it the
    // figure saveQuote would store is what makes the preview evidence rather than decoration.
    expect(previewEmailInput(previewForm).totalMinor).toBe(formTotalMinor(previewForm));
    expect(previewEmailInput(previewForm).totalMinor).toBe(23000);
  });

  it('carries a placeholder token, because the real link is minted at Send', () => {
    // The raw token exists in exactly two places (the guest's email and the send response), and a
    // preview is neither. It still has to be a token-SHAPED value or renderQuoteEmail refuses to
    // render at all — which would leave the operator with no preview instead of a sample link.
    expect(PREVIEW_LINK_TOKEN).toMatch(/^[0-9a-f]{64}$/);
    expect(previewEmailInput(previewForm).linkToken).toBe(PREVIEW_LINK_TOKEN);
  });

  it('refuses to preview an offer nobody could be charged for', () => {
    // A quote with no priced line totals zero, which api_convert_quote reads as
    // quote_not_convertible ('zero total'). Showing a cheerful preview of it would send the
    // operator to press Send on an offer the send route is about to refuse.
    expect(() => renderQuoteEmail(previewEmailInput(form({ lines: [] })))).toThrow(
      /cannot be emailed/i,
    );
  });
});

describe('why Send is unavailable', () => {
  it('says so before the route has to, for each state that cannot be emailed', () => {
    // Every one of these is refused by app/api/v1/admin/quotes/send/route.ts as well — it is the
    // only thing that can be trusted, being the only writer of the token. What is worth having here
    // is the sentence: a disabled button with no reason beside it reads as a broken screen.
    //
    // `TODAY` is passed to every call: `form()` dates its quote from a fixed day, so a refusal that
    // read the wall clock would start firing on its own once that date went by and these
    // expectations would fail on a calendar boundary rather than on a change.
    expect(sendRefusal(form({ id: null }), TODAY)).toMatch(/save/i);
    expect(sendRefusal(form({ id: 'q1', convertedAt: '2026-08-07T09:00:00.000Z' }), TODAY)).toMatch(
      /accepted/i,
    );
    expect(sendRefusal(form({ id: 'q1', status: 'cancelled' }), TODAY)).toMatch(/withdrawn/i);
    expect(sendRefusal(form({ id: 'q1', status: 'expired' }), TODAY)).toMatch(/expired/i);
  });

  it('is silent on a draft and on a re-send', () => {
    // A SENT quote is not refused, and that is the whole of "edit it and send it again": the
    // operator changes the lines, saves, and presses Re-send. Nothing about this screen ever
    // required withdrawing first, and this is the assertion that says so.
    expect(sendRefusal(form({ id: 'q1', status: 'draft' }), TODAY)).toBeNull();
    expect(sendRefusal(form({ id: 'q1', status: 'sent' }), TODAY)).toBeNull();
  });

  it('names the button that gets each dead end moving again', () => {
    // Three of these sentences used to end in "draft a new one for this guest", which is how
    // re-keying a whole offer became the habit for what is usually a one-line change. Each now
    // names the action that avoids that, so the refusal is a route rather than a wall.
    expect(
      sendRefusal(form({ id: 'q1', status: 'cancelled' }), TODAY),
      'a withdrawn quote does not point at Reinstate',
    ).toMatch(/reinstate/i);
    expect(
      sendRefusal(form({ id: 'q1', convertedAt: '2026-08-07T09:00:00.000Z' }), TODAY),
      'a paid quote does not point at Duplicate',
    ).toMatch(/duplicate/i);
    expect(
      sendRefusal(form({ id: 'q1', status: 'expired' }), TODAY),
      'an expired quote does not say the date can be moved forward',
    ).toMatch(/valid-until|duplicate/i);
  });

  it('catches a quote that went stale on the shelf, before the operator presses Send', () => {
    // Nothing sets `status` to 'expired' — a quote goes stale by its `valid_until` passing — and a
    // stale offer is the single most common reason an old quote is being re-sent at all. Without
    // this the only warning is the send route's error AFTER the press.
    const stale = form({ id: 'q1', status: 'sent', validUntil: '2026-08-09' });
    expect(sendRefusal(stale, '2026-08-10'), 'a dead offer looked sendable').toMatch(/2026-08-09/);

    // `<`, never `<=`: api_convert_quote charges an offer valid UNTIL today all day, and a guard
    // stricter than the charge it predicts refuses quotes the route would have sent.
    expect(
      sendRefusal(form({ id: 'q1', status: 'sent', validUntil: '2026-08-10' }), '2026-08-10'),
    ).toBeNull();
  });
});

describe('refusals reaching the operator', () => {
  it('shows a PostgREST refusal, which is not an Error at all', () => {
    // src/lib/admin/quotes.ts does `if (error) throw error` — a PostgREST error is a PLAIN OBJECT,
    // so the `err instanceof Error ? err.message : 'Action failed.'` idiom used elsewhere in admin
    // turns "new row violates row-level security policy" into "Action failed."
    expect(
      refusalMessage(
        { message: 'new row violates row-level security policy for table "quotes"', code: '42501' },
        'Could not save the quote.',
      ),
    ).toMatch(/row-level security/);
  });

  it('shows the service layer’s own wording for a refusal it raised on purpose', () => {
    const converted = new Error(
      'This quote has already been converted into a booking, so its lines and total can no longer be changed.',
    );
    expect(refusalMessage(converted, 'Could not save the quote.')).toBe(converted.message);
  });

  it('falls back only when there is genuinely nothing to show', () => {
    expect(refusalMessage(null, 'Could not save the quote.')).toBe('Could not save the quote.');
    expect(refusalMessage({}, 'Could not save the quote.')).toBe('Could not save the quote.');
    expect(refusalMessage('Quote has no lines', 'Could not save the quote.')).toBe(
      'Quote has no lines',
    );
  });
});

describe('the screen is reachable', () => {
  it('has a rail whose panes are unique', () => {
    const ids = QUOTE_PANES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('send');
  });

  it('is in the admin nav, and every nav entry points at a route that exists', () => {
    const hrefs = navForRole('admin').map((item) => item.href);
    expect(hrefs).toContain('/admin/quotes');
    expect(hrefs).toContain('/admin/documents');
    for (const href of hrefs) {
      const page = join(
        process.cwd(),
        'app',
        '(site)',
        ...href.split('/').filter(Boolean),
        'page.tsx',
      );
      expect(existsSync(page), `${href} has no page.tsx`).toBe(true);
    }
  });

  it('is hidden from the restricted content role, which must not read a guest’s offer', () => {
    expect(navForRole('seo').map((item) => item.href)).not.toContain('/admin/quotes');
  });

  /**
   * Its own timeout, because the global 20s is a bound on the WRONG thing here. This test does two
   * dynamic imports of the heaviest modules in the app, and under a full 275-file parallel run on a
   * cold cache that transform work can outlast 20s — so a correct page failed roughly half the time
   * (3 of 6 full runs on 2026-08-09, with and without unrelated changes). What is asserted is "the
   * page renders AdminQuotes", never "it imports in under twenty seconds", and a flaky red is worse
   * than a slow green: it teaches everyone to re-run instead of read.
   *
   * Raising the ceiling weakens nothing — a page that renders the wrong thing, or fails to import at
   * all, still fails exactly as before. Same reasoning as the tool-parameter lint rule this branch
   * adds: a bound that turns a slow-but-correct case into a failure is in the wrong place.
   */
  it('renders the quotes screen at /admin/quotes', async () => {
    // Not a string match on the file: the page module is imported and its element tree searched
    // for the component itself, so a page that renders something else — or fails to import at all
    // — fails here.
    const { default: QuotesPage } = await import('../../app/(site)/admin/quotes/page');
    const { AdminQuotes } = await import('@/components/admin/AdminQuotes');
    expect(findAll(QuotesPage(), AdminQuotes)).toHaveLength(1);
  }, 60_000);
});

type ElementLike = { type: unknown; props: Record<string, unknown> };

function isElement(node: unknown): node is ElementLike {
  return !!node && typeof node === 'object' && 'type' in node && 'props' in node;
}

/** Every element of `target` in an un-rendered React element tree. Invokes no component. */
function findAll(node: unknown, target: unknown, out: ElementLike[] = []): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, target, out);
    return out;
  }
  if (!isElement(node)) return out;
  if (node.type === target) out.push(node);
  findAll(node.props?.children, target, out);
  return out;
}

describe('convertedBookingKind — reads the booking status, not just "converted"', () => {
  it('reads a booking that actually settled as paid', () => {
    expect(convertedBookingKind('confirmed')).toBe('paid');
    expect(convertedBookingKind('completed')).toBe('paid');
  });
  it('reads an open checkout as pending, not paid', () => {
    expect(convertedBookingKind('payment_pending')).toBe('pending');
  });
  it('reads an expired/failed booking as abandoned — the guest never paid', () => {
    expect(convertedBookingKind('expired')).toBe('abandoned');
    expect(convertedBookingKind('failed')).toBe('abandoned');
  });
  it('reads a cancelled/refunded/unknown booking as other', () => {
    expect(convertedBookingKind('cancelled')).toBe('other');
    expect(convertedBookingKind('refunded')).toBe('other');
    expect(convertedBookingKind(null)).toBe('other');
  });
});
