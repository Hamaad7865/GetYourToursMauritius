import { describe, expect, it } from 'vitest';
import { buildAccess, type PermissionKey } from '@/lib/admin/permissions';
import { buildRecordLookups, type RefLookupClient } from '@/lib/http/assistant-lookups';

/* The assistant's lookup_booking / lookup_quote tools read a guest's name, email and amounts through
 * the SERVICE-ROLE client, which sees every row. Holding the assistant section alone must not unlock
 * that: the booking lookup needs Bookings and the quote lookup needs Quotes. A refusal is the tool's
 * ordinary "not found" (null), and the database is not even asked. */

const BOOKING = {
  ref: 'BMT123',
  status: 'confirmed',
  payment_state: 'paid',
  customer_name: 'Ada Guest',
  customer_email: 'ada@example.com',
  currency: 'EUR',
  total_minor: 15000,
  deposit_minor: 5000,
  balance_due_minor: 10000,
  pickup_location: 'Hotel',
  created_at: '2026-10-01T00:00:00Z',
};
const QUOTE = {
  ref: 'QABC12',
  status: 'sent',
  customer_name: 'Ada Guest',
  customer_email: 'ada@example.com',
  currency: 'EUR',
  total_minor: 20000,
  valid_until: '2026-12-01',
  deposit_bps: 3000,
  sent_at: null,
  converted_at: null,
  created_at: '2026-10-01T00:00:00Z',
};

function fakeDb(): { db: RefLookupClient; reads: string[] } {
  const reads: string[] = [];
  const db: RefLookupClient = {
    from: (table) => ({
      select: () => ({
        eq: (_column, ref) => ({
          maybeSingle: async () => {
            reads.push(`${table}:${ref}`);
            const row = table === 'bookings' ? BOOKING : QUOTE;
            return { data: ref === row.ref ? { ...row } : null, error: null };
          },
        }),
      }),
    }),
  };
  return { db, reads };
}

const staffWith = (...permissions: PermissionKey[]) => buildAccess({ role: 'staff', permissions });

describe('buildRecordLookups', () => {
  it('lookupBooking answers null, without reading, for a role that lacks Bookings', async () => {
    const { db, reads } = fakeDb();
    const lookups = buildRecordLookups(db, staffWith('section.assistant', 'section.quotes'));
    expect(await lookups.lookupBooking('BMT123')).toBeNull();
    expect(reads).toEqual([]);
  });

  it('lookupQuote answers null, without reading, for a role that lacks Quotes', async () => {
    const { db, reads } = fakeDb();
    const lookups = buildRecordLookups(db, staffWith('section.assistant', 'section.bookings'));
    expect(await lookups.lookupQuote('QABC12')).toBeNull();
    expect(reads).toEqual([]);
  });

  it('a content-only account reads neither', async () => {
    const { db, reads } = fakeDb();
    const lookups = buildRecordLookups(
      db,
      buildAccess({ role: 'seo', permissions: ['section.seo'] }),
    );
    expect(await lookups.lookupBooking('BMT123')).toBeNull();
    expect(await lookups.lookupQuote('QABC12')).toBeNull();
    expect(reads).toEqual([]);
  });

  it('returns the booking, amounts in euros, to a role that holds Bookings', async () => {
    const { db, reads } = fakeDb();
    const lookups = buildRecordLookups(db, staffWith('section.bookings'));
    const row = await lookups.lookupBooking(' bmt123 ');
    expect(reads).toEqual(['bookings:BMT123']);
    expect(row).toMatchObject({
      ref: 'BMT123',
      customer_name: 'Ada Guest',
      totalEur: 150,
      depositEur: 50,
      balanceDueEur: 100,
    });
    expect(row).not.toHaveProperty('total_minor');
  });

  it('returns the quote, total in euros, to a role that holds Quotes', async () => {
    const { db, reads } = fakeDb();
    const lookups = buildRecordLookups(db, staffWith('section.quotes'));
    const row = await lookups.lookupQuote('qabc12');
    expect(reads).toEqual(['quotes:QABC12']);
    expect(row).toMatchObject({ ref: 'QABC12', status: 'sent', totalEur: 200 });
    expect(row).not.toHaveProperty('total_minor');
  });

  it('the Owner reads both', async () => {
    const { db } = fakeDb();
    const lookups = buildRecordLookups(db, buildAccess({ role: 'admin' }));
    expect(await lookups.lookupBooking('BMT123')).not.toBeNull();
    expect(await lookups.lookupQuote('QABC12')).not.toBeNull();
  });

  it('an unknown ref is null for a permitted role too', async () => {
    const { db } = fakeDb();
    const lookups = buildRecordLookups(db, buildAccess({ role: 'admin' }));
    expect(await lookups.lookupBooking('BMTNOPE')).toBeNull();
    expect(await lookups.lookupQuote('QNOPE')).toBeNull();
  });
});
