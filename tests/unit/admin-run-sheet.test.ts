import { describe, expect, it } from 'vitest';
import { runSheet } from '@/lib/admin/run-sheet';
import { installmentPaid, nextInstallment } from '@/lib/admin/installments';
import { DAY, departure, party, quoteLine, returnLeg } from '../helpers/admin-day';

/* The printed run sheet: one day, from the same entries the Calendar's day sheet draws, readable
 * without colour, money only for those who see money. */

describe('runSheet', () => {
  it('heads the page with the day and its totals', () => {
    const s = runSheet(
      [departure(), departure({ occurrenceId: 'off', status: 'cancelled', pax: 2 })],
      DAY,
      DAY,
      { showMoney: true },
    );
    expect(s.title).toBe('Saturday 14 November 2026');
    expect(s.totals).toBe('1 departure, 4 guests, 1 called off');
    expect(s.blocks.find((b) => b.key === 'occ-off')!.calledOff).toBe(true);
  });

  it('prints each departure with its time, tour, option and headline numbers', () => {
    const s = runSheet([departure({ pendingPax: 2, units: 4 })], DAY, DAY, { showMoney: false });
    expect(s.blocks[0]).toMatchObject({
      time: '09:00',
      title: 'Catamaran cruise, 3 northern islands',
      subtitle: 'Shared catamaran',
      calledOff: false,
      summary: '4 guests · +2 unpaid · 4 of 12 · 8 h',
    });
  });

  it('never prints the slot’s placeholder clock: an untimed tour reads "Time TBC"', () => {
    const s = runSheet([departure({ departureTime: null })], DAY, DAY, { showMoney: false });
    expect(s.blocks[0]!.time).toBe('Time TBC');
  });

  it('lists each party with what the driver needs', () => {
    const s = runSheet(
      [
        departure({
          bookings: [
            party({
              childSeats: 2,
              supplements: [{ name: 'Lunch', qty: 4 }],
              staffNote: 'Celebrating an anniversary',
              customItinerary: [{ title: 'Chamarel', area: 'South' }, { title: 'Le Morne' }],
            }),
          ],
        }),
      ],
      DAY,
      DAY,
      { showMoney: false },
    );
    const p = s.blocks[0]!.parties[0]!;
    expect(p).toMatchObject({
      name: 'Marie Dupont',
      ref: 'BMT-1',
      guests: '2 × Adult · 2 × Child',
      unpaid: false,
      pickupPlace: 'Lux Belle Mare, Belle Mare',
      payment: null,
      balanceDue: null,
    });
    expect(p.facts).toEqual([
      { k: 'Drop-off', v: 'Same as pickup' },
      { k: 'Room', v: '214' },
      { k: 'Child seats', v: '2 seats to fit' },
      { k: 'Extras', v: '4 × Lunch' },
      { k: 'Route', v: 'Chamarel (South) → Le Morne' },
      { k: 'Phone', v: '+33 6 12 34 56 78' },
      { k: 'Notes', v: 'Celebrating an anniversary' },
    ]);
  });

  it('prints a pickup still to be given, or none at all, in words', () => {
    const s = runSheet(
      [
        departure({
          bookings: [
            party({ id: 'p', pickupLocation: null, pickupPending: true }),
            party({ id: 'o', pickupLocation: null }),
          ],
        }),
      ],
      DAY,
      DAY,
      { showMoney: false },
    );
    const [pending, own] = s.blocks[0]!.parties;
    expect(pending).toMatchObject({ pickupPlace: null, pickupNote: 'To be arranged' });
    expect(own).toMatchObject({ pickupPlace: null, pickupNote: 'Makes own way' });
  });

  it('prints a transfer guest’s own pickup time and flight', () => {
    const s = runSheet(
      [
        departure({
          isAirportTransfer: true,
          departureTime: null,
          activityTitle: 'Airport transfer',
          optionName: 'Sedan',
          bookings: [
            party({
              pickupLocation: 'SSR International Airport (arrivals)',
              dropoffLocation: 'Lux Belle Mare, Belle Mare',
              transfer: {
                direction: 'arrival',
                flightNumber: 'MK 015',
                arrivalTime: '06:45',
                departureFlightNumber: null,
                returnDate: null,
                returnTime: null,
                luggageDetails: '3 large cases',
                childSeatAge: null,
              } as never,
              pickupTime: '06:45',
            }),
          ],
        }),
      ],
      DAY,
      DAY,
      { showMoney: false },
    );
    const p = s.blocks[0]!.parties[0]!;
    expect(p.pickupNote).toContain('06:45');
    expect(p.facts).toEqual(
      expect.arrayContaining([
        { k: 'Flight', v: 'MK 015 · lands 06:45' },
        { k: 'Luggage', v: '3 large cases' },
      ]),
    );
  });

  it('prints payment only for a viewer who sees money, and a balance only when genuinely owed', () => {
    const entries = [
      departure({
        bookings: [
          party({ id: 'paid' }),
          party({ id: 'part', payView: 'part_paid', balanceDueEur: 135 }),
          // An unpaid party carries balance = total; that is not a debt to print.
          party({
            id: 'unpaid',
            counted: false,
            status: 'payment_pending',
            paymentState: 'pending',
            payView: 'pending',
            balanceDueEur: 372,
          }),
        ],
      }),
    ];
    const withMoney = runSheet(entries, DAY, DAY, { showMoney: true }).blocks[0]!.parties;
    expect(withMoney.map((p) => [p.payment?.label, p.balanceDue])).toEqual([
      ['Paid', null],
      ['Part paid', '€135 still owed'],
      ['Awaiting payment', null],
    ]);
    expect(withMoney[2]!.unpaid).toBe(true);
    const without = runSheet(entries, DAY, DAY, { showMoney: false }).blocks[0]!.parties;
    expect(without.every((p) => p.payment === null && p.balanceDue === null)).toBe(true);
  });

  it('includes quote lines, rentals and return legs, each with its own facts', () => {
    const s = runSheet(
      [
        quoteLine({ staffNote: 'Gate pass at 08:00', roomOrCabin: '12' }),
        quoteLine({
          id: 'r',
          lineKind: 'rental',
          description: 'Car rental · Suzuki Swift',
          guests: null,
          quantity: 2,
          endsAt: '2026-11-17T08:00:00Z',
          pickupLabel: null,
        }),
        returnLeg({ flightNumber: null }),
      ],
      DAY,
      DAY,
      { showMoney: false },
    );
    const byKey = Object.fromEntries(s.blocks.map((b) => [b.key, b]));
    expect(byKey['ci-ci1']!.parties[0]).toMatchObject({
      name: 'James Carter',
      guests: '2 guests',
      pickupPlace: 'Constance Belle Mare Plage, Belle Mare',
    });
    // Like the day sheet: a quote line's pickup with no drop-off reads "Same as pickup".
    expect(byKey['ci-ci1']!.parties[0]!.facts).toEqual([
      { k: 'Drop-off', v: 'Same as pickup' },
      { k: 'Room', v: '12' },
      { k: 'Booked as', v: 'Private south tour' },
      { k: 'Notes', v: 'Gate pass at 08:00' },
    ]);
    expect(byKey['ci-r']!.time).toBe('All day');
    expect(byKey['ci-r']!.parties[0]!.facts).toEqual(
      expect.arrayContaining([
        { k: 'Return', v: '17 Nov' },
        { k: 'Vehicles', v: '2' },
      ]),
    );
    const leg = byKey['rl-b7']!;
    expect(leg.time).toBe('18:30');
    expect(leg.parties[0]).toMatchObject({
      guests: 'Sedan · 3 pax',
      pickupPlace: 'Ambre Resort & Spa, Belle Mare',
      pickupNote: '18:30',
    });
    expect(leg.parties[0]!.facts).toEqual(
      expect.arrayContaining([
        { k: 'Drop-off', v: 'SSR International Airport (departures)' },
        { k: 'Flight', v: 'Not provided yet' },
        { k: 'Phone', v: '+44 7700 900123' },
      ]),
    );
  });

  it('only the asked-for day, and a past day says "Not recorded"', () => {
    const s = runSheet(
      [departure({ bookings: [party({ pickupLocation: null, pickupPending: true })] })],
      DAY,
      '2026-11-20',
      { showMoney: false },
    );
    expect(s.blocks[0]!.parties[0]!.pickupNote).toBe('Not recorded');
    expect(runSheet([departure()], '2026-11-15', DAY, { showMoney: false }).blocks).toEqual([]);
  });
});

describe('installments', () => {
  const rows = [
    { seq: 0, dueOn: '2026-11-01', label: 'Deposit', amountEur: 18, coveredEur: 18 },
    { seq: 1, dueOn: '2026-11-20', label: '20 Nov', amountEur: 90, coveredEur: 89.996 },
    { seq: 2, dueOn: '2026-11-22', label: '22 Nov', amountEur: 72, coveredEur: 10 },
  ];

  it('treats half a cent of rounding as paid', () => {
    expect(installmentPaid(rows[1]!)).toBe(true);
    expect(installmentPaid(rows[2]!)).toBe(false);
  });

  it('the next one is the earliest not yet covered, or none', () => {
    expect(nextInstallment(rows)!.seq).toBe(2);
    expect(nextInstallment([rows[0]!])).toBeNull();
    expect(nextInstallment(null)).toBeNull();
  });
});
