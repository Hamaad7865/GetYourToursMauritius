/**
 * Attaching a TRANSPORT add-on to a quote (Phase 1 — transport).
 *
 * A guest who books an excursion often wants collecting from their hotel, and the price of that
 * round-trip drive scales with how far the hotel is from where the activity boards — the exact model
 * `transport_fare_minor` / `transportFareMinor` already price for the public booking widget
 * (20260720000000_activity_transport_pricing). This wires that engine into the quote editor:
 *
 *   1. `activityRegion` resolves the boarding region a fare is priced against — the SAME
 *      `coalesce(region, region_from_coords(lat, lng))` the SQL uses, so a quoted transfer matches
 *      what the guest would have been charged booking the activity directly.
 *   2. `transportLineDraft` turns a computed fare into a CUSTOM quote line — not a catalogue one:
 *      a transfer holds no seat and has no occurrence to re-price against, so it must round-trip
 *      through `quoteItemRows` as `kind='custom'` (occurrence/option/slug all cleared, description
 *      present) or api_convert_quote would refuse it. The operator can edit the figure afterwards,
 *      which is the whole point of "auto-suggest, editable".
 */

process.env.TZ = 'UTC';

import { describe, expect, it } from 'vitest';
import {
  activityRegion,
  emptyQuoteForm,
  formTotalMinor,
  quoteInputFromForm,
  transportLineDraft,
  type QuoteFormValues,
  type QuoteLineDraft,
} from '@/components/admin/quotes/state';
import { quoteItemRows } from '@/lib/admin/quotes';

function form(lines: QuoteLineDraft[]): QuoteFormValues {
  return { ...emptyQuoteForm('2026-08-06'), lines };
}

describe('activityRegion — the boarding region a transfer is priced against', () => {
  it('prefers the explicit region when the activity has one', () => {
    expect(activityRegion({ region: 'West', lat: -20.19, lng: 57.76 })).toBe('West');
  });

  it('derives the region from coordinates when no explicit region is set', () => {
    // regionFromCoords(-20.44, 57.55) -> 'South' (lat <= -20.42). The SQL coalesce does the same.
    expect(activityRegion({ region: null, lat: -20.44, lng: 57.55 })).toBe('South');
  });

  it('is null when there is neither a region nor coordinates', () => {
    // A fare priced against a null region is 0 (no pickup -> no fee): the operator types the figure.
    expect(activityRegion({ region: null, lat: null, lng: null })).toBeNull();
  });
});

describe('building a transport (transfer) line', () => {
  const PICK = {
    activityTitle: 'Dolphin swim at Île aux Bénitiers',
    pickupLabel: 'Crystals Beach Resort, Belle Mare',
    fareMinor: 6000, // €60 round-trip, as computed by transportFareMinor for this hotel + activity
  };

  it('is a custom line carrying the computed fare at quantity one', () => {
    const line = transportLineDraft(PICK);
    // One flat round-trip fare for the party — NOT per person: transportFareMinor already returns the
    // whole-vehicle price, so the line is qty 1 × the fare, exactly like the email's "Transfert 60 EUR".
    expect(line.kind).toBe('custom');
    expect(line.quantityText).toBe('1');
    expect(line.unitText).toBe('60.00');
    // Not a catalogue or rental line: nothing to re-price, no occurrence, no seat, no vehicle.
    expect(line.catalogueUnitMinor).toBeNull();
    expect(line.sessionOccurrenceId).toBeNull();
    expect(line.activityOptionId).toBeNull();
    expect(line.rentalVehicleSlug).toBeNull();
  });

  it('describes the transfer in the guest’s words, naming the activity and the pickup', () => {
    // quote_items CHECKs a non-catalogue line has a description; it is also the sentence the guest
    // reads on the offer, so it must name what the transfer is for and where it collects from.
    const line = transportLineDraft(PICK);
    expect(line.description.trim()).not.toBe('');
    expect(line.description).toContain('Dolphin swim at Île aux Bénitiers');
    expect(line.description).toContain('Crystals Beach Resort, Belle Mare');
  });

  it('survives quoteItemRows as a custom line, priced as typed', () => {
    const line = transportLineDraft(PICK);
    const [row] = quoteItemRows(quoteInputFromForm(form([line])).items);
    expect(row!.kind).toBe('custom');
    expect(row!.session_occurrence_id).toBeNull();
    expect(row!.activity_option_id).toBeNull();
    expect(row!.rental_vehicle_slug).toBeNull();
    expect(row!.quantity).toBe(1);
    expect(row!.unit_amount_minor).toBe(6000);
    expect(row!.subtotal_minor).toBe(6000);
  });

  it('carries the excursion day when given, so the run sheet can place it', () => {
    // A transfer belongs to the day of the excursion it serves. Carrying the date lets
    // booking_custom_items.starts_at land it on the operations day sheet after conversion.
    const line = transportLineDraft({ ...PICK, date: '2026-09-04' });
    const [item] = quoteInputFromForm(form([line])).items;
    // Mauritius wall-clock midnight of the excursion day (fixed +04:00, no DST).
    expect(item!.startsAt).toBe('2026-09-03T20:00:00.000Z');
  });

  it('still builds a (zero-priced) line when the fare is unknown, for the operator to price', () => {
    // A missing boarding region yields a 0 fare (no pickup -> no fee). The line is still created so the
    // operator can type the real transfer price rather than being blocked.
    const line = transportLineDraft({ ...PICK, fareMinor: 0 });
    expect(line.kind).toBe('custom');
    expect(line.unitText).toBe('0.00');
    expect(formTotalMinor(form([line]))).toBe(0);
  });

  it('drops the "from" clause when no pickup label is known yet', () => {
    const line = transportLineDraft({ ...PICK, pickupLabel: '' });
    expect(line.description).toContain('Dolphin swim at Île aux Bénitiers');
    expect(line.description).not.toContain('from ');
  });
});
