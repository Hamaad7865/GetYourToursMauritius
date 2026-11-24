import { describe, expect, it } from 'vitest';
import {
  AWAITING_ROWS,
  BALANCE_ROWS,
  balanceAction,
  daySummary,
  needsYou,
  runChip,
  quietDays,
  departuresByDay,
  runSheetRows,
  todayKpis,
  todaySentence,
  tomorrowLine,
  tomorrowOf,
  type TodayKpiInput,
  type TodayViewer,
} from '@/components/admin/today/rules';
import { statsFor, computeDashboard } from '@/lib/admin/dashboard';
import { capacityUse, summarize, ALL_TYPES_ON, toCalLines } from '@/lib/admin/calendar-view';
import type { QuoteRow } from '@/lib/admin/quotes';
import type { LeadRow } from '@/lib/admin/leads';
import {
  DAY,
  bookingRow,
  departure,
  party,
  quoteLine,
  returnLeg,
  slot,
} from '../helpers/admin-day';

/* Today, the back office's home (phase 2): the figures, the run sheet and "Needs you", for every
 * permission combination. */

const OWNER: TodayViewer = {
  showMoney: true,
  showBookings: true,
  showDepartures: true,
  showCalendar: true,
  showQuotes: true,
  showLeads: true,
};
const NONE: TodayViewer = {
  showMoney: false,
  showBookings: false,
  showDepartures: false,
  showCalendar: false,
  showQuotes: false,
  showLeads: false,
};

const NOW = new Date('2026-11-14T06:00:00Z'); // 10:00 in Mauritius

function quote(over: Partial<QuoteRow> = {}): QuoteRow {
  return {
    id: 'q1',
    ref: 'Q-1',
    customerName: 'Lukas Weber',
    customerEmail: 'lukas@example.com',
    customerPhone: null,
    status: 'sent',
    currency: 'EUR',
    totalMinor: 45500,
    validUntil: '2099-12-31',
    introNote: null,
    internalNotes: null,
    sentAt: '2026-11-11T10:00:00Z',
    bookingId: null,
    convertedAt: null,
    roomOrCabin: null,
    locale: 'en',
    createdAt: '2026-11-11T09:00:00Z',
    updatedAt: '2026-11-11T09:00:00Z',
    ...over,
  };
}

function lead(over: Partial<LeadRow> = {}): LeadRow {
  return {
    id: 'l1',
    name: 'Ana',
    contact: 'ana@example.com',
    status: 'new',
    source: 'contact',
    interestActivityTitle: null,
    message: null,
    pageUrl: null,
    preferredDate: null,
    partySize: null,
    createdAt: '2026-11-14T04:00:00Z',
    ...over,
  };
}

function kpiInput(viewer: TodayViewer, over: Partial<TodayKpiInput> = {}): TodayKpiInput {
  const dash = computeDashboard(
    [bookingRow({ id: 'p', paymentState: 'pending', status: 'payment_pending', totalEur: 165 })],
    NOW,
  );
  return {
    stats: statsFor(dash.stats, viewer),
    today: DAY,
    revenueDeltaPct: 12,
    pendingCount: dash.pendingCount,
    pendingTotalEur: dash.pendingTotalEur,
    calendar: {
      today: { departures: 4, calledOff: 0, guests: 23, pickups: 9 },
      next7Departures: 19,
    },
    quotes: {
      waiting: { count: 2, totalMinor: 63500 },
      balance: { count: 0, owedMinor: 0 },
      expired: 0,
      drafts: 0,
      paid: 0,
    },
    ...over,
  };
}

describe('Today — the figures across the top', () => {
  it('shows the Owner all five, each linked', () => {
    const k = todayKpis(kpiInput(OWNER), OWNER);
    expect(k.map((x) => x.label)).toEqual([
      'Departures today',
      'Taken, last 7 days',
      'Awaiting payment',
      'Departures, next 7 days',
      'Quotes waiting',
    ]);
    expect(k[0]).toMatchObject({ value: '4', detail: '23 guests, 9 pickups' });
    expect(k[0]!.href).toBe(`/admin/calendar?day=${DAY}`);
    expect(k[1]!.detail).toBe('+12% against the 7 days before');
    expect(k[2]).toMatchObject({
      value: '1',
      detail: '€165 not yet paid',
      href: '/admin/bookings?view=awaiting',
    });
    expect(k[3]).toMatchObject({ value: '19', href: '/admin/calendar' });
    expect(k[4]).toMatchObject({
      value: '2',
      detail: '€635 sent and still valid',
      href: '/admin/quotes',
    });
  });

  it('never invents a comparison: no prior week, no percentage', () => {
    const k = todayKpis(kpiInput(OWNER, { revenueDeltaPct: null }), OWNER);
    expect(k.find((x) => x.key === 'revenue')!.detail).toBe('On bookings made in the last 7 days');
    const down = todayKpis(kpiInput(OWNER, { revenueDeltaPct: -8 }), OWNER);
    expect(down.find((x) => x.key === 'revenue')!.detail).toBe('−8% against the 7 days before');
  });

  it('gives Bookings-only staff counts, no euros and no quotes card', () => {
    const v: TodayViewer = { ...NONE, showBookings: true, showDepartures: true };
    const k = todayKpis(kpiInput(v), v);
    expect(k.map((x) => x.key)).toEqual(['today', 'pending', 'upcoming']);
    expect(k.find((x) => x.key === 'pending')!.detail).toBe('Bookings not yet paid');
    // No Calendar: the departures drill into the Bookings tabs instead.
    expect(k.find((x) => x.key === 'today')!.href).toBe('/admin/bookings?view=today');
    expect(k.find((x) => x.key === 'upcoming')!.href).toBe('/admin/bookings?view=next7');
  });

  it('gives Calendar-only staff departures, unlinked into Bookings', () => {
    const v: TodayViewer = { ...NONE, showDepartures: true, showCalendar: true };
    const k = todayKpis(kpiInput(v), v);
    expect(k.map((x) => x.key)).toEqual(['today', 'upcoming']);
    expect(k[0]!.href).toBe(`/admin/calendar?day=${DAY}`);
  });

  it('a quotes person without money sees the count, not the euros', () => {
    const v: TodayViewer = { ...NONE, showQuotes: true };
    const k = todayKpis(kpiInput(v), v);
    expect(k).toEqual([
      {
        key: 'quotes',
        label: 'Quotes waiting',
        value: '2',
        detail: 'Sent and still valid',
        href: '/admin/quotes',
      },
    ]);
  });

  it('says "Could not load" in the card whose read failed, never another rule’s number', () => {
    const k = todayKpis(kpiInput(OWNER, { calendar: 'error', quotes: 'error' }), OWNER);
    expect(k.find((x) => x.key === 'today')).toMatchObject({
      value: '—',
      detail: 'Could not load',
    });
    expect(k.find((x) => x.key === 'upcoming')).toMatchObject({
      value: '—',
      detail: 'Could not load',
    });
    expect(k.find((x) => x.key === 'quotes')).toMatchObject({
      value: '—',
      detail: 'Could not load',
    });
    // The bookings figures did load and stay.
    expect(k.find((x) => x.key === 'pending')!.value).toBe('1');
    const loading = todayKpis(kpiInput(OWNER, { calendar: null, quotes: null }), OWNER);
    expect(loading.find((x) => x.key === 'today')).toMatchObject({ value: '…', detail: 'Loading' });
  });

  it('shows nothing to a role that may see none of it', () => {
    expect(todayKpis(kpiInput(NONE), NONE)).toEqual([]);
  });
});

describe('Today — the day, by the Calendar’s rule', () => {
  it('counts departures and PAID guests exactly as the calendar summarises the day', () => {
    const entries = [
      departure({
        pax: 8,
        pendingPax: 2,
        bookings: [
          party({ id: 'a', pax: 8 }),
          party({ id: 'u', counted: false, status: 'payment_pending', paymentState: 'pending' }),
        ],
      }),
      departure({ occurrenceId: 'occ2', status: 'cancelled', pax: 3 }),
      quoteLine(),
      quoteLine({ id: 'r1', lineKind: 'rental', description: 'Car rental', guests: null }),
    ];
    const lines = toCalLines(entries, DAY);
    const s = daySummary(lines, DAY);
    const cal = summarize(lines, DAY, DAY, { types: ALL_TYPES_ON, attentionOnly: false });
    expect(s.departures).toBe(cal.departures);
    expect(s.guests).toBe(cal.guests);
    expect(s).toMatchObject({ departures: 2, calledOff: 1, guests: 10 });
    // Paid parties with a pickup: the departure's paid party and the quote line's.
    expect(s.pickups).toBe(2);
  });

  it('previews tomorrow in one line', () => {
    expect(tomorrowOf(DAY)).toBe('2026-11-15');
    expect(
      tomorrowLine({ departures: 3, calledOff: 0, guests: 14, pickups: 5 }, '2026-11-15'),
    ).toBe('Sun 15 Nov, 3 departures, 14 guests');
    expect(tomorrowLine({ departures: 1, calledOff: 0, guests: 1, pickups: 0 }, '2026-11-15')).toBe(
      'Sun 15 Nov, 1 departure, 1 guest',
    );
  });
});

describe('Today — the run sheet', () => {
  it('reads each departure like the day sheet: time, title, seats used, pickups', () => {
    const rows = runSheetRows(toCalLines([departure()], DAY), DAY, true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      time: '09:00',
      title: 'Catamaran cruise, 3 northern islands',
      subtitle: 'Shared catamaran',
      guests: 4,
      pickups: 1,
      capacity: { used: 4, max: 12, label: '4 of 12' },
      chip: { label: 'All paid', tone: 'ok' },
    });
  });

  it('keeps "Time TBC" honest: no time set on the tour, no clock printed', () => {
    const rows = runSheetRows(toCalLines([departure({ departureTime: null })], DAY), DAY, true);
    expect(rows[0]!.time).toBeNull();
  });

  it('wears the worst news first', () => {
    const line = (over: Parameters<typeof departure>[0]) => toCalLines([departure(over)], DAY)[0]!;
    expect(runChip(line({ status: 'cancelled' }), true)).toEqual({
      label: 'Called off',
      tone: 'bad',
    });
    expect(
      runChip(
        line({
          bookings: [
            party(),
            party({ id: 'x', counted: false, status: 'payment_pending', paymentState: 'pending' }),
          ],
        }),
        true,
      ),
    ).toEqual({ label: '1 awaiting payment', tone: 'warn' });
    const partPaid = line({ bookings: [party({ payView: 'part_paid', balanceDueEur: 135 })] });
    expect(runChip(partPaid, true)).toEqual({ label: 'Balance €135', tone: 'warn' });
    // The amount is money: without money.revenue the chip says what, not how much.
    expect(runChip(partPaid, false)).toEqual({ label: 'Balance to collect', tone: 'warn' });
    // A refund on a single party reads as that party's own chip.
    expect(runChip(line({ bookings: [party({ payView: 'partially_refunded' })] }), true)).toEqual({
      label: 'Partly refunded',
      tone: 'info',
    });
    expect(
      runChip(
        line({
          bookings: [party({ payView: 'refunded' }), party({ id: 'y', payView: 'paid' })],
        }),
        true,
      ),
    ).toEqual({ label: 'Check the day sheet', tone: 'neutral' });
  });

  it('a stored balance alone is not a debt: the chip trusts paymentView', () => {
    // An unpaid booking carries balance = total; paymentView still reads "paid" only when paid.
    const l = toCalLines(
      [departure({ bookings: [party({ balanceDueEur: 372, payView: 'paid' })] })],
      DAY,
    )[0]!;
    expect(runChip(l, true)).toEqual({ label: 'All paid', tone: 'ok' });
  });

  it('carries quote lines and return legs like the day sheet', () => {
    const rows = runSheetRows(toCalLines([quoteLine(), returnLeg()], DAY), DAY, true);
    expect(rows.map((r) => r.title)).toEqual([
      'Private south tour',
      'Airport transfer — departure',
    ]);
    expect(rows[1]!.time).toBe('18:30');
    expect(rows.every((r) => r.capacity === null)).toBe(true);
  });

  it('only the asked-for day', () => {
    const lines = toCalLines(
      [departure(), departure({ occurrenceId: 'o2', startsAt: slot('2026-11-15') })],
      DAY,
    );
    expect(runSheetRows(lines, '2026-11-15', true)).toHaveLength(1);
  });

  it('counts departures day by day for the week’s trend line, adding up to the week’s figure', () => {
    const lines = toCalLines(
      [
        departure(),
        departure({ occurrenceId: 'b', startsAt: slot('2026-11-16') }),
        departure({ occurrenceId: 'c', startsAt: slot('2026-11-16') }),
        departure({ occurrenceId: 'd', startsAt: slot('2026-11-20') }),
        departure({ occurrenceId: 'e', startsAt: slot('2026-11-21') }),
      ],
      DAY,
    );
    const byDay = departuresByDay(lines, DAY);
    expect(byDay).toEqual([1, 0, 2, 0, 0, 0, 1]);
    const week = summarize(lines, DAY, '2026-11-20', { types: ALL_TYPES_ON, attentionOnly: false });
    expect(byDay.reduce((a, b) => a + b, 0)).toBe(week.departures);
  });

  describe('a quiet day says so in one line, with the next departures in its place', () => {
    const on = (day: string, id: string) => departure({ occurrenceId: id, startsAt: slot(day) });

    it('needs nothing extra when today has departures', () => {
      expect(quietDays(toCalLines([departure()], DAY), DAY, true)).toEqual({
        message: null,
        later: [],
        moreLater: 0,
      });
    });

    it('today empty, tomorrow booked: one line, tomorrow shows as usual', () => {
      const lines = toCalLines([on('2026-11-15', 't1')], DAY);
      expect(quietDays(lines, DAY, true)).toEqual({
        message: 'No departures today.',
        later: [],
        moreLater: 0,
      });
    });

    it('both empty: the next departures later in the week, soonest first, at most three', () => {
      const lines = toCalLines(
        [
          on('2026-11-19', 'd5'),
          on('2026-11-16', 'd2a'),
          on('2026-11-16', 'd2b'),
          on('2026-11-17', 'd3'),
          on('2026-11-20', 'd6'),
          on('2026-11-21', 'outside'),
        ],
        DAY,
      );
      const quiet = quietDays(lines, DAY, true);
      expect(quiet.message).toBe('No departures today or tomorrow.');
      expect(quiet.later.map((r) => r.day)).toEqual(['2026-11-16', '2026-11-16', '2026-11-17']);
      // Days 2 to 6 only: the 21st is outside the week Today loads.
      expect(quiet.moreLater).toBe(2);
    });

    it('a clear week says so once', () => {
      expect(quietDays([], DAY, true)).toEqual({
        message: 'No departures in the next 7 days.',
        later: [],
        moreLater: 0,
      });
    });
  });
});

describe('capacityUse — one "N of M" for Today and the day sheet', () => {
  it('reads unit pools as units and per-trip pools as trips', () => {
    expect(capacityUse(departure({ units: 8, capacity: 12 }))).toEqual({
      used: 8,
      max: 12,
      label: '8 of 12',
    });
    expect(capacityUse(departure({ guestsPerTrip: 6, capacity: 18, pax: 7 }))).toEqual({
      used: 2,
      max: 3,
      label: '2 of 3 trips',
    });
    expect(capacityUse(departure({ guestsPerTrip: 6, capacity: 6, pax: 2 }))!.label).toBe(
      '1 of 1 trip',
    );
    expect(capacityUse(quoteLine())).toBeNull();
    expect(capacityUse(returnLeg())).toBeNull();
  });

  it('labels a closed date (pool 0) instead of "4 of 0"', () => {
    expect(capacityUse(departure({ units: 4, capacity: 0, guestsPerTrip: 6 }))!.label).toBe(
      'closed to new bookings',
    );
  });
});

describe('Today — Needs you', () => {
  const partPaid = (id: string, startsAt: string | null, over = {}) =>
    bookingRow({
      id,
      ref: `BMT-${id}`,
      customerName: `Guest ${id}`,
      depositEur: 18,
      balanceDueEur: 162,
      totalEur: 180,
      startsAt,
      ...over,
    });
  const awaiting = (id: string) =>
    bookingRow({
      id,
      ref: `BMT-${id}`,
      customerName: `Guest ${id}`,
      paymentState: 'pending',
      status: 'payment_pending',
      totalEur: 165,
    });

  it('names the guest, the problem and one action, earliest trip first', () => {
    const n = needsYou(
      {
        bookings: [
          partPaid('late', '2026-11-20T08:00:00Z'),
          partPaid('soon', '2026-11-14T08:00:00Z'),
          awaiting('a1'),
        ],
      },
      OWNER,
    );
    expect(n.rows.map((r) => r.key)).toEqual(['balance-soon', 'balance-late', 'awaiting-a1']);
    expect(n.rows[0]).toMatchObject({
      title: 'Balance of €162 to collect, of €180',
      meta: 'Guest soon · BMT-soon · trip 14 Nov',
      action: { kind: 'link', href: '/admin/bookings?open=soon', label: 'Open' },
    });
    expect(n.rows[2]).toMatchObject({
      title: 'Payment of €165 not made yet',
      action: { kind: 'link', href: '/admin/bookings?open=a1' },
    });
    expect(n.balances).toEqual({ count: 2, owedEur: 324 });
    expect(n.awaiting).toBe(1);
    expect(n.total).toBe(3);
  });

  it('keeps the old panels’ sizes and links the rest to the Bookings tabs', () => {
    const many = Array.from({ length: BALANCE_ROWS + 2 }, (_, i) => partPaid(`p${i}`, null));
    const waits = Array.from({ length: AWAITING_ROWS + 1 }, (_, i) => awaiting(`w${i}`));
    const n = needsYou({ bookings: [...many, ...waits] }, OWNER);
    expect(n.rows.filter((r) => r.group === 'balance')).toHaveLength(BALANCE_ROWS);
    expect(n.rows.filter((r) => r.group === 'awaiting')).toHaveLength(AWAITING_ROWS);
    expect(n.more).toEqual([
      { href: '/admin/bookings?view=part_paid', label: `See all ${BALANCE_ROWS + 2} part paid` },
      {
        href: '/admin/bookings?view=awaiting',
        label: `See all ${AWAITING_ROWS + 1} awaiting payment`,
      },
    ]);
  });

  it('offers "Send reminder" for the next unpaid installment of a per-date schedule', () => {
    const b = partPaid('s', null, {
      installments: [
        { seq: 0, dueOn: '2026-11-01', label: 'Deposit', amountEur: 18, coveredEur: 18 },
        { seq: 1, dueOn: '2026-11-20', label: '20 Nov tour', amountEur: 90, coveredEur: 0 },
        { seq: 2, dueOn: '2026-11-22', label: '22 Nov tour', amountEur: 72, coveredEur: 0 },
      ],
    });
    expect(balanceAction(b, new Map())).toEqual({
      kind: 'reminder',
      ref: 'BMT-s',
      seq: 1,
      label: '20 Nov tour',
    });
  });

  it('offers the quote’s balance link only for a quote the worklist files under "Balance to collect"', () => {
    const b = partPaid('q', null);
    const q = quote({
      bookingId: 'q',
      convertedAt: '2026-11-02T10:00:00Z',
      status: 'accepted',
      booking: {
        status: 'confirmed',
        totalMinor: 18000,
        depositMinor: 1800,
        balanceDueMinor: 16200,
      },
    });
    expect(balanceAction(b, new Map([['q', q]]))).toEqual({ kind: 'balance-link', quote: q });
    // Paid in full on the quote's own reading: no balance link, just open the booking.
    const paid = {
      ...q,
      booking: { status: 'confirmed', totalMinor: 18000, depositMinor: 1800, balanceDueMinor: 0 },
    };
    expect(balanceAction(b, new Map([['q', paid]]))).toMatchObject({ kind: 'link' });
    // Marked completed with the balance still owed: the balance route would 409, so just open it.
    expect(balanceAction({ ...b, status: 'completed' }, new Map([['q', q]]))).toMatchObject({
      kind: 'link',
    });
  });

  it('never offers the quote balance link without section.quotes', () => {
    const b = partPaid('q', null);
    const q = quote({
      bookingId: 'q',
      convertedAt: '2026-11-02T10:00:00Z',
      booking: {
        status: 'confirmed',
        totalMinor: 18000,
        depositMinor: 1800,
        balanceDueMinor: 16200,
      },
    });
    const v: TodayViewer = { ...OWNER, showQuotes: false };
    const n = needsYou({ bookings: [b], quotes: [q] }, v);
    expect(n.rows[0]!.action).toMatchObject({ kind: 'link', href: '/admin/bookings?open=q' });
  });

  it('shows no booking rows without section.bookings', () => {
    const v: TodayViewer = { ...OWNER, showBookings: false };
    const n = needsYou({ bookings: [partPaid('x', null), awaiting('y')] }, v);
    expect(n.rows.filter((r) => r.group === 'balance' || r.group === 'awaiting')).toEqual([]);
    expect(n.total).toBe(0);
  });

  it('adds quotes and enquiries only for their sections, linking to those screens', () => {
    const input = {
      bookings: [],
      quotes: [
        quote(),
        quote({ id: 'q2', totalMinor: 18000 }),
        quote({ id: 'd', status: 'draft' as const }),
      ],
      leads: [
        lead(),
        lead({ id: 'l2', createdAt: '2026-11-13T10:00:00Z' }),
        lead({ id: 'old', status: 'contacted' as const }),
      ],
      todayUtc: DAY,
    };
    const n = needsYou(input, OWNER);
    expect(n.rows).toEqual([
      {
        key: 'quotes-waiting',
        group: 'quotes',
        title: '2 quotes waiting for payment',
        meta: '€635 sent and still valid',
        action: { kind: 'link', href: '/admin/quotes', label: 'Open quotes' },
      },
      {
        key: 'leads-new',
        group: 'leads',
        title: '2 new enquiries',
        meta: 'Oldest received 13 Nov',
        action: { kind: 'link', href: '/admin/leads', label: 'Open enquiries' },
      },
    ]);
    expect(n.total).toBe(4);
    const noMoney = needsYou(input, { ...OWNER, showMoney: false });
    expect(noMoney.rows[0]!.meta).toBe('Sent and still valid');
    expect(needsYou(input, { ...OWNER, showQuotes: false, showLeads: false }).rows).toEqual([]);
  });

  it('a failed quotes or enquiries read says so and leaves the rest standing', () => {
    const n = needsYou({ bookings: [awaiting('a')], quotes: 'error', leads: 'error' }, OWNER);
    expect(n.notes).toEqual(['Quotes could not be loaded.', 'Enquiries could not be loaded.']);
    expect(n.rows.map((r) => r.key)).toEqual(['awaiting-a']);
  });
});

describe('Today — the heading line', () => {
  it('joins only the parts the viewer may see', () => {
    expect(todaySentence({ departures: 4, guests: 23, needs: 4 })).toBe(
      '4 departures today, 23 guests, and 4 things that need you.',
    );
    expect(todaySentence({ departures: 1, guests: 1, needs: 1 })).toBe(
      '1 departure today, 1 guest, and 1 thing that needs you.',
    );
    expect(todaySentence({ departures: 2, guests: null, needs: null })).toBe('2 departures today.');
    expect(todaySentence({ departures: null, guests: null, needs: 3 })).toBe(
      '3 things that need you.',
    );
    expect(todaySentence({ departures: null, guests: null, needs: null })).toBe('');
    // A quiet day says so, rather than "0 departures today, 0 guests".
    expect(todaySentence({ departures: 0, guests: 0, needs: 6 })).toBe(
      'No departures today, and 6 things that need you.',
    );
    expect(todaySentence({ departures: 0, guests: 0, needs: null })).toBe('No departures today.');
  });
});
