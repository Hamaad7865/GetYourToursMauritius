import { describe, expect, it } from 'vitest';
import { serviceWhen } from '@/lib/admin/format';
import { hotelPickupTime, type AdminTransferDetails } from '@/lib/admin/bookings';

/* Every day-slot is materialised at a placeholder NOON, so the back-office printed "12:00" for a 16:00
 * landing — the same bug the invoice had (BMTA0D8CBF245973). serviceWhen is what every admin date/time
 * cell now goes through: the guest's own pickup for a transfer, the occurrence time for a tour. */

/** 12:00 Mauritius on 18 Oct 2026 — where materialize_availability puts every slot. */
const NOON_SLOT = '2026-10-18T08:00:00+00:00';

function transfer(over: Partial<AdminTransferDetails>): AdminTransferDetails {
  return {
    direction: 'arrival',
    roomOrCabin: null,
    flightNumber: null,
    arrivalTime: null,
    returnDate: null,
    returnTime: null,
    departureFlightNumber: null,
    luggageDetails: null,
    childSeatAge: null,
    travellerCountry: null,
    travellerCompany: null,
    travellerGender: null,
    specialNotes: null,
    ...over,
  };
}

describe('serviceWhen', () => {
  it('shows an arrival transfer at the time the guest lands, not the slot noon', () => {
    expect(
      serviceWhen({
        startsAt: NOON_SLOT,
        transfer: transfer({ direction: 'arrival', arrivalTime: '16:00' }),
        pickupTime: null,
        departureTime: null,
      }),
    ).toEqual({ day: '2026-10-18', time: '16:00', at: '2026-10-18T16:00:00+04:00' });
  });

  it('dates a return transfer by its arrival leg', () => {
    expect(
      serviceWhen({
        startsAt: NOON_SLOT,
        transfer: transfer({
          direction: 'return',
          arrivalTime: '09:30',
          returnDate: '2026-10-25',
          returnTime: '18:00',
        }),
        pickupTime: null,
        departureTime: null,
      }),
    ).toMatchObject({ day: '2026-10-18', time: '09:30' });
  });

  it('dates a departure-only transfer by its return_date, not the slot it was booked from', () => {
    // On prod both departure-only bookings sit on a slot 6 days before the real departure.
    expect(
      serviceWhen({
        startsAt: '2026-10-09T08:00:00+00:00',
        transfer: transfer({
          direction: 'departure',
          returnDate: '2026-10-15',
          returnTime: '18:30',
        }),
        pickupTime: null,
        departureTime: null,
      }),
    ).toEqual({ day: '2026-10-15', time: '18:30', at: '2026-10-15T18:30:00+04:00' });
  });

  it('gives a transfer with no time captured its day alone — never the noon placeholder', () => {
    expect(
      serviceWhen({
        startsAt: NOON_SLOT,
        transfer: transfer({}),
        pickupTime: null,
        departureTime: null,
      }),
    ).toMatchObject({ day: '2026-10-18', time: null });
    expect(
      serviceWhen({
        startsAt: '2026-10-09T08:00:00+00:00',
        transfer: transfer({ direction: 'departure', returnDate: '2026-10-15' }),
        pickupTime: null,
        departureTime: null,
      }),
    ).toMatchObject({ day: '2026-10-15', time: null });
  });

  it('shows a hotel-to-hotel transfer at its pickupTime', () => {
    expect(
      serviceWhen({
        startsAt: NOON_SLOT,
        transfer: null,
        pickupTime: '07:15',
        departureTime: null,
      }),
    ).toEqual({
      day: '2026-10-18',
      time: '07:15',
      at: '2026-10-18T07:15:00+04:00',
    });
  });

  it("shows a tour at the start time set on the tour, not the slot's noon", () => {
    expect(
      serviceWhen({
        startsAt: NOON_SLOT,
        transfer: null,
        pickupTime: null,
        departureTime: '09:00',
      }),
    ).toEqual({ day: '2026-10-18', time: '09:00', at: '2026-10-18T09:00:00+04:00' });
  });

  it('gives a tour with no start time set its day alone — never the placeholder clock', () => {
    expect(
      serviceWhen({ startsAt: NOON_SLOT, transfer: null, pickupTime: null, departureTime: null }),
    ).toEqual({ day: '2026-10-18', time: null, at: '2026-10-18T12:00:00+04:00' });
    // A slot made before the July timezone fix sits at 16:00 Mauritius — just as meaningless.
    expect(
      serviceWhen({
        startsAt: '2026-10-18T12:00:00+00:00',
        transfer: null,
        pickupTime: null,
        departureTime: null,
      }),
    ).toMatchObject({ day: '2026-10-18', time: null });
  });

  it("reads the slot's MAURITIUS day, not its UTC date", () => {
    // 21:00 UTC on the 18th is 01:00 on the 19th in Mauritius.
    expect(
      serviceWhen({
        startsAt: '2026-10-18T21:00:00Z',
        transfer: transfer({ arrivalTime: '16:00' }),
        pickupTime: null,
        departureTime: null,
      }),
    ).toMatchObject({ day: '2026-10-19', time: '16:00' });
  });

  it('prints a free-text time as typed but sorts it at noon', () => {
    expect(
      serviceWhen({
        startsAt: NOON_SLOT,
        transfer: transfer({ arrivalTime: '4pm' }),
        pickupTime: null,
        departureTime: null,
      }),
    ).toEqual({ day: '2026-10-18', time: '4pm', at: '2026-10-18T12:00:00+04:00' });
  });

  it('pads a single-digit hour in the sort instant', () => {
    expect(
      serviceWhen({
        startsAt: NOON_SLOT,
        transfer: transfer({ arrivalTime: '7:05' }),
        pickupTime: null,
        departureTime: null,
      })?.at,
    ).toBe('2026-10-18T07:05:00+04:00');
  });

  it('returns null with nothing to date', () => {
    expect(
      serviceWhen({ startsAt: null, transfer: null, pickupTime: null, departureTime: null }),
    ).toBeNull();
    expect(
      serviceWhen({
        startsAt: null,
        transfer: transfer({}),
        pickupTime: null,
        departureTime: null,
      }),
    ).toBeNull();
  });
});

describe('hotelPickupTime', () => {
  it("reads arrival_time as a hotel-to-hotel transfer's pickup (it has no airport direction)", () => {
    expect(hotelPickupTime({ trip_direction: null, arrival_time: '07:15' })).toBe('07:15');
    expect(hotelPickupTime({ trip_direction: null, arrival_time: null })).toBeNull();
  });

  it('leaves an airport transfer to its transfer block', () => {
    expect(hotelPickupTime({ trip_direction: 'arrival', arrival_time: '16:00' })).toBeNull();
  });
});
