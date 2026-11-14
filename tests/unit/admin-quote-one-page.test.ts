process.env.TZ = 'UTC';

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DEPOSIT_BPS,
  PAY_IN_FULL_BPS,
  applyPlan,
  customLineDraft,
  dueNowSummary,
  emptyQuoteForm,
  planOf,
  quoteBreakdown,
  sendBlockReason,
  type QuoteFormValues,
  type QuoteLineDraft,
} from '@/components/admin/quotes/state';
import {
  balanceWhatsAppText,
  quoteWhatsAppText,
  whatsappHref,
  whatsappNumber,
} from '@/components/admin/quotes/whatsapp';
import {
  itemSuggestions,
  newItemDraft,
  pastLineDraft,
  pastLinesFrom,
  searchKey,
} from '@/components/admin/quotes/suggest';
import { looksLikeEmail, returningGuestNote } from '@/components/admin/quotes/guest';
import { likeExact } from '@/lib/admin/quotes';

/**
 * The one-page quote editor's decisions: the payment plan behind the segmented control, when the one
 * Send button is allowed, the summary figures, the WhatsApp hand-off and the "add an item" box. All
 * pure — the screen (AdminQuotes.tsx) only draws them.
 */

const TODAY = '2026-11-14';

function line(over: Partial<QuoteLineDraft> = {}): QuoteLineDraft {
  return { ...customLineDraft(), description: 'Private south tour', unitText: '180.00', ...over };
}

function form(over: Partial<QuoteFormValues> = {}): QuoteFormValues {
  return {
    ...emptyQuoteForm(TODAY),
    customerName: 'Lukas Weber',
    customerEmail: 'lukas@example.com',
    lines: [line()],
    ...over,
  };
}

describe('the payment plan', () => {
  it('reads per date first, then pay in full, then deposit', () => {
    expect(planOf(form({ paymentMode: 'per_date', depositBps: PAY_IN_FULL_BPS }))).toBe('per_date');
    expect(planOf(form({ depositBps: PAY_IN_FULL_BPS }))).toBe('full');
    expect(planOf(form({ depositBps: 2500 }))).toBe('deposit');
  });

  it('sets pay in full as 100% on the deposit path', () => {
    const next = applyPlan(form({ depositBps: 2500 }), 'full', 2500);
    expect(next.depositBps).toBe(PAY_IN_FULL_BPS);
    expect(next.paymentMode).toBe('deposit');
  });

  it('restores the negotiated deposit when switching back from pay in full, not the default', () => {
    const full = applyPlan(form({ depositBps: 2500 }), 'full', 2500);
    expect(applyPlan(full, 'deposit', 2500).depositBps).toBe(2500);
    // With nothing remembered, the product default.
    expect(
      applyPlan(form({ depositBps: PAY_IN_FULL_BPS }), 'deposit', PAY_IN_FULL_BPS).depositBps,
    ).toBe(DEFAULT_DEPOSIT_BPS);
  });

  it('switches to per date without touching the stored deposit', () => {
    const next = applyPlan(form({ depositBps: 2500 }), 'per_date', 2500);
    expect(next.paymentMode).toBe('per_date');
    expect(next.depositBps).toBe(2500);
    expect(applyPlan(next, 'deposit', 2500).paymentMode).toBe('deposit');
  });
});

describe('the summary', () => {
  it('splits the total into items and attached transfers', () => {
    const f = form({
      lines: [
        line({ transport: { pickupLabel: 'Lux Belle Mare', dropoffLabel: '', fareText: '60' } }),
        line({ description: 'Suzuki Swift', kind: 'rental', quantityText: '4', unitText: '45' }),
      ],
    });
    expect(quoteBreakdown(f)).toEqual({
      itemsMinor: 36000,
      transfersMinor: 6000,
      totalMinor: 42000,
    });
  });

  it('shows nothing while a line is half-typed', () => {
    expect(quoteBreakdown(form({ lines: [line({ unitText: '12.' })] }))).toBeNull();
  });

  it('states what the guest pays now for each plan', () => {
    expect(dueNowSummary(form({ depositBps: PAY_IN_FULL_BPS }))).toMatchObject({
      nowMinor: 18000,
      laterMinor: 0,
    });
    expect(dueNowSummary(form({ depositBps: 2500 }))).toMatchObject({
      nowMinor: 4500,
      laterMinor: 13500,
    });
    const perDate = dueNowSummary(
      form({
        paymentMode: 'per_date',
        lines: [
          line({ date: '2026-11-19' }),
          line({ description: 'Catamaran', unitText: '90', date: '2026-11-21' }),
        ],
      }),
    );
    expect(perDate?.schedule.map((s) => s.amountMinor)).toEqual([18000, 9000]);
    expect(perDate?.nowMinor).toBe(18000);
  });
});

describe('the one Send button', () => {
  it('lets an unsaved quote be sent — it is saved first', () => {
    expect(sendBlockReason(form({ id: null }), TODAY)).toBeNull();
  });

  it('is blocked, with the reason, whenever the save or the send would refuse', () => {
    expect(sendBlockReason(form({ customerEmail: '' }), TODAY)).toMatch(/email/i);
    expect(sendBlockReason(form({ lines: [] }), TODAY)).toMatch(/item/i);
    expect(sendBlockReason(form({ lines: [line({ unitText: 'abc' })] }), TODAY)).toMatch(
      /Line 1 unit price/,
    );
    expect(sendBlockReason(form({ lines: [line({ unitText: '0' })] }), TODAY)).toMatch(/nothing/i);
    expect(sendBlockReason(form({ id: 'q1', status: 'cancelled' }), TODAY)).toMatch(/withdrawn/i);
    expect(
      sendBlockReason(form({ id: 'q1', convertedAt: '2026-11-12T09:00:00.000Z' }), TODAY),
    ).toMatch(/accepted/i);
    expect(sendBlockReason(form({ validUntil: '2026-11-13' }), TODAY)).toMatch(/2026-11-13/);
  });
});

describe('WhatsApp', () => {
  it('accepts a number written with its country code, in any spacing', () => {
    expect(whatsappNumber('+49 170 555 0142')).toEqual({ digits: '491705550142' });
    expect(whatsappNumber('0044 (0)7700-900.123')).toEqual({ digits: '447700900123' });
    expect(whatsappNumber('+230 5772 9919')).toEqual({ digits: '23057729919' });
  });

  it('refuses, with the reason, anything that cannot be dialled safely', () => {
    expect(whatsappNumber('')).toHaveProperty('reason', expect.stringMatching(/no phone/i));
    expect(whatsappNumber(null)).toHaveProperty('reason');
    // No country code: a guess here could message a stranger.
    expect(whatsappNumber('5772 9919')).toHaveProperty(
      'reason',
      expect.stringMatching(/country code/i),
    );
    expect(whatsappNumber('+1 23')).toHaveProperty('reason');
    expect(whatsappNumber('+44 7700 900123 ext 4')).toHaveProperty('reason');
  });

  it('builds the wa.me link with the message encoded, never a bare fallback number', () => {
    const href = whatsappHref('447700900123', 'Hello & welcome: https://x.test/q?t=a b');
    expect(href).toBe(
      'https://wa.me/447700900123?text=Hello%20%26%20welcome%3A%20https%3A%2F%2Fx.test%2Fq%3Ft%3Da%20b',
    );
  });

  it('writes the message in the quote’s language and carries the fresh link', () => {
    const url = 'https://bellemaretours.com/quotes/Q1/open?t=abc';
    const en = quoteWhatsAppText({ customerName: 'Lukas Weber', ref: 'Q1', url, locale: 'en' });
    expect(en).toContain('Hello Lukas');
    expect(en).toContain(url);
    expect(en).toContain('Q1');
    const fr = quoteWhatsAppText({ customerName: 'Chloé Martin', ref: 'Q1', url, locale: 'fr' });
    expect(fr).toContain('Bonjour Chloé');
    expect(fr).toContain(url);
    expect(balanceWhatsAppText({ customerName: 'Lukas', url, locale: 'en' })).toContain(url);
  });
});

describe('the "add an item" box', () => {
  const past = pastLinesFrom([
    {
      description: '  catamaran cruise, 3 northern  islands ',
      unitAmountMinor: 8500,
      quotedAt: '2026-10-01T10:00:00Z',
    },
    {
      description: 'Catamaran cruise, 3 northern islands',
      unitAmountMinor: 9300,
      quotedAt: '2026-11-01T10:00:00Z',
    },
    { description: 'Private south tour', unitAmountMinor: 18000, quotedAt: '2026-09-01T10:00:00Z' },
    { description: '', unitAmountMinor: 100, quotedAt: '2026-11-02T10:00:00Z' },
  ]);

  it('keeps one entry per hand-typed line, at its latest price, newest first', () => {
    expect(past).toHaveLength(2);
    expect(past[0]).toMatchObject({ unitAmountMinor: 9300, uses: 2 });
    expect(past[1]!.description).toBe('Private south tour');
  });

  it('searches without case or accents', () => {
    expect(searchKey('  Île  aux Cerfs ')).toBe('ile aux cerfs');
  });

  it('suggests past lines, catalogue tours and vehicles in one list, then a new item', () => {
    const list = itemSuggestions('cata', {
      past,
      tours: [
        { id: 't1', title: 'Catamaran cruise to Île aux Cerfs', status: 'published' },
        { id: 't2', title: 'Private north tour', status: 'published' },
      ],
      vehicles: [{ slug: 'swift', name: 'Suzuki Swift', dailyRateMinor: 4500 }],
    });
    expect(list.map((s) => s.kind)).toEqual(['past', 'tour', 'new']);
    expect(list[list.length - 1]).toMatchObject({ kind: 'new', text: 'cata' });
  });

  it('finds a vehicle by name, and lists recent lines when nothing is typed', () => {
    const sources = {
      past,
      tours: [],
      vehicles: [{ slug: 'swift', name: 'Suzuki Swift', dailyRateMinor: 4500 }],
    };
    expect(itemSuggestions('swift', sources).map((s) => s.kind)).toEqual(['vehicle', 'new']);
    expect(itemSuggestions('', sources).map((s) => s.kind)).toEqual(['past', 'past']);
  });

  it('turns a past line into a custom line at its last price, quantity one', () => {
    const draft = pastLineDraft(past[0]!);
    expect(draft.kind).toBe('custom');
    expect(draft.description).toBe('Catamaran cruise, 3 northern islands');
    expect(draft.unitText).toBe('93.00');
    expect(draft.quantityText).toBe('1');
    expect(draft.transport).toBeNull();
  });

  it('turns typed text into a custom line with no price', () => {
    const draft = newItemDraft('  Sunset dinner ');
    expect(draft).toMatchObject({ kind: 'custom', description: 'Sunset dinner', unitText: '' });
  });
});

describe('the returning-guest hint', () => {
  it('only looks up something shaped like an email', () => {
    expect(looksLikeEmail('lukas@example.com')).toBe(true);
    expect(looksLikeEmail('lukas@')).toBe(false);
    expect(looksLikeEmail('')).toBe(false);
  });

  it('counts earlier quotes and bookings, leaving out the quote on screen', () => {
    expect(
      returningGuestNote(
        {
          quotes: [{ id: 'q1' }, { id: 'q2' }, { id: 'q3' }],
          bookings: [{ ref: 'BMT1', createdAt: '2026-10-12T08:00:00Z' }],
        },
        'q1',
      ),
    ).toBe('Returning guest: 2 earlier quotes, 1 booking');
    expect(returningGuestNote({ quotes: [{ id: 'q1' }], bookings: [] }, 'q1')).toBeNull();
    expect(returningGuestNote({ quotes: [], bookings: [] }, null)).toBeNull();
  });

  it('escapes the wildcards an email can carry before it is matched', () => {
    expect(likeExact('first_last%x\\y@example.com')).toBe('first\\_last\\%x\\\\y@example.com');
  });
});
