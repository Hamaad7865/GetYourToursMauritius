import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * WHICH DEFINITION ACTUALLY WON.
 *
 * Two migrations may both define the same function, and the LATER file wins everywhere — the
 * migration directory, supabase/catch-up.sql and supabase/setup.sql all concatenate in filename
 * order. That has now shipped a live bug from this repo TWICE:
 *
 *   1. api_booking_receipt — 20260909000000_quotes.sql taught it to union `booking_custom_items`
 *      into its `items` array (a converted quote's lines live there and NOWHERE else, so without it
 *      the VAT invoice came out with no lines and buildInvoice booked the entire charge as VAT).
 *      20260910000000_late_pickup_addon.sql then re-applied the function from a body that predated
 *      the union, and won. A EUR 1200 quote was invoiced as EUR 1200 of tax.
 *   2. api_erase_user — the same pair, over the `intro_note = null` in the retained-quote anonymize
 *      UPDATE. A GDPR Art. 17 erasure left the guest-facing covering note, which opens by addressing
 *      the guest by name, on the retained row.
 *
 * THE EXISTING PARITY TESTS CANNOT SEE THIS. catch-up-parity / setup-sql-parity compare the
 * migrations against the bundles, and both copies are present in both, in the same order — so the
 * bundles are in perfect parity with a directory that resolves to the WRONG body. The concatenation
 * is consistent; what it concatenates to is not.
 *
 * So this test asks the only authority that can answer: `pg_proc.prosrc` on a database built by
 * createTestDb() from the whole directory. It is deliberately a substring assertion on the RESOLVED
 * body rather than an equality check against any one migration — a later migration is free to keep
 * editing these functions, it is only never free to drop the contract.
 *
 * ADD A ROW BELOW whenever a function's correctness depends on something a re-definition could
 * silently omit. The cost is one string; the bug it catches is a wrong tax document.
 */

interface ResolvedContract {
  /** `proname` — these are all single-signature `(p jsonb)` RPCs. */
  fn: string;
  /** A fragment the WINNING body must contain. */
  needle: string;
  /** What breaks when the winning definition lost it. */
  why: string;
}

const CONTRACTS: ResolvedContract[] = [
  {
    fn: 'api_booking_receipt',
    needle: 'booking_custom_items',
    why:
      'a converted quote has ZERO booking_items — its lines live only in booking_custom_items, so ' +
      'the receipt reaches buildInvoice with items: [] and the whole charge is booked as VAT',
  },
  {
    fn: 'api_erase_user',
    needle: 'intro_note',
    why:
      'the retained-quote anonymize UPDATE leaves intro_note — the guest-FACING covering note, ' +
      'which opens by addressing the guest by name — on the row after an Art. 17 erasure',
  },
];

describe('the winning definition of a re-defined function keeps its contract', () => {
  let db: TestDb;
  let bodies: Map<string, string>;

  beforeAll(async () => {
    // The whole migration directory, in filename order — i.e. what a real database resolves to.
    db = await createTestDb();
    const { rows } = await db.pg.query<{ proname: string; prosrc: string }>(
      `select p.proname, p.prosrc
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = any($1::text[])`,
      [CONTRACTS.map((c) => c.fn)],
    );
    bodies = new Map(rows.map((r) => [r.proname, r.prosrc]));
  });

  afterAll(async () => {
    await db.close();
  });

  it.each(CONTRACTS)('$fn still contains "$needle"', ({ fn, needle, why }) => {
    const body = bodies.get(fn);
    expect(body, `${fn} is not defined at all on a fully-migrated database`).toBeDefined();
    expect(
      body,
      `the LAST migration to define ${fn} dropped "${needle}", and it is the one that wins: ${why}`,
    ).toContain(needle);
  });
});
