import { describe, expect, it } from 'vitest';
import {
  HOME_CARDS,
  balanceRows,
  balancesAnswer,
  departuresAnswer,
  expiresIn,
  expiringQuote,
  greeting,
  homeSuggestions,
  openTargetFor,
  overdue,
  seeingLabel,
  sendList,
  sendQuestion,
  type AssistantViewer,
  type BalanceRow,
} from '@/components/admin/assistant/rules';
import { balanceLinkQuestion } from '@/components/admin/quotes/worklist';
import type { RunRow } from '@/components/admin/today/rules';
import type { QuoteRow } from '@/lib/admin/quotes';
import { bookingRow } from '../helpers/admin-day';

/* The side chat's rules: the home view's cards, the balances it offers to chase and what pressing
 * "Email" will send. The sandbox has too little data to show most of this, so it is proved here. */

const TODAY = '2026-11-16';
const TODAY_UTC = '2026-11-16';

const OWNER: AssistantViewer = {
  showMoney: true,
  showBookings: true,
  showQuotes: true,
  showDepartures: true,
};
const NO_MONEY: AssistantViewer = { ...OWNER, showMoney: false };
const NOTHING: AssistantViewer = {
  showMoney: false,
  showBookings: false,
  showQuotes: false,
  showDepartures: false,
};

const partPaid = (id: string, day: string | null, owed: number, over = {}) =>
  bookingRow({
    id,
    ref: `BMT-${id}`,
    customerName: `Guest ${id}`,
    customerEmail: `${id}@example.com`,
    depositEur: 18,
    balanceDueEur: owed,
    totalEur: owed + 18,
    // Noon in Mauritius on that day, where every day-slot sits.
    startsAt: day ? `${day}T08:00:00Z` : null,
    ...over,
  });

function quote(over: Partial<QuoteRow> = {}): QuoteRow {
  return {
    id: 'q1',
    ref: 'Q-1',
    customerName: 'Jean Claude Martin',
    customerEmail: 'jc@example.com',
    customerPhone: null,
    status: 'sent',
    currency: 'EUR',
    totalMinor: 16500,
    validUntil: '2026-11-19',
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

const run = (over: Partial<RunRow> = {}): RunRow => ({
  key: 'k1',
  day: TODAY,
  time: '08:45',
  allDay: false,
  title: 'Catamaran Cruise',
  subtitle: null,
  guests: 4,
  pendingGuests: 0,
  capacity: null,
  pickups: 2,
  cancelled: false,
  chip: { label: 'All paid', tone: 'ok' },
  ...over,
});

describe('balances', () => {
  const bookings = [
    partPaid('small', '2026-11-10', 32.4),
    partPaid('big', '2026-10-19', 1400),
    partPaid('future', '2026-11-25', 136.5),
    partPaid('undated', null, 60),
    // Paid in full: not a balance at all.
    partPaid('paid', '2026-11-01', 0),
  ];

  it('lists every part-paid booking, biggest first, with its Mauritius trip day', () => {
    const rows = balanceRows(bookings, null, TODAY_UTC);
    expect(rows.map((r) => r.id)).toEqual(['big', 'future', 'undated', 'small']);
    expect(rows[0]).toMatchObject({ tripDay: '2026-10-19', owedEur: 1400, name: 'Guest big' });
    expect(rows.find((r) => r.id === 'undated')!.tripDay).toBeNull();
  });

  it('overdue means the trip day has passed — an undated booking is never overdue', () => {
    const rows = balanceRows(bookings, null, TODAY_UTC);
    expect(overdue(rows, TODAY).map((r) => r.id)).toEqual(['big', 'small']);
    // The trip day itself is not yet "past".
    const onTheDay = balanceRows([partPaid('t', TODAY, 50)], null, TODAY_UTC);
    expect(overdue(onTheDay, TODAY)).toEqual([]);
  });

  it('sends only what Today could send: a reminder or a quote balance link, never a plain booking', () => {
    const withSchedule = partPaid('s', '2026-11-01', 90, {
      installments: [
        { seq: 0, dueOn: '2026-10-01', label: 'Deposit', amountEur: 18, coveredEur: 18 },
        { seq: 1, dueOn: '2026-11-01', label: '1 Nov tour', amountEur: 90, coveredEur: 0 },
      ],
    });
    const [scheduled, plain] = balanceRows([withSchedule, partPaid('p', '2026-11-01', 40)], null);
    expect(scheduled!.action).toEqual({
      kind: 'reminder',
      ref: 'BMT-s',
      seq: 1,
      label: '1 Nov tour',
    });
    expect(scheduled!.sendable).toBe(true);
    expect(plain!.action.kind).toBe('link');
    expect(plain!.sendable).toBe(false);
  });

  it('offers a quote’s balance link only when the quotes were read', () => {
    const b = partPaid('q', '2026-11-01', 162);
    const q = quote({
      id: 'qq',
      ref: 'Q-77',
      bookingId: 'q',
      status: 'accepted',
      convertedAt: '2026-10-20T10:00:00Z',
      booking: {
        status: 'confirmed',
        totalMinor: 18000,
        depositMinor: 1800,
        balanceDueMinor: 16200,
      },
    });
    expect(balanceRows([b], [q], TODAY_UTC)[0]!.action).toEqual({ kind: 'balance-link', quote: q });
    // No Quotes section, no quotes read: the same booking can only be opened.
    expect(balanceRows([b], null, TODAY_UTC)[0]!.action.kind).toBe('link');
  });
});

describe('what "Email" sends, and the question it asks first', () => {
  const reminder: BalanceRow = {
    id: 'a',
    ref: 'BMT-a',
    name: 'Steven Bretaud',
    email: 'steven@example.com',
    phone: null,
    tripDay: '2026-10-19',
    owedEur: 1400,
    totalEur: 1600,
    action: { kind: 'reminder', ref: 'BMT-a', seq: 1, label: '19 Oct tour' },
    sendable: true,
  };
  const q = quote({ ref: 'Q-9', customerEmail: 'laurent@example.com' });
  const link: BalanceRow = {
    ...reminder,
    id: 'b',
    ref: 'BMT-b',
    name: 'Laurent Jacquet',
    email: 'laurent@example.com',
    owedEur: 408.75,
    action: { kind: 'balance-link', quote: q },
  };
  const open: BalanceRow = {
    ...reminder,
    id: 'c',
    action: { kind: 'link', href: '/admin/bookings?open=c', label: 'Open' },
    sendable: false,
  };

  it('acts on ticked, sendable rows not already sent', () => {
    const rows = [reminder, link, open];
    expect(sendList(rows, new Set(['a', 'b', 'c'])).map((r) => r.id)).toEqual(['a', 'b']);
    expect(sendList(rows, new Set(['b'])).map((r) => r.id)).toEqual(['b']);
    expect(sendList(rows, new Set(['a', 'b']), new Set(['a'])).map((r) => r.id)).toEqual(['b']);
  });

  it('a single balance link asks the Quotes screen’s own question, word for word', () => {
    expect(sendQuestion([link], true)).toBe(balanceLinkQuestion('Q-9', 'laurent@example.com'));
  });

  it('several name every guest, address and what each gets, with the earlier-link warning', () => {
    const text = sendQuestion([reminder, link], true);
    expect(text).toContain('Email 2 guests?');
    expect(text).toContain('Steven Bretaud (steven@example.com): reminder for 19 oct tour, €1,400');
    expect(text).toContain('Laurent Jacquet (laurent@example.com): balance link · quote q-9');
    expect(text).toContain('A balance link sent earlier stops working');
    // Reminders only: no warning about a link that is not being sent.
    expect(sendQuestion([reminder], true)).not.toContain('balance link sent earlier');
  });

  it('leaves the amounts out for a role without money', () => {
    expect(sendQuestion([reminder, link], false)).not.toContain('€');
  });
});

describe('the chat’s answer to “chase the balances”', () => {
  const rows = balanceRows(
    [
      partPaid('big', '2026-10-19', 1400),
      partPaid('small', '2026-11-10', 32.4),
      partPaid('future', '2026-11-25', 136.5),
    ],
    null,
  );

  it('counts the past trips, totals them and names the biggest — the same figures as Today', () => {
    const a = balancesAnswer(rows, TODAY, true);
    expect(a.rows.map((r) => r.id)).toEqual(['big', 'small']);
    expect(a.text).toContain('2 guests have had their trip but still owe €1,432');
    expect(a.text).toContain('Guest big owes the most, €1,400');
    expect(a.steps).toEqual(['Checked 3 balances', 'Compared trip dates']);
    // None of these has a sender (no schedule, no quotes read), and it says so.
    expect(a.text).toContain('open each booking');
    // The model is told who, so a follow-up question still knows the names.
    expect(a.context).toContain('Guest big (BMT-big)');
  });

  it('without money it says who, not how much', () => {
    const a = balancesAnswer(rows, TODAY, false);
    expect(a.text).not.toContain('€');
    expect(a.context).not.toContain('€');
  });

  it('with nothing overdue it says so and shows the balances still to come', () => {
    const later = balanceRows([partPaid('future', '2026-11-25', 136.5)], null);
    const a = balancesAnswer(later, TODAY, true);
    expect(a.text).toContain('No trip that has already happened still owes a balance');
    expect(a.rows).toHaveLength(1);
    expect(balancesAnswer([], TODAY, true).text).toContain('No balances to collect');
  });
});

describe('quotes about to lapse', () => {
  it('picks the waiting quote closest to its valid-until day, within 3 days', () => {
    const soon = quote({ id: 'soon', validUntil: '2026-11-17', totalMinor: 5000 });
    const later = quote({ id: 'later', validUntil: '2026-11-19' });
    const far = quote({ id: 'far', validUntil: '2026-12-31' });
    expect(expiringQuote([later, far, soon], TODAY_UTC)).toMatchObject({ id: 'soon', daysLeft: 1 });
    expect(expiringQuote([far], TODAY_UTC)).toBeNull();
  });

  it('ignores drafts, expired and paid quotes', () => {
    const draft = quote({ id: 'd', status: 'draft', sentAt: null, validUntil: '2026-11-17' });
    const lapsed = quote({ id: 'x', validUntil: '2026-11-15' });
    expect(expiringQuote([draft, lapsed], TODAY_UTC)).toBeNull();
  });

  it('says when, in words', () => {
    expect(expiresIn(0)).toBe('expires today');
    expect(expiresIn(1)).toBe('expires tomorrow');
    expect(expiresIn(3)).toBe('expires in 3 days');
  });
});

describe('the home view’s cards', () => {
  const balances = balanceRows(
    [partPaid('big', '2026-10-19', 1400), partPaid('future', '2026-11-25', 136.5)],
    null,
  );
  const input = {
    balances,
    quotes: [quote({ validUntil: '2026-11-19' })],
    departures: [run(), run({ key: 'k2', guests: 6, cancelled: true })],
    today: TODAY,
    todayUtc: TODAY_UTC,
    path: '/admin',
  };

  it('leads with what needs the owner, from live data', () => {
    const cards = homeSuggestions(input, OWNER);
    expect(cards.map((c) => c.key)).toEqual(['balances', 'quote', 'email', 'departures']);
    expect(cards[0]).toMatchObject({
      title: 'Chase overdue balances',
      sub: '1 past trip · €1,400 owed',
      urgent: true,
    });
    expect(cards[1]).toMatchObject({
      kind: 'open',
      title: 'Nudge Jean',
      sub: '€165 quote expires in 3 days',
      href: '/admin/quotes?stage=waiting&quote=q1',
    });
    // The called-off departure is not counted.
    expect(cards[3]).toMatchObject({ sub: '1 departure · 4 guests' });
  });

  it('without money, the cards keep the who and drop the how much', () => {
    const cards = homeSuggestions(input, NO_MONEY);
    expect(cards.map((c) => c.sub).join(' ')).not.toContain('€');
  });

  it('a role with none of the sections gets plain questions, never someone’s name', () => {
    const cards = homeSuggestions(input, NOTHING);
    expect(cards.every((c) => c.kind === 'prompt')).toBe(true);
    expect(cards.map((c) => c.title).join(' ')).not.toContain('Jean');
  });

  it('while the data loads, or when there is nothing to chase, it tops up with questions', () => {
    const loading = homeSuggestions(
      { ...input, balances: null, quotes: null, departures: null },
      OWNER,
    );
    expect(loading.every((c) => c.kind === 'prompt')).toBe(true);
    const quiet = homeSuggestions({ ...input, balances: [], quotes: [], departures: [] }, OWNER);
    expect(quiet.map((c) => c.key)).toContain('email');
    expect(quiet.length).toBeLessThanOrEqual(HOME_CARDS);
  });

  it('nothing overdue: the balances card says they are still to come', () => {
    const cards = homeSuggestions(
      { ...input, balances: balanceRows([partPaid('f', '2026-11-25', 100)], null) },
      OWNER,
    );
    expect(cards[0]).toMatchObject({
      title: 'Balances to collect',
      sub: '1 trip still to come · €100 owed',
    });
  });
});

describe('today’s departures', () => {
  it('counts live departures, guests and pickups', () => {
    const a = departuresAnswer([
      run(),
      run({ key: 'k2', guests: 6, pickups: 3 }),
      run({ key: 'x', cancelled: true }),
    ]);
    expect(a.text).toBe(
      '2 departures today with 10 guests and 5 pickups. Open one for the names and pickup places.',
    );
    expect(a.rows).toHaveLength(2);
    expect(departuresAnswer([]).text).toBe('Nothing departs today.');
  });
});

describe('the greeting and what the panel sees', () => {
  it('greets by the hour in Mauritius and the first name only', () => {
    // 05:30 UTC is 09:30 in Mauritius.
    expect(greeting('Noorani Sowdagar', new Date('2026-11-16T05:30:00Z'))).toBe(
      'Good morning, Noorani.',
    );
    expect(greeting('Noorani', new Date('2026-11-16T10:00:00Z'))).toBe('Good afternoon, Noorani.');
    expect(greeting(null, new Date('2026-11-16T15:00:00Z'))).toBe('Good evening.');
    // 23:30 UTC is 03:30 the next day in Mauritius.
    expect(greeting('Noorani', new Date('2026-11-16T23:30:00Z'))).toBe(
      'Burning the midnight oil, Noorani?',
    );
  });

  it('names the part of the screen the address is on', () => {
    const p = (q: string) => new URLSearchParams(q);
    expect(seeingLabel('Quotes', '/admin/quotes', p('stage=balance'))).toBe(
      'Quotes · Balance to collect',
    );
    expect(seeingLabel('Quotes', '/admin/quotes', p('stage=nonsense'))).toBe('Quotes');
    expect(seeingLabel('Calendar', '/admin/calendar', p('day=2026-11-20'))).toBe(
      'Calendar · 20 Nov',
    );
    expect(seeingLabel('Today', '/admin', p(''))).toBe('Today');
  });
});

describe('what a chat link opens', () => {
  it('reads the booking, quote or day a link points at', () => {
    expect(openTargetFor('/admin/bookings?open=b-1')).toEqual({ kind: 'booking', id: 'b-1' });
    expect(openTargetFor('/admin/quotes?stage=waiting&quote=q-1')).toEqual({
      kind: 'quote',
      id: 'q-1',
      stage: 'waiting',
    });
    expect(openTargetFor('/admin/calendar?day=2026-11-16&line=line%201')).toEqual({
      kind: 'day',
      day: '2026-11-16',
      line: 'line 1',
    });
  });

  it('a link to a whole screen, or a malformed day, opens nothing in it', () => {
    expect(openTargetFor('/admin/bookings?view=part_paid')).toBeNull();
    expect(openTargetFor('/admin/quotes')).toBeNull();
    expect(openTargetFor('/admin/calendar?day=tomorrow')).toBeNull();
    expect(openTargetFor('/admin/leads')).toBeNull();
  });
});
