import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';
import { hashQuoteToken, mintQuoteToken } from '@/lib/quotes/token';

/**
 * The public quote page's read, against the REAL schema (20260909000000).
 *
 * `resolveQuoteForToken` is the ONLY authorization on /quotes/{ref}: the guest has no account, so
 * there is no session to check and no RLS policy standing behind it — the read runs with the
 * service-role client, which bypasses RLS outright. Everything this file asserts is therefore the
 * gate itself, not a second line of defence.
 *
 * It FAILS CLOSED, returning null and never a distinguishable error, on every one of:
 *   - no such ref;
 *   - a token that does not match the stored hash;
 *   - a quote with NO stored hash at all (a draft that was never sent — `token_hash` is nullable);
 *   - status `cancelled` (the operator withdrew the offer);
 *   - `valid_until` already past;
 *   - no `quote_items` rows at all — a total with no itemisation behind it, which is both a state
 *     saveQuote can leave behind mid-edit and one api_convert_quote refuses to charge.
 *
 * Null for all of them, deliberately: a 404-for-unknown / 403-for-wrong-token split would tell a
 * prober which quote refs exist, and `quotes.ref` is the path segment of a link that is emailed
 * around. One indistinguishable answer is what stops the page being an enumeration oracle.
 *
 * The first test is the positive control and is load-bearing: without it every assertion below is
 * satisfied by `return null`.
 */

const hoisted = vi.hoisted(() => ({ shim: null as SupabaseShim | null }));
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => {
    if (!hoisted.shim) throw new Error('shim not initialised');
    return hoisted.shim;
  },
}));

const { resolveQuoteForToken } = await import('@/lib/quotes/resolve');

const INTERNAL_NOTE = 'margin is thin, do not discount further';

let seq = 0;

interface SeededQuote {
  id: string;
  ref: string;
  token: string;
}

describe('public quote access', () => {
  let db: TestDb;

  /**
   * A sent quote with two priced custom lines, written as the owner, plus the raw token whose SHA-256
   * is what the row stores. `withToken: false` is the never-sent draft: `token_hash` stays null.
   *
   * `valid_until` is computed in JS as a UTC calendar day rather than as `current_date + n`, and that
   * is not cosmetic. Supabase runs its Postgres session in UTC, so `resolveQuoteForToken` compares
   * against UTC — but PGlite picks up the HOST's timezone (Etc/GMT-4 on this machine), so
   * `current_date` here is Mauritius local and sits a day ahead of UTC between midnight and 04:00.
   * Seeding off it would make the expiry assertions pass or fail depending on the hour the suite ran.
   */
  async function seedSentQuote(
    input: {
      status?: string;
      validUntilDays?: number;
      withToken?: boolean;
      /** Skip the two priced lines, leaving `total_minor` standing over nothing. */
      withItems?: boolean;
      /** Stamp `converted_at` — the quote has already been accepted and a booking exists. */
      converted?: boolean;
    } = {},
  ): Promise<SeededQuote> {
    seq += 1;
    const ref = `QPAGE${seq}`;
    const token = mintQuoteToken();
    const tokenHash = input.withToken === false ? null : await hashQuoteToken(token);
    const validUntil = new Date(Date.now() + (input.validUntilDays ?? 7) * 86_400_000)
      .toISOString()
      .slice(0, 10);

    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, customer_phone, status, valid_until,
                           total_minor, intro_note, internal_notes, token_hash, sent_at,
                           converted_at)
       values ($1, 'Marie Dupont', 'marie@example.com', '+230 5555 1234', $2::quote_status,
               $3::date, 23000, 'As discussed on the phone.',
               $4, $5, now(), $6)
       returning id`,
      [
        ref,
        input.status ?? 'sent',
        validUntil,
        INTERNAL_NOTE,
        tokenHash,
        input.converted ? new Date() : null,
      ],
    );
    const id = rows[0]!.id;
    if (input.withItems !== false) {
      await db.pg.query(
        `insert into quote_items
           (quote_id, position, kind, description, starts_at, quantity, unit_amount_minor,
            subtotal_minor)
         values ($1, 0, 'custom', 'Catamaran cruise, 23 Aug', now() + interval '10 days', 2, 5500, 11000),
                ($1, 1, 'custom', 'Private guide, full day', null, 1, 12000, 12000)`,
        [id],
      );
    }

    // Back to the role the page's read actually runs as: service_role, which is the only role the
    // migration grants `select` on `quotes` outside the staff RLS policies.
    await db.as({ role: 'service_role' });
    return { id, ref, token };
  }

  beforeAll(async () => {
    db = await createTestDb();
    hoisted.shim = makeSupabaseShim(db.pg);
    await db.as({ role: 'service_role' });
  });

  afterAll(async () => {
    await db.close();
  });

  it('returns the quote and its lines, in the owner’s order, for the right token', async () => {
    const { ref, token } = await seedSentQuote();

    const quote = await resolveQuoteForToken(ref, token);

    expect(quote, 'the right token did not open the guest’s own quote').not.toBeNull();
    expect(quote!.ref).toBe(ref);
    expect(quote!.customerName).toBe('Marie Dupont');
    expect(quote!.currency).toBe('EUR');
    expect(quote!.totalMinor).toBe(23000);
    expect(quote!.introNote).toBe('As discussed on the phone.');
    expect(quote!.items.map((line) => line.description)).toEqual([
      'Catamaran cruise, 23 Aug',
      'Private guide, full day',
    ]);
    expect(quote!.items[0]!.quantity).toBe(2);
    expect(quote!.items[0]!.unitAmountMinor).toBe(5500);
    expect(quote!.items[0]!.subtotalMinor).toBe(11000);
    // A calendar day, never an instant — the same shape api_convert_quote compares to current_date.
    expect(quote!.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('never hands the guest the staff-only half of the row', async () => {
    // The resolved quote is serialised into the page's payload, so anything on it is readable by the
    // recipient of the link. `internal_notes` sits on the same row ("margin is thin, don't discount
    // further"), and `token_hash` is the material the link token is checked against.
    const { ref, token } = await seedSentQuote();
    const quote = await resolveQuoteForToken(ref, token);

    const serialised = JSON.stringify(quote);
    expect(serialised, 'the operator’s internal note reached the guest').not.toContain('margin is');
    expect(serialised, 'the stored token hash reached the guest').not.toContain('tokenHash');
    expect(serialised).not.toContain('token_hash');
    expect(
      serialised,
      'the guest’s contact details are not needed to render the offer',
    ).not.toContain('marie@example.com');
  });

  it('returns null for a wrong token instead of the quote', async () => {
    const { ref } = await seedSentQuote();
    expect(await resolveQuoteForToken(ref, 'f'.repeat(64))).toBeNull();
  });

  it('returns null when no token is supplied at all', async () => {
    const { ref } = await seedSentQuote();
    expect(await resolveQuoteForToken(ref, '')).toBeNull();
  });

  it('returns null for a quote that was never sent, so has no stored hash', async () => {
    // `token_hash` is nullable. A null-vs-null comparison, or a truthiness check on the wrong side,
    // opens every unsent draft to anyone who guesses its ref — so the empty token is tried too.
    const { ref, token } = await seedSentQuote({ status: 'draft', withToken: false });
    expect(await resolveQuoteForToken(ref, token)).toBeNull();
    expect(await resolveQuoteForToken(ref, '')).toBeNull();
  });

  it('returns null for a cancelled quote even with the right token', async () => {
    const { ref, token } = await seedSentQuote({ status: 'cancelled' });
    expect(await resolveQuoteForToken(ref, token)).toBeNull();
  });

  it('returns null once valid_until has passed', async () => {
    // api_convert_quote raises `quote_expired` on `valid_until < current_date`, so showing the offer
    // past that date is showing a Pay button whose only possible answer is a refusal.
    const { ref, token } = await seedSentQuote({ validUntilDays: -1 });
    expect(await resolveQuoteForToken(ref, token)).toBeNull();

    // The boundary: the last day of validity is still valid, exactly as the RPC reads it.
    const today = await seedSentQuote({ validUntilDays: 0 });
    expect(await resolveQuoteForToken(today.ref, today.token)).not.toBeNull();
  });

  it('returns null for a ref that does not exist', async () => {
    expect(await resolveQuoteForToken('QNOSUCHREF', 'f'.repeat(64))).toBeNull();
    expect(await resolveQuoteForToken('', 'f'.repeat(64))).toBeNull();
  });

  it('returns null for a total with no lines behind it', async () => {
    // A reachable state, not a hypothetical: saveQuote writes the total, DELETEs every line and
    // re-INSERTs them in three non-transactional PostgREST statements, and documents its own failure
    // mode (a stale occurrence id raises 23503 on the re-insert, AFTER the new total is written and
    // the old lines are gone). A guest loading the link in that window would otherwise read
    // "Total EUR 230.00" over an empty list — and if the re-insert failed, indefinitely.
    //
    // It is also the state api_convert_quote refuses with `quote_total_mismatch`, so the Pay button's
    // only possible answer is a refusal: there is nothing chargeable to show.
    const { ref, token } = await seedSentQuote({ withItems: false });
    expect(await resolveQuoteForToken(ref, token)).toBeNull();
  });

  it('reports an already-accepted quote as converted rather than as a fresh offer', async () => {
    // The link gets forwarded — to a partner, a travel agent, or just reopened by the guest after
    // paying. Without `converted_at` on the model the page shows an unqualified "Accept & pay" to
    // someone whose booking already exists, and clicking it yields a raw refusal.
    const { ref, token } = await seedSentQuote({ status: 'accepted', converted: true });

    const quote = await resolveQuoteForToken(ref, token);
    expect(
      quote,
      'a converted quote must still be readable — the guest paid for it',
    ).not.toBeNull();
    expect(quote!.convertedAt).not.toBeNull();
    expect(new Date(quote!.convertedAt!).getTime()).toBeGreaterThan(0);

    // An un-converted one must not claim to be converted.
    const fresh = await seedSentQuote();
    expect((await resolveQuoteForToken(fresh.ref, fresh.token))!.convertedAt).toBeNull();
  });
});
