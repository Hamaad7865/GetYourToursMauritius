import { describe, expect, it } from 'vitest';
import {
  canMarkCompleted,
  completeWarning,
  drawerAttention,
  drawerMoney,
  drawerPrimary,
  listNeighbours,
  otherBookingCount,
  parseDrawerTab,
  paymentEventTone,
  type DrawerBooking,
} from '@/components/admin/bookings/rules';

/** The booking panel's rules: tabs, attention tiles, the money band, the main action. */

const TODAY = '2026-11-15';

function item(day: string | null, departureTime: string | null = '09:00') {
  return {
    priceLabel: 'Adult',
    quantity: 2,
    pax: null,
    unitAmountEur: 55,
    subtotalEur: 110,
    activityTitle: 'Catamaran Cruise',
    optionName: 'Standard',
    // A day-slot sits at noon Mauritius time (08:00 UTC).
    startsAt: day ? `${day}T08:00:00+00:00` : null,
    departureTime,
    transportFareEur: 0,
    transportPickupLabel: null,
    transportDropoffLabel: null,
  };
}

function booking(
  over: Partial<DrawerBooking & { ref: string }> = {},
): DrawerBooking & { ref: string } {
  return {
    ref: 'BMTTEST',
    status: 'confirmed',
    paymentState: 'paid',
    totalEur: 110,
    depositEur: 0,
    balanceDueEur: 0,
    netPaidEur: 110,
    grossPaidEur: 110,
    refundedEur: 0,
    installments: [],
    pickupLocation: 'Hotel Belle Mare, Coastal Road',
    dropoffLocation: null,
    pickupPending: false,
    transportPickup: null,
    transportDropoff: null,
    transfer: null,
    pickupTime: null,
    items: [item('2026-11-20')],
    ...over,
  };
}

describe('parseDrawerTab', () => {
  it('reads the three tabs and falls back to Overview', () => {
    expect(parseDrawerTab('payment')).toBe('payment');
    expect(parseDrawerTab('notes')).toBe('notes');
    expect(parseDrawerTab('nope')).toBe('overview');
    expect(parseDrawerTab(null)).toBe('overview');
  });
});

describe('drawerAttention', () => {
  it('has nothing to say about a paid, confirmed booking with a pickup', () => {
    expect(drawerAttention(booking(), { canRefund: true, today: TODAY })).toEqual([]);
  });

  it('asks whoever can refund to record a waiting refund, with the amount', () => {
    const b = booking({ status: 'refund_pending', netPaidEur: 110 });
    const [tile] = drawerAttention(b, { canRefund: true, today: TODAY });
    expect(tile).toMatchObject({ id: 'refund', title: 'Refund to record', target: 'payment' });
    expect(tile!.detail).toContain('€110');
  });

  it('tells someone who cannot refund that the owner records it', () => {
    const b = booking({ status: 'refund_pending' });
    const [tile] = drawerAttention(b, { canRefund: false, today: TODAY });
    expect(tile).toMatchObject({ id: 'refund', title: 'Refund waiting' });
    expect(tile!.detail).toMatch(/owner/i);
  });

  it('flags a balance on a part-paid deposit booking, with the next installment', () => {
    const b = booking({
      totalEur: 350,
      depositEur: 105,
      balanceDueEur: 245,
      netPaidEur: 105,
      grossPaidEur: 105,
      installments: [
        { seq: 1, dueOn: '2026-11-10', label: 'Deposit', amountEur: 105, coveredEur: 105 },
        { seq: 2, dueOn: '2026-12-01', label: 'Balance', amountEur: 245, coveredEur: 0 },
      ],
    });
    const tiles = drawerAttention(b, { canRefund: true, today: TODAY });
    expect(tiles.map((t) => t.id)).toEqual(['balance']);
    expect(tiles[0]!.title).toContain('€245');
    expect(tiles[0]!.detail).toMatch(/^Next: €245(\.00)? due /);
  });

  it('never calls balance_due a debt on a booking nobody has paid', () => {
    // A never-paid quote carries balance_due = total; that is not "still to collect".
    const b = booking({
      status: 'payment_pending',
      paymentState: 'pending',
      depositEur: 35,
      balanceDueEur: 350,
      totalEur: 350,
      netPaidEur: 0,
      grossPaidEur: 0,
    });
    expect(drawerAttention(b, { canRefund: true, today: TODAY })).toEqual([]);
  });

  it('flags a pickup still to be arranged on an upcoming confirmed trip', () => {
    const b = booking({ pickupLocation: null, pickupPending: true });
    const tiles = drawerAttention(b, { canRefund: true, today: TODAY });
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({
      id: 'pickup',
      title: 'Pickup to be arranged',
      target: 'pickup',
    });
    expect(tiles[0]!.detail).toContain('09:00');
  });

  it('does not chase the pickup once the trip is over, or when a round-trip transfer is the pickup', () => {
    const past = booking({
      pickupLocation: null,
      pickupPending: true,
      items: [item('2026-11-01')],
    });
    expect(drawerAttention(past, { canRefund: true, today: TODAY })).toEqual([]);
    const viaTransfer = booking({
      pickupLocation: null,
      pickupPending: true,
      transportPickup: 'Lux Belle Mare',
    });
    expect(drawerAttention(viaTransfer, { canRefund: true, today: TODAY })).toEqual([]);
  });
});

describe('drawerMoney', () => {
  const labels = (b: DrawerBooking) => drawerMoney(b).map((f) => `${f.label} ${f.amountEur}`);

  it('shows a settled booking with no balance', () => {
    expect(labels(booking())).toEqual(['Total 110', 'Paid 110', 'Balance 0']);
  });

  it('shows what is to refund on a refund-pending booking', () => {
    const b = booking({ status: 'refund_pending', netPaidEur: 110 });
    expect(labels(b)).toEqual(['Total 110', 'Paid 110', 'To refund 110']);
    expect(drawerMoney(b)[2]!.tone).toBe('warn');
  });

  it('shows money that went back beside what was paid, never netting it twice', () => {
    const b = booking({
      paymentState: 'partially_refunded',
      netPaidEur: 80,
      grossPaidEur: 110,
      refundedEur: 30,
    });
    expect(labels(b)).toEqual(['Total 110', 'Paid 110', 'Refunded 30']);
  });

  it('shows the balance still to collect on a part-paid booking', () => {
    const b = booking({
      totalEur: 350,
      depositEur: 105,
      balanceDueEur: 245,
      netPaidEur: 105,
      grossPaidEur: 105,
    });
    expect(labels(b)).toEqual(['Total 350', 'Paid 105', 'Still to collect 245']);
  });

  it('shows a booking still in checkout as not paid yet', () => {
    const b = booking({
      status: 'payment_pending',
      paymentState: 'pending',
      netPaidEur: 0,
      grossPaidEur: 0,
    });
    expect(labels(b)).toEqual(['Total 110', 'Paid 0', 'Not paid yet 110']);
  });

  it('adds no third figure to a cancelled booking that was never paid', () => {
    const b = booking({
      status: 'cancelled',
      paymentState: 'pending',
      netPaidEur: 0,
      grossPaidEur: 0,
    });
    expect(labels(b)).toEqual(['Total 110', 'Paid 0']);
  });
});

describe('drawerPrimary', () => {
  it('offers to review a refund, except on the Payment tab where it is recorded', () => {
    const b = booking({ status: 'refund_pending' });
    expect(drawerPrimary(b, { canRefund: true, today: TODAY, tab: 'overview' })).toEqual({
      kind: 'review-refund',
      label: 'Review refund',
    });
    expect(drawerPrimary(b, { canRefund: true, today: TODAY, tab: 'payment' })).toBeNull();
    expect(drawerPrimary(b, { canRefund: false, today: TODAY, tab: 'overview' })).toBeNull();
  });

  it('offers to mark a confirmed booking completed once its last day has passed', () => {
    const past = booking({ items: [item('2026-11-01'), item('2026-11-14')] });
    expect(drawerPrimary(past, { canRefund: true, today: TODAY, tab: 'overview' })).toEqual({
      kind: 'complete',
      label: 'Mark as completed',
    });
    const stillOn = booking({ items: [item('2026-11-01'), item('2026-11-15')] });
    expect(drawerPrimary(stillOn, { canRefund: true, today: TODAY, tab: 'overview' })).toBeNull();
  });

  it('has no main action for an upcoming trip', () => {
    expect(drawerPrimary(booking(), { canRefund: true, today: TODAY, tab: 'overview' })).toBeNull();
  });
});

describe('paymentEventTone', () => {
  it('colours the provider’s free-text event types by meaning', () => {
    expect(paymentEventTone('paid')).toBe('ok');
    expect(paymentEventTone('captured')).toBe('ok');
    expect(paymentEventTone('refunded')).toBe('info');
    expect(paymentEventTone('partially_refunded')).toBe('info');
    expect(paymentEventTone('failed')).toBe('bad');
    expect(paymentEventTone('declined')).toBe('bad');
    expect(paymentEventTone('pending')).toBe('neutral');
    expect(paymentEventTone('intent')).toBe('neutral');
  });
});

describe('otherBookingCount', () => {
  const rows = [
    { id: 'a', customerEmail: 'Ana@Example.com' },
    { id: 'b', customerEmail: 'ana@example.com ' },
    { id: 'c', customerEmail: 'someone@else.com' },
    { id: 'd', customerEmail: 'deleted@privacy.invalid' },
    { id: 'e', customerEmail: 'deleted@privacy.invalid' },
  ];

  it('counts the guest’s other bookings, ignoring case and spaces', () => {
    expect(otherBookingCount(rows, 'a')).toBe(1);
    expect(otherBookingCount(rows, 'c')).toBe(0);
  });

  it('never groups erased guests under their shared placeholder address', () => {
    expect(otherBookingCount(rows, 'd')).toBe(0);
  });

  it('is zero when the open booking is not in the list', () => {
    expect(otherBookingCount(rows, 'zzz')).toBe(0);
    expect(otherBookingCount(rows, null)).toBe(0);
  });
});

describe('listNeighbours', () => {
  it('finds the bookings either side of the open one in the list as shown', () => {
    expect(listNeighbours(['a', 'b', 'c'], 'b')).toEqual({ prev: 'a', next: 'c', index: 1 });
    expect(listNeighbours(['a', 'b', 'c'], 'a')).toEqual({ prev: null, next: 'b', index: 0 });
    expect(listNeighbours(['a', 'b', 'c'], 'c')).toEqual({ prev: 'b', next: null, index: 2 });
  });

  it('has no neighbours for a booking the filters hide, or none open', () => {
    expect(listNeighbours(['a', 'b'], 'z')).toEqual({ prev: null, next: null, index: -1 });
    expect(listNeighbours(['a', 'b'], null)).toEqual({ prev: null, next: null, index: -1 });
  });
});

describe('a booking made from a multi-line quote', () => {
  /** A quote line: no tour, just its own dates (Mauritius midnight when the quote gave no time). */
  const line = (start: string, end: string | null = null) => ({
    description: 'Private driver',
    startsAt: `${start}T00:00:00+04:00`,
    endsAt: end ? `${end}T00:00:00+04:00` : null,
    quantity: 1,
    subtotalEur: 90,
    transportFareEur: 0,
    transportPickupLabel: null,
    transportDropoffLabel: null,
  });

  it('can be marked completed once its last quote line has passed', () => {
    const past = booking({ items: [], customItems: [line('2026-11-10'), line('2026-11-12')] });
    expect(drawerPrimary(past, { canRefund: true, today: TODAY, tab: 'overview' })).toEqual({
      kind: 'complete',
      label: 'Mark as completed',
    });
    // A rental that is still out (its return day is after today) is not finished yet.
    const out = booking({ items: [], customItems: [line('2026-11-10', '2026-11-18')] });
    expect(drawerPrimary(out, { canRefund: true, today: TODAY, tab: 'overview' })).toBeNull();
  });

  // Regression: a multi-day quote trip (lines 13 → 22 Nov), half paid, was marked completed from the
  // "More" menu on 17 Nov while it was still running — and the balance link then 409'd.
  const midTrip = () =>
    booking({
      ref: 'BMTMIDTRIP',
      items: [],
      customItems: [
        line('2026-11-13'),
        line('2026-11-16'),
        line('2026-11-18'),
        line('2026-11-20'),
        line('2026-11-22'),
      ],
      totalEur: 645,
      depositEur: 322.5,
      balanceDueEur: 322.5,
      netPaidEur: 322.5,
      grossPaidEur: 322.5,
    });

  it('cannot be completed while any quote line is still to come', () => {
    expect(canMarkCompleted(midTrip(), '2026-11-17')).toBe(false);
    expect(
      drawerPrimary(midTrip(), { canRefund: true, today: '2026-11-17', tab: 'overview' }),
    ).toBeNull();
  });

  it('cannot be completed on its last day, only the day after', () => {
    expect(canMarkCompleted(midTrip(), '2026-11-22')).toBe(false);
    expect(canMarkCompleted(midTrip(), '2026-11-23')).toBe(true);
  });

  it('never suggests completion while a balance is owed, and warns if staff choose it', () => {
    const after = '2026-11-23';
    expect(drawerPrimary(midTrip(), { canRefund: true, today: after, tab: 'overview' })).toBeNull();
    const warning = completeWarning(midTrip());
    expect(warning).toContain('€322.50');
    expect(warning).toContain('BMTMIDTRIP');
    expect(warning).toMatch(/balance link/);
  });

  it('asks nothing extra before completing a booking that owes nothing', () => {
    const settled = booking({ ref: 'BMTPAID', items: [], customItems: [line('2026-11-10')] });
    expect(completeWarning(settled)).toBeNull();
    expect(canMarkCompleted(settled, TODAY)).toBe(true);
  });

  it('dates the pickup tile from its first quote line', () => {
    const b = booking({
      items: [],
      customItems: [line('2026-11-21'), line('2026-11-19')],
      pickupLocation: null,
      pickupPending: true,
    });
    const tile = drawerAttention(b, { canRefund: true, today: TODAY }).find(
      (a) => a.id === 'pickup',
    );
    expect(tile?.detail).toBe('Trip 19 Nov');
  });
});
