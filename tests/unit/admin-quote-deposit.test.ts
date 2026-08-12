import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Task 8 of the quote-deposit plan: the operator sets a per-quote deposit % (default 10, or
 * "pay in full" = 100%) and it reaches `quotes.deposit_bps` as BASIS POINTS (1000 = 10.00%; 10000 =
 * pay-in-full). The schema pins the column itself (default 1000, `check between 1 and 10000`,
 * tests/integration/quote-deposit-schema.test.ts). This pins the UI/type layer that feeds it, and the
 * one LANDMINE that guards it.
 *
 * THE LANDMINE. `saveQuote` FULL-REPLACES the guest/note fields — omitting one CLEARS the stored
 * column — so `deposit_bps` MUST be write-only-when-supplied, exactly like `currency` and `locale`:
 * an edit from a form (or an AI email-to-draft) that has no deposit input must leave the stored
 * deposit alone, not reset it to the default. Its default (1000) belongs to the INSERT only.
 *
 * The write is proved against a CAPTURING fake of the browser client (the CRUD-against-real-schema
 * side is tests/integration/admin-quotes.test.ts); the pure form/type layer is proved directly.
 */

const hoisted = vi.hoisted(() => ({
  captured: {
    quotesInsert: null as Record<string, unknown> | null,
    quotesUpdate: null as Record<string, unknown> | null,
  },
}));

// The browser client saveQuote talks to. A builder that records the `quotes` insert/update payloads
// and answers each chain saveQuote awaits — the INSERT path (`.insert().select('id').single()`), the
// edit UPDATE (`.update().eq().is().select('id')`), the line delete/insert, and the post-write
// `converted_at` re-read — with the shapes those call sites unwrap.
vi.mock('@/lib/supabase/browser', () => {
  function builder(table: string): Record<string, unknown> {
    const b: Record<string, unknown> = {
      insert(payload: Record<string, unknown>) {
        if (table === 'quotes') hoisted.captured.quotesInsert = payload;
        return b;
      },
      update(payload: Record<string, unknown>) {
        if (table === 'quotes') hoisted.captured.quotesUpdate = payload;
        return b;
      },
      delete: () => b,
      select: () => b,
      eq: () => b,
      is: () => b,
      order: () => b,
      limit: () => b,
      single: async () => ({ data: { id: 'new-quote-id' }, error: null }),
      // assertStillUnconverted reads `converted_at`; null = still unconverted, so the edit is accepted.
      maybeSingle: async () => ({ data: { converted_at: null }, error: null }),
      then: (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
        Promise.resolve(
          // The guarded UPDATE returns matched rows; every other bare-await resolves cleanly.
          table === 'quotes'
            ? { data: [{ id: 'existing-id' }], error: null }
            : { data: null, error: null },
        ).then(onF, onR),
    };
    return b;
  }
  return {
    getBrowserSupabase: () => ({
      auth: {
        getSession: async () => ({
          data: { session: { access_token: 'staff-token', user: { id: 'staff-1' } } },
        }),
      },
      from: (table: string) => builder(table),
    }),
  };
});

const { saveQuote } = await import('@/lib/admin/quotes');
import type { QuoteDetail, QuoteInput } from '@/lib/admin/quotes';
import {
  DEFAULT_DEPOSIT_BPS,
  PAY_IN_FULL_BPS,
  depositBpsFromPercent,
  depositMinorOf,
  depositPercentFromBps,
  emptyQuoteForm,
  formFromQuote,
  quoteInputFromForm,
} from '@/components/admin/quotes/state';

beforeEach(() => {
  hoisted.captured.quotesInsert = null;
  hoisted.captured.quotesUpdate = null;
});

/** A whole quote input, deposit omitted by default so a test can add (or withhold) it. */
function input(over: Partial<QuoteInput> = {}): QuoteInput {
  return {
    customerName: 'Marie Dupont',
    customerEmail: 'marie@example.com',
    validUntil: '2099-12-31',
    items: [{ kind: 'custom', description: 'Charter', quantity: 1, unitAmountMinor: 50000 }],
    ...over,
  };
}

function detail(over: Partial<QuoteDetail> = {}): QuoteDetail {
  return {
    id: 'q1',
    bookingStatus: null,
    ref: 'Q0123456789AB',
    customerName: 'Marie Dupont',
    customerEmail: 'marie@example.com',
    customerPhone: null,
    roomOrCabin: null,
    status: 'draft',
    currency: 'EUR',
    totalMinor: 100000,
    validUntil: '2099-12-31',
    introNote: null,
    internalNotes: null,
    sentAt: null,
    bookingId: null,
    convertedAt: null,
    locale: 'en',
    depositBps: 1000,
    createdAt: '2026-08-06T08:00:00.000Z',
    updatedAt: '2026-08-06T09:00:00.000Z',
    items: [],
    ...over,
  };
}

describe('the deposit in the editor form', () => {
  it('defaults a new quote to a 10% deposit (1000 bps)', () => {
    // The product default, and the same figure the schema column defaults to — an operator who never
    // touches the field still quotes a 10% deposit.
    expect(emptyQuoteForm('2026-08-06').depositBps).toBe(1000);
    expect(DEFAULT_DEPOSIT_BPS).toBe(1000);
    expect(PAY_IN_FULL_BPS).toBe(10000);
  });

  it('carries the form deposit through to the save input in basis points', () => {
    const form = { ...emptyQuoteForm('2026-08-06'), depositBps: 2000 };
    expect(quoteInputFromForm(form).depositBps).toBe(2000);
  });

  it('round-trips deposit_bps back into the editor without a float', () => {
    // A stored deposit that is not a round percent (an AI draft, a manual SQL set) must come back
    // EXACTLY, and survive a save the operator never touched the field on.
    const back = formFromQuote(detail({ depositBps: 3500 }));
    expect(back.depositBps).toBe(3500);
    expect(quoteInputFromForm(back).depositBps).toBe(3500);
  });

  it('shows basis points as a whole percent, and reads a typed percent back as bps', () => {
    expect(depositPercentFromBps(1000)).toBe(10);
    expect(depositPercentFromBps(2000)).toBe(20);
    expect(depositPercentFromBps(10000)).toBe(100);
    expect(depositBpsFromPercent(20)).toBe(2000);
    expect(depositBpsFromPercent(100)).toBe(10000);
    // Clamped to the schema's 1..100% range rather than emitting an out-of-check value.
    expect(depositBpsFromPercent(0)).toBe(100);
    expect(depositBpsFromPercent(150)).toBe(10000);
  });

  it('computes the deposit amount for display exactly as the conversion RPC sizes the charge', () => {
    // api_convert_quote sizes the first charge as round(total_minor * deposit_bps / 10000), so what
    // the operator sees as "deposit" is what the guest is charged to confirm; the balance is the rest.
    expect(depositMinorOf(100000, 1000)).toBe(10000);
    expect(depositMinorOf(100000, 10000)).toBe(100000);
    expect(depositMinorOf(99999, 1000)).toBe(10000); // round, not floor
  });
});

describe('saveQuote stores the deposit (write-only-when-supplied)', () => {
  it('(a) stores deposit % 20 as deposit_bps 2000 on a new quote', async () => {
    await saveQuote(input({ depositBps: 2000 }));
    expect(hoisted.captured.quotesInsert?.deposit_bps).toBe(2000);
  });

  it('(c) stores pay-in-full as deposit_bps 10000', async () => {
    await saveQuote(input({ depositBps: 10000 }));
    expect(hoisted.captured.quotesInsert?.deposit_bps).toBe(10000);
  });

  it('(d) defaults a new quote with no deposit supplied to 1000', async () => {
    // An AI email-to-draft (draftFromExtraction) hands over no deposit; the INSERT default is 10%.
    await saveQuote(input());
    expect(hoisted.captured.quotesInsert?.deposit_bps).toBe(1000);
  });

  it('(b) does NOT reset deposit_bps when an edit omits it', async () => {
    // THE LANDMINE. A full-replace would put deposit_bps in the UPDATE payload and clear the stored
    // deposit to nothing on any edit from a form without the input. It must be absent from the update.
    await saveQuote(input({ id: 'existing-id' }));
    expect(hoisted.captured.quotesUpdate).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(hoisted.captured.quotesUpdate, 'deposit_bps')).toBe(
      false,
    );
  });

  it('writes deposit_bps on an edit only when the caller supplied it', async () => {
    await saveQuote(input({ id: 'existing-id', depositBps: 2500 }));
    expect(hoisted.captured.quotesUpdate?.deposit_bps).toBe(2500);
  });

  it('refuses a deposit outside the schema 1..10000 range before writing anything', async () => {
    // Mirror the DB CHECK so a cast or a JSON body is a readable refusal, not a raw constraint error
    // at INSERT. 0 charges nothing and never confirms; over 10000 is more than the whole price.
    await expect(saveQuote(input({ depositBps: 0 }))).rejects.toThrow(/deposit/i);
    await expect(saveQuote(input({ depositBps: 10001 }))).rejects.toThrow(/deposit/i);
    await expect(saveQuote(input({ depositBps: 12.5 }))).rejects.toThrow(/deposit/i);
    expect(hoisted.captured.quotesInsert, 'a bad deposit still reached a write').toBeNull();
  });
});
