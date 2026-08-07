/**
 * Adding a rental to a quote (Phase B).
 *
 * The editor state and the money path already round-trip a `kind='rental'` line; the one thing that
 * was missing was a way to BUILD one. `rentalLineDraft` is that pure step — the same split as
 * `tourLineDrafts`, so what it decides (the line's KIND, its slug, its price) is pinned here rather
 * than inside a modal only a screenshot can see.
 *
 * The three things that would silently go wrong, and are asserted below:
 *
 *  1. The line must be `kind='rental'`. `quoteItemRows` CLEARS `rental_vehicle_slug` on any line that
 *     is not — so a picker that left the line 'custom' would drop the very slug it just set, and
 *     api_convert_quote's `on delete restrict` FK could never name the vehicle again.
 *  2. The vehicle's SECURITY deposit is a refundable hold, not a charge. If it leaked into the unit
 *     price or the total, api_convert_quote would refuse the whole quote with `quote_total_mismatch`.
 *     The helper never receives it, so it cannot.
 *  3. The price is days × daily rate, in MINOR units — the same arithmetic (`rentalDays`) the public
 *     RentalWidget prices with, so the quoted figure equals what the guest was quoted on /rent.
 */

process.env.TZ = 'UTC';

import { describe, expect, it } from 'vitest';
import {
  emptyQuoteForm,
  formTotalMinor,
  quoteInputFromForm,
  rentalLineDraft,
  type QuoteFormValues,
  type QuoteLineDraft,
} from '@/components/admin/quotes/state';
import { quoteItemRows } from '@/lib/admin/quotes';

/** A real fleet row's shape: a €25/day car with a €300 refundable security deposit. The deposit is
 *  the number that must NOT reach the quote total. */
const MARCH = {
  slug: 'nissan-march',
  name: 'Nissan March',
  dailyRateMinor: 2500,
  depositMinor: 30000,
};

function form(lines: QuoteLineDraft[]): QuoteFormValues {
  return { ...emptyQuoteForm('2026-08-06'), lines };
}

describe('building a rental line', () => {
  it('is a rental line for the chosen vehicle, priced days × daily rate', () => {
    const line = rentalLineDraft({
      slug: MARCH.slug,
      name: MARCH.name,
      dailyRateMinor: MARCH.dailyRateMinor,
      pickupDate: '2026-08-23',
      returnDate: '2026-08-28',
    });
    expect(line.kind).toBe('rental');
    expect(line.rentalVehicleSlug).toBe('nissan-march');
    // rentalDays('2026-08-23','2026-08-28') = 5 whole days.
    expect(line.quantityText).toBe('5');
    expect(line.unitText).toBe('25.00');
    // It is not a catalogue line: nothing for the pay route to re-price, no occurrence, no hold.
    expect(line.catalogueUnitMinor).toBeNull();
    expect(line.sessionOccurrenceId).toBeNull();
    expect(line.activityOptionId).toBeNull();
  });

  it('carries a non-empty description naming the vehicle and its dates', () => {
    // quote_items has a CHECK that a non-catalogue line has a description; an empty one is refused at
    // INSERT (the LAST statement on the edit path), after the total is written and the old lines are
    // gone. And it is the sentence the guest reads on the offer.
    const line = rentalLineDraft({
      slug: MARCH.slug,
      name: MARCH.name,
      dailyRateMinor: MARCH.dailyRateMinor,
      pickupDate: '2026-08-23',
      returnDate: '2026-08-28',
    });
    expect(line.description.trim()).not.toBe('');
    expect(line.description).toContain('Nissan March');
    expect(line.description).toContain('Aug');
  });

  it('survives quoteItemRows with its slug intact, because it is kind=rental', () => {
    const line = rentalLineDraft({
      slug: MARCH.slug,
      name: MARCH.name,
      dailyRateMinor: MARCH.dailyRateMinor,
      pickupDate: '2026-08-23',
      returnDate: '2026-08-28',
    });
    const [row] = quoteItemRows(quoteInputFromForm(form([line])).items);
    expect(row!.kind).toBe('rental');
    expect(row!.rental_vehicle_slug).toBe('nissan-march');
    expect(row!.session_occurrence_id).toBeNull();
    expect(row!.activity_option_id).toBeNull();
    expect(row!.quantity).toBe(5);
    expect(row!.unit_amount_minor).toBe(2500);
    expect(row!.subtotal_minor).toBe(12500);
  });

  it('a same-day pickup and return is one day, priced at one daily rate', () => {
    const line = rentalLineDraft({
      slug: MARCH.slug,
      name: MARCH.name,
      dailyRateMinor: MARCH.dailyRateMinor,
      pickupDate: '2026-08-23',
      returnDate: '2026-08-23',
    });
    expect(line.quantityText).toBe('1');
    expect(formTotalMinor(form([line]))).toBe(2500);
  });

  it('keeps the security deposit out of the quote total', () => {
    // The €300 deposit (MARCH.depositMinor = 30000) is a separate refundable hold. It is not an
    // argument to rentalLineDraft at all, so it cannot enter the unit price — and the total is exactly
    // days × daily rate, with no sign of it. If it leaked in, api_convert_quote would refuse the quote
    // (quote_total_mismatch) at the moment the guest tried to pay.
    const line = rentalLineDraft({
      slug: MARCH.slug,
      name: MARCH.name,
      dailyRateMinor: MARCH.dailyRateMinor,
      pickupDate: '2026-08-23',
      returnDate: '2026-08-28',
    });
    const total = formTotalMinor(form([line]));
    expect(total).toBe(12500);
    expect(total).not.toBe(12500 + MARCH.depositMinor);
  });
});
