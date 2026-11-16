import { describe, expect, it } from 'vitest';
import type { QuoteBookingSummary, QuoteRow } from '@/lib/admin/quotes';
import {
  dayMonth,
  defaultQuoteStage,
  groupQuotes,
  isPastValidity,
  parseQuoteSort,
  parseQuoteStage,
  quotePanelMoney,
  quotePrimary,
  quoteProgress,
  quoteRowAmount,
  quoteRowNote,
  lastSentText,
  quoteStage,
  rowSendRefusal,
  sortQuotes,
  stageCards,
  tripTile,
  validDaysLeft,
  validityCountdown,
  validityNote,
} from '@/components/admin/quotes/worklist';

/**
 * The Quotes screen's stages, rows and panel (the owner's mock-up, 16 Nov 2026): the stage cards, the
 * days-left and trip-date notes, the per-stage orders, the progress strip and the panel's figure. The
 * money-shaped ones matter most: a card counting rows its list does not show, a "1 day left" on a quote
 * the send route already refuses, or a deposit booking's balance read off `balance_due` alone.
 */

const TODAY = '2026-11-16';
const TODAY_MU = '2026-11-16';

function row(over: Partial<QuoteRow> = {}): QuoteRow {
  return {
    id: 'q1',
    ref: 'Q7C21E90A4B13',
    customerName: 'Lukas Weber',
    customerEmail: 'lukas@example.com',
    customerPhone: '+49 170 555 0142',
    status: 'sent',
    currency: 'EUR',
    totalMinor: 45500,
    depositBps: 10000,
    paymentMode: 'deposit',
    validUntil: '2026-11-25',
    introNote: null,
    internalNotes: null,
    sentAt: '2026-11-11T08:00:00.000Z',
    bookingId: null,
    convertedAt: null,
    roomOrCabin: null,
    locale: 'en',
    createdAt: '2026-11-11T07:57:00.000Z',
    updatedAt: '2026-11-11T08:00:00.000Z',
    ...over,
  };
}

function booking(over: Partial<QuoteBookingSummary> = {}): QuoteBookingSummary {
  return {
    status: 'confirmed',
    totalMinor: 35000,
    depositMinor: 10500,
    balanceDueMinor: 24500,
    ...over,
  };
}

const converted = {
  bookingId: 'b1',
  convertedAt: '2026-11-12T09:00:00.000Z',
  status: 'accepted' as const,
};

describe('stages', () => {
  it('reads ?stage= and falls back to nothing for anything else', () => {
    expect(parseQuoteStage('balance')).toBe('balance');
    expect(parseQuoteStage('paid')).toBeNull();
    expect(parseQuoteStage(null)).toBeNull();
  });

  it('opens on the first stage with anything in it, and on Done when only Done has rows', () => {
    const empty = { waiting: [], balance: [], draft: [], expired: [], done: [] };
    expect(defaultQuoteStage({ ...empty, waiting: [1] })).toBe('waiting');
    expect(defaultQuoteStage({ ...empty, draft: [1], expired: [1] })).toBe('draft');
    expect(defaultQuoteStage({ ...empty, done: [1] })).toBe('done');
    expect(defaultQuoteStage(empty)).toBe('done');
  });

  it('gives every card the length of its own list, never a narrower count', () => {
    const rows = [
      row({ id: 'w1' }),
      row({ id: 'w2', totalMinor: 1000 }),
      row({ id: 'd1', status: 'draft', sentAt: null }),
      row({ id: 'x1', validUntil: '2026-11-01' }),
      row({
        id: 'p1',
        ...converted,
        booking: booking({ depositMinor: 35000, balanceDueMinor: 0 }),
      }),
      row({ id: 'c1', status: 'cancelled' }),
      row({ id: 'b1', ...converted, booking: booking() }),
    ];
    const groups = groupQuotes(rows, TODAY);
    const cards = stageCards(groups, TODAY);
    for (const card of cards) expect(card.count, card.id).toBe(groups[card.id].length);
    const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
    // Done holds the paid quote AND the withdrawn one; its line says how many were paid.
    expect(byId.done!.count).toBe(2);
    expect(byId.done!.sub).toBe('1 paid');
    expect(byId.waiting!.sub).toBe('€465.00 sent, still valid');
    expect(byId.balance!.sub).toBe('€245.00 still owed');
  });

  it('says plainly when a stage is empty instead of showing €0.00', () => {
    const cards = stageCards(groupQuotes([], TODAY), TODAY);
    expect(cards.map((c) => c.sub)).toEqual([
      'Nothing waiting',
      'Nothing owed',
      'Nothing to finish',
      'None lapsed',
      'None paid yet',
    ]);
  });
});

describe('days left', () => {
  it('counts on the same day as the expired rule, so the two never disagree', () => {
    for (const until of ['2026-11-14', '2026-11-15', '2026-11-16', '2026-11-17', '2026-12-31']) {
      expect(validDaysLeft(until, TODAY) < 0, until).toBe(isPastValidity(until, TODAY));
    }
  });

  it('says how long is left in words, urgent from three days', () => {
    expect(validityNote('2026-11-16', TODAY)).toEqual({
      text: 'Last valid day today',
      urgent: true,
    });
    expect(validityNote('2026-11-17', TODAY)).toEqual({ text: 'Expires tomorrow', urgent: true });
    expect(validityNote('2026-11-19', TODAY)).toEqual({ text: 'Expires in 3 days', urgent: true });
    expect(validityNote('2026-11-25', TODAY)).toEqual({
      text: 'Valid to 25 Nov · 9 days left',
      urgent: false,
    });
  });

  it('drops the date when the date already sits beside the countdown', () => {
    expect(validityCountdown('2026-11-25', TODAY)).toEqual({ text: '9 days left', urgent: false });
    expect(validityCountdown('2026-11-17', TODAY)).toEqual({
      text: 'Expires tomorrow',
      urgent: true,
    });
    expect(validityCountdown('2026-11-15', TODAY)).toEqual({ text: 'Expired', urgent: true });
  });

  it('never counts down a quote the send route already refuses', () => {
    const lapsed = row({ validUntil: '2026-11-15' });
    expect(rowSendRefusal(lapsed, TODAY)).not.toBeNull();
    expect(validityNote(lapsed.validUntil, TODAY).text).toBe('Expired 15 Nov');
  });
});

describe('the trip date tile', () => {
  it('reads the day in Mauritius, so an early transfer stays on its own day', () => {
    // 05:10 in Mauritius on 20 Nov is 01:10 UTC: still 20 Nov here.
    expect(tripTile('2026-11-20T01:10:00.000Z', TODAY_MU)).toEqual({
      day: '20',
      month: 'Nov',
      date: '2026-11-20',
      past: false,
    });
    // 02:00 in Mauritius on 20 Nov is 22:00 UTC on the 19th.
    expect(tripTile('2026-11-19T22:00:00.000Z', TODAY_MU)!.date).toBe('2026-11-20');
  });

  it('marks a trip whose first day is behind us, and has no tile without a date', () => {
    expect(tripTile('2026-11-15T08:00:00.000Z', TODAY_MU)!.past).toBe(true);
    expect(tripTile('2026-11-16T08:00:00.000Z', TODAY_MU)!.past).toBe(false);
    expect(tripTile(null, TODAY_MU)).toBeNull();
  });

  it('formats a plain day without a clock', () => {
    expect(dayMonth('2026-12-25')).toBe('25 Dec');
    expect(dayMonth('2026-01-05')).toBe('5 Jan');
  });
});

describe('the note under a row', () => {
  const note = (r: QuoteRow, firstDate: string | null) =>
    quoteRowNote(r, quoteStage(r, TODAY), tripTile(firstDate, TODAY_MU), TODAY, TODAY_MU);

  it('adds "trip date passed" to a waiting quote whose trip has begun', () => {
    expect(note(row(), '2026-11-15T08:00:00.000Z')).toEqual({
      text: 'Valid to 25 Nov · 9 days left · trip date passed',
      urgent: true,
    });
  });

  it('counts the days to the trip on a balance, and says to collect once it has passed', () => {
    const owed = row({ ...converted, booking: booking() });
    expect(note(owed, '2026-11-20T08:00:00.000Z')).toEqual({
      text: 'Trip in 4 days',
      urgent: false,
    });
    expect(note(owed, '2026-11-17T08:00:00.000Z')).toEqual({ text: 'Trip tomorrow', urgent: true });
    expect(note(owed, '2026-11-10T08:00:00.000Z')).toEqual({
      text: 'Trip date passed — collect now',
      urgent: true,
    });
  });

  it('dates drafts by when they were started and expired quotes by when they lapsed', () => {
    expect(note(row({ status: 'draft', sentAt: null }), null).text).toBe('Started 11 Nov');
    expect(note(row({ validUntil: '2026-11-13' }), null).text).toBe('Expired 13 Nov · sent 11 Nov');
  });
});

describe('the figure on a row', () => {
  const amount = (r: QuoteRow) => quoteRowAmount(r, quoteStage(r, TODAY));

  it('shows what is owed on a balance, from the booking, never the quote total', () => {
    expect(amount(row({ ...converted, booking: booking() }))).toEqual({
      minor: 24500,
      sub: 'owed',
    });
  });

  it('shows the paid booking total on a paid quote, and nothing on an empty draft', () => {
    const paid = row({
      ...converted,
      booking: booking({ depositMinor: 35000, balanceDueMinor: 0 }),
    });
    expect(amount(paid)).toEqual({ minor: 35000, sub: 'paid' });
    expect(amount(row({ status: 'draft', sentAt: null, totalMinor: 0 }))).toEqual({
      minor: null,
      sub: 'nothing priced',
    });
  });
});

describe('orders', () => {
  const a = row({
    id: 'a',
    validUntil: '2026-11-30',
    totalMinor: 100,
    createdAt: '2026-11-01T00:00:00Z',
  });
  const b = row({
    id: 'b',
    validUntil: '2026-11-20',
    totalMinor: 900,
    createdAt: '2026-11-03T00:00:00Z',
  });
  const c = row({
    id: 'c',
    validUntil: '2026-11-25',
    totalMinor: 500,
    createdAt: '2026-11-02T00:00:00Z',
  });
  const trips: Record<string, string | null> = {
    a: '2026-12-01T08:00:00Z',
    b: null,
    c: '2026-11-21T08:00:00Z',
  };
  const by = {
    tripDate: (r: QuoteRow) => trips[r.id] ?? null,
    amount: (r: QuoteRow) => r.totalMinor,
  };
  const ids = (sort: Parameters<typeof sortQuotes>[1]) =>
    sortQuotes([a, b, c], sort, by).map((r) => r.id);

  it('sorts by expiry, trip date (undated last), amount and newest', () => {
    expect(ids('expires')).toEqual(['b', 'c', 'a']);
    expect(ids('expired-recent')).toEqual(['a', 'c', 'b']);
    expect(ids('trip')).toEqual(['c', 'a', 'b']);
    expect(ids('amount')).toEqual(['b', 'c', 'a']);
    expect(ids('newest')).toEqual(['b', 'c', 'a']);
  });

  it('only accepts an order the stage offers', () => {
    expect(parseQuoteSort('amount', 'balance')).toBe('amount');
    expect(parseQuoteSort('expires', 'balance'), 'a balance has no expiry').toBe('trip');
    expect(parseQuoteSort(null, 'waiting')).toBe('expires');
  });
});

describe('the progress strip', () => {
  const steps = (r: QuoteRow) =>
    quoteProgress(r, quoteStage(r, TODAY)).map((s) => `${s.label}:${s.state}`);

  it('follows a sent quote to checkout and payment', () => {
    expect(steps(row())).toEqual(['Created:done', 'Sent:done', 'Checkout:current', 'Paid:todo']);
    expect(steps(row({ ...converted, booking: booking({ status: 'payment_pending' }) }))).toEqual([
      'Created:done',
      'Sent:done',
      'Checkout:done',
      'Paid:current',
    ]);
    expect(
      steps(row({ ...converted, booking: booking({ depositMinor: 35000, balanceDueMinor: 0 }) })),
    ).toEqual(['Created:done', 'Sent:done', 'Checkout:done', 'Paid:done']);
  });

  it('stops at Expired or Withdrawn, and waits on Sent for a draft', () => {
    expect(steps(row({ validUntil: '2026-11-10' }))).toEqual([
      'Created:done',
      'Sent:done',
      'Expired:stopped',
      'Paid:todo',
    ]);
    expect(steps(row({ status: 'cancelled' }))[2]).toBe('Withdrawn:stopped');
    expect(steps(row({ status: 'draft', sentAt: null }))[1]).toBe('Sent:current');
  });

  it('shows a balance as paid in part', () => {
    const owed = row({ ...converted, booking: booking() });
    const paid = quoteProgress(owed, quoteStage(owed, TODAY))[3]!;
    expect(paid).toEqual({ label: 'Paid', when: 'Deposit in · €245.00 owed', state: 'current' });
  });
});

describe('the panel', () => {
  it('leads a balance with what is still owed and how much is paid', () => {
    const owed = row({ ...converted, booking: booking() });
    expect(quotePanelMoney(owed, quoteStage(owed, TODAY), TODAY)).toEqual({
      label: 'Still owed',
      minor: 24500,
      sub: '€105.00 of €350.00 paid',
      bar: { paidMinor: 10500, totalMinor: 35000 },
    });
  });

  it('leads a waiting quote with its total and the time left', () => {
    const r = row();
    expect(quotePanelMoney(r, quoteStage(r, TODAY), TODAY)).toMatchObject({
      label: 'Quote total',
      minor: 45500,
      sub: 'Valid to 25 Nov · 9 days left',
      bar: null,
    });
  });

  it('offers one main action per stage, and never a resend on a quote at checkout', () => {
    expect(quotePrimary(row(), TODAY)).toBe('resend');
    expect(quotePrimary(row({ ...converted, booking: booking() }), TODAY)).toBe('balance');
    expect(quotePrimary(row({ status: 'draft', sentAt: null }), TODAY)).toBe('finish');
    expect(quotePrimary(row({ validUntil: '2026-11-01' }), TODAY)).toBe('duplicate');
    expect(
      quotePrimary(
        row({ ...converted, booking: booking({ depositMinor: 35000, balanceDueMinor: 0 }) }),
        TODAY,
      ),
    ).toBe('booking');
    expect(
      quotePrimary(row({ ...converted, booking: booking({ status: 'payment_pending' }) }), TODAY),
    ).toBeNull();
  });
});

describe('when a quote was last sent', () => {
  it('reads the latest send in Mauritius time, and says nothing for an unsent quote', () => {
    // 06:32 UTC is 10:32 in Mauritius.
    expect(lastSentText('2026-11-14T06:32:00.000Z')).toBe('Last sent 14 Nov, 10:32');
    expect(lastSentText(null)).toBeNull();
    expect(lastSentText('not a date')).toBeNull();
  });
});
