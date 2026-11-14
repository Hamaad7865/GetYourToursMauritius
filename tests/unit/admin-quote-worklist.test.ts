import { describe, expect, it } from 'vitest';
import type { QuoteBookingSummary, QuoteRow } from '@/lib/admin/quotes';
import {
  WORK_GROUPS,
  groupQuotes,
  isPastValidity,
  lineSummaries,
  matchesQuoteSearch,
  quoteStage,
  rowActions,
  rowSendRefusal,
  worklistTotals,
} from '@/components/admin/quotes/worklist';

/**
 * The Quotes worklist's rules, with none of its markup: which group a quote sits in, when a quote
 * reads as expired, and which row actions are offered. Every one of these has a money-shaped failure
 * mode — a deposit booking shown as paid, a converted quote offered a "Send again" that would break
 * the link the guest is paying with — so they are pinned here rather than read off a screenshot.
 */

const TODAY = '2026-11-14';

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
    totalMinor: 18000,
    depositMinor: 18000,
    balanceDueMinor: 0,
    ...over,
  };
}

const converted = {
  bookingId: 'b1',
  convertedAt: '2026-11-12T09:00:00.000Z',
  status: 'accepted' as const,
};

describe('the expired rule', () => {
  it('is a calendar-day comparison, and the last valid day is not expired', () => {
    expect(isPastValidity('2026-11-13', TODAY)).toBe(true);
    expect(isPastValidity('2026-11-14', TODAY), 'valid until today is still valid').toBe(false);
    expect(isPastValidity('2026-11-15', TODAY)).toBe(false);
  });

  it('reads a sent quote past its date as expired, without the stored status saying so', () => {
    const stage = quoteStage(row({ status: 'sent', validUntil: '2026-11-01' }), TODAY);
    expect(stage.group).toBe('expired');
    expect(stage.label).toBe('Expired');
    expect(stage.tone).toBe('bad');
  });

  it('keeps a sent quote that is still valid in the waiting group', () => {
    const stage = quoteStage(row({ status: 'sent', validUntil: TODAY }), TODAY);
    expect(stage.group).toBe('waiting');
    expect(stage.label).toBe('Sent');
  });

  it('also reads a stored expired status as expired', () => {
    expect(quoteStage(row({ status: 'expired', validUntil: '2026-12-01' }), TODAY).group).toBe(
      'expired',
    );
  });

  it('leaves a draft with a lapsed date among the drafts — it was never offered', () => {
    expect(quoteStage(row({ status: 'draft', validUntil: '2026-11-01' }), TODAY).group).toBe(
      'draft',
    );
  });
});

describe('converted is not paid', () => {
  it('puts a paid deposit booking with a balance still owed in "balance to collect"', () => {
    const stage = quoteStage(
      row({
        ...converted,
        booking: booking({ totalMinor: 18000, depositMinor: 4500, balanceDueMinor: 13500 }),
      }),
      TODAY,
    );
    expect(stage.group).toBe('balance');
    expect(stage.balanceOwedMinor).toBe(13500);
    expect(stage.paidMinor).toBe(4500);
  });

  it('puts a paid booking with nothing owed in done, as paid', () => {
    const stage = quoteStage(row({ ...converted, booking: booking() }), TODAY);
    expect(stage.group).toBe('done');
    expect(stage.label).toBe('Paid');
    expect(stage.tone).toBe('ok');
    expect(stage.balanceOwedMinor).toBeNull();
  });

  it('never calls an unsettled deposit booking a balance — the whole total is still owed', () => {
    // api_convert_quote initialises balance_due to the whole total, so `balance_due > 0` alone is not
    // a debt (src/lib/quotes/deposit.ts). A confirmed status with nothing settled must not read as one.
    const stage = quoteStage(
      row({
        ...converted,
        booking: booking({ totalMinor: 18000, depositMinor: 1800, balanceDueMinor: 18000 }),
      }),
      TODAY,
    );
    expect(stage.group).not.toBe('balance');
  });

  it('keeps a quote whose guest is at checkout in waiting', () => {
    const stage = quoteStage(
      row({ ...converted, booking: booking({ status: 'payment_pending' }) }),
      TODAY,
    );
    expect(stage.group).toBe('waiting');
    expect(stage.label).toBe('Checkout opened');
  });

  it('reads an abandoned checkout as waiting while valid and expired after', () => {
    const abandoned = { ...converted, booking: booking({ status: 'expired' }) };
    expect(quoteStage(row({ ...abandoned, validUntil: '2026-11-20' }), TODAY).group).toBe(
      'waiting',
    );
    expect(quoteStage(row({ ...abandoned, validUntil: '2026-11-10' }), TODAY).group).toBe(
      'expired',
    );
  });

  it('never files a converted quote whose booking could not be read as done or paid', () => {
    const stage = quoteStage(row({ ...converted, booking: undefined }), TODAY);
    expect(stage.group).toBe('waiting');
    expect(stage.label).not.toMatch(/paid/i);
    expect(stage.tone).toBe('info');
  });

  it('closes a converted quote whose booking was cancelled or erased', () => {
    expect(
      quoteStage(row({ ...converted, booking: booking({ status: 'cancelled' }) }), TODAY).group,
    ).toBe('done');
    expect(quoteStage(row({ ...converted, bookingId: null, booking: null }), TODAY).group).toBe(
      'done',
    );
  });

  it('files a withdrawn quote as done, even when its dead booking was abandoned', () => {
    const stage = quoteStage(
      row({ ...converted, status: 'cancelled', booking: booking({ status: 'expired' }) }),
      TODAY,
    );
    expect(stage.group).toBe('done');
    expect(stage.label).toBe('Withdrawn');
  });
});

describe('grouping', () => {
  it('names every group once, in the order the owner works through them', () => {
    expect(WORK_GROUPS.map((g) => g.id)).toEqual([
      'waiting',
      'balance',
      'draft',
      'expired',
      'done',
    ]);
  });

  it('puts every quote in exactly one group and keeps the newest-first order inside each', () => {
    const rows = [
      row({ id: 'a', status: 'draft' }),
      row({ id: 'b', status: 'sent' }),
      row({ id: 'c', status: 'sent', validUntil: '2026-10-01' }),
      row({ id: 'd', status: 'sent' }),
      row({ id: 'e', status: 'cancelled' }),
    ];
    const groups = groupQuotes(rows, TODAY);
    expect(groups.waiting.map((r) => r.id)).toEqual(['b', 'd']);
    expect(groups.draft.map((r) => r.id)).toEqual(['a']);
    expect(groups.expired.map((r) => r.id)).toEqual(['c']);
    expect(groups.done.map((r) => r.id)).toEqual(['e']);
    const placed = Object.values(groups).flat().length;
    expect(placed).toBe(rows.length);
  });

  it('totals what is waiting and what is owed', () => {
    const rows = [
      row({ id: 'a', totalMinor: 45500 }),
      row({ id: 'b', totalMinor: 18000 }),
      row({
        id: 'c',
        ...converted,
        booking: booking({ totalMinor: 18000, depositMinor: 4500, balanceDueMinor: 13500 }),
      }),
      row({ id: 'd', status: 'sent', validUntil: '2026-10-01' }),
      row({ id: 'e', ...converted, booking: booking() }),
    ];
    const totals = worklistTotals(rows, TODAY);
    expect(totals.waiting).toEqual({ count: 2, totalMinor: 63500 });
    expect(totals.balance).toEqual({ count: 1, owedMinor: 13500 });
    expect(totals.expired).toBe(1);
    expect(totals.paid).toBe(1);
  });
});

describe('row actions', () => {
  it('offers "send again" on a sent, valid, unconverted quote', () => {
    const r = row();
    expect(rowSendRefusal(r, TODAY)).toBeNull();
    expect(rowActions(r, TODAY).resend).toBe(true);
  });

  it('offers no resend on a converted quote, whose link the guest may be paying with', () => {
    const r = row({ ...converted, booking: booking({ status: 'payment_pending' }) });
    expect(rowSendRefusal(r, TODAY)).toMatch(/accepted/i);
    expect(rowActions(r, TODAY).resend).toBe(false);
  });

  it('offers no resend on an expired quote, and says how to fix it', () => {
    const r = row({ validUntil: '2026-11-01' });
    expect(rowSendRefusal(r, TODAY)).toMatch(/2026-11-01/);
    expect(rowActions(r, TODAY).resend).toBe(false);
  });

  it('does not offer a draft for sending from the list — it is finished in the editor', () => {
    expect(rowActions(row({ status: 'draft' }), TODAY).resend).toBe(false);
  });

  it('offers the balance link only where a balance is genuinely owed', () => {
    const owed = row({
      ...converted,
      booking: booking({ totalMinor: 18000, depositMinor: 4500, balanceDueMinor: 13500 }),
    });
    expect(rowActions(owed, TODAY).balance).toBe(true);
    expect(rowActions(row({ ...converted, booking: booking() }), TODAY).balance).toBe(false);
  });
});

describe('search', () => {
  it('matches the ref, the name, the email and the phone digits, ignoring case and accents', () => {
    const r = row({ customerName: 'Chloé Martin', customerPhone: '+33 6 12 34 56 78' });
    expect(matchesQuoteSearch(r, '')).toBe(true);
    expect(matchesQuoteSearch(r, 'q7c21')).toBe(true);
    expect(matchesQuoteSearch(r, 'chloe')).toBe(true);
    expect(matchesQuoteSearch(r, 'LUKAS@')).toBe(true);
    expect(matchesQuoteSearch(r, '612345')).toBe(true);
    expect(matchesQuoteSearch(r, 'nobody')).toBe(false);
  });
});

describe('what each quote is for', () => {
  it('names the first line, counts the rest and finds the earliest date', () => {
    const map = lineSummaries([
      {
        quoteId: 'q1',
        position: 1,
        description: 'Suzuki Swift',
        priceLabel: null,
        startsAt: '2026-11-19T20:00:00.000Z',
      },
      {
        quoteId: 'q1',
        position: 0,
        description: 'Private south tour',
        priceLabel: null,
        startsAt: '2026-11-20T05:00:00.000Z',
      },
      { quoteId: 'q2', position: 0, description: null, priceLabel: 'Adult', startsAt: null },
    ]);
    expect(map.get('q1')).toEqual({
      first: 'Private south tour',
      more: 1,
      firstDate: '2026-11-19T20:00:00.000Z',
    });
    expect(map.get('q2')).toEqual({ first: 'Adult', more: 0, firstDate: null });
  });
});
