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
 * createTestDb() from the whole directory. It is deliberately a pattern match on the RESOLVED body
 * rather than an equality check against any one migration — a later migration is free to keep
 * editing these functions, it is only never free to drop the contract.
 *
 * MATCH EXECUTABLE CODE, NEVER COMMENTARY. `prosrc` is the source verbatim, comments and all, and
 * both fixes above are documented by a paragraph INSIDE the function that names the very thing the
 * fix added — api_erase_user's runs "`intro_note = null` IS FROM 20260909000000". A bare substring
 * assertion is therefore satisfied by the prose describing the fix, so a re-definition that dropped
 * the code and kept the comment — exactly how both regressions were written — would have left this
 * file green. Every contract below is matched against `executableSql()`: comments stripped, then
 * whitespace flattened, so the pattern can pin the SHAPE of the statement (a FROM clause, an
 * assignment in an UPDATE target list) and nothing a sentence can imitate. The final case in this
 * file re-runs each contract against a gutted copy of its own body to prove that still bites.
 *
 * ADD A ROW BELOW whenever a function's correctness depends on something a re-definition could
 * silently omit. The cost is one pattern; the bug it catches is a wrong tax document.
 */

interface ResolvedContract {
  /** `proname` — these are all single-signature `(p jsonb)` RPCs. */
  fn: string;
  /** Completes "…still ‹must›", for the test name. */
  must: string;
  /**
   * What the winning body must DO, matched against `executableSql()` — i.e. comments already gone
   * and whitespace flattened, so `\s+` here spans whatever the source happened to wrap on. Pin a
   * statement shape, never a bare identifier: an identifier is something a comment can also say.
   */
  code: RegExp;
  /**
   * The bare substring this contract was asserted on before comments were stripped, IF the body's
   * own commentary also contains it. The bite proof at the foot of this file asserts it survives
   * the gutting — that is the false green, kept executable rather than described.
   */
  alsoSaidInAComment?: string;
  /** What breaks when the winning definition lost it. */
  why: string;
}

const CONTRACTS: ResolvedContract[] = [
  {
    fn: 'api_booking_receipt',
    must: 'selects the custom lines FROM booking_custom_items',
    code: /\bfrom\s+booking_custom_items\b/,
    alsoSaidInAComment: 'booking_custom_items',
    why:
      'a converted quote has ZERO booking_items — its lines live only in booking_custom_items, so ' +
      'the receipt reaches buildInvoice with items: [] and the whole charge is booked as VAT',
  },
  {
    fn: 'api_erase_user',
    must: 'nulls intro_note in the retained-quote anonymize UPDATE',
    code: /\bupdate\s+quotes\s+set\b[^;]*?\bintro_note\s*=\s*null\b/,
    alsoSaidInAComment: 'intro_note = null',
    why:
      'the retained-quote anonymize UPDATE leaves intro_note — the guest-FACING covering note, ' +
      'which opens by addressing the guest by name — on the row after an Art. 17 erasure',
  },
  // 20260911000000 made api_create_payment a WRAPPER over the shared `create_payment` body, so that
  // the quote entry point (api_create_quote_payment) cannot hold a second copy of the single-flight
  // checkout lease. Re-inlining the body here is the drift: this file's own convention — "a later
  // migration re-applies the winning body verbatim" — would produce a customer path and a quote path
  // with two independent leases, i.e. two payable Peach sessions for one booking, silently. Edit the
  // shared function instead.
  {
    fn: 'api_create_payment',
    must: 'returns create_payment(p, true) rather than re-inlining it',
    code: /\breturn\s+create_payment\s*\(\s*p\s*,\s*true\s*\)/,
    why:
      'a re-inlined body gives the customer path its own copy of the checkout lease, free to drift ' +
      'from the one api_create_quote_payment takes — two payable sessions for one booking',
  },
  {
    fn: 'api_create_quote_payment',
    must: 'returns create_payment(p, false) rather than re-implementing the guards',
    code: /\breturn\s+create_payment\s*\(\s*p\s*,\s*false\s*\)/,
    why:
      'the quote path must reach the SHARED body (which is also what makes it skip the caller ' +
      'identity check deliberately, in one place, rather than by re-implementing the guards)',
  },
  // The quote-booking owner match (20260909000000, section 6d). Its absence is INVISIBLE at every
  // level a test usually looks: the booking is minted, it is payable, it confirms, the guest is
  // emailed their invoice — and only the person who paid can never see it again, because
  // `using (user_id = auth.uid() or is_staff())` has no branch that matches null.
  {
    fn: 'api_convert_quote',
    must: 'resolves the booking owner through quote_owner_for_email',
    code: /\bquote_owner_for_email\s*\(/,
    alsoSaidInAComment: 'quote_owner_for_email',
    why:
      'the minted booking is ownerless, so the bookings RLS policy can never match it and the guest ' +
      'who paid cannot open /bookings/{ref} — the page their own confirmation email links to',
  },
  {
    fn: 'api_claim_quote_bookings',
    must: 'only ever fills a NULL user_id',
    code: /\bupdate\s+bookings\b[^;]*?\buser_id\s+is\s+null\b/,
    alsoSaidInAComment: 'user_id is null',
    why:
      'without it a claim can move a booking from one account to another, so an address later ' +
      "re-registered — or simply mistyped — silently transfers someone else's paid booking away",
  },
  {
    fn: 'api_claim_quote_bookings',
    must: 'matches the caller’s own address, read from auth.users by auth.uid()',
    code: /\bfrom\s+auth\.users\b[^;]*?\bid\s*=\s*v_uid\b/,
    why:
      'a claim that matched on an address from the payload would let any signed-in account name a ' +
      "stranger's address and be handed that stranger's booking",
  },
];

/**
 * Splits SQL into code and comment runs. String literals are tracked — a `--` inside `'…'` opens no
 * comment — as are dollar-quoted strings, so nothing quoted is mistaken for either.
 */
interface SqlSegment {
  /** false for the text of a `--` line comment or of a slash-star block comment. */
  code: boolean;
  text: string;
}

function sqlSegments(src: string): SqlSegment[] {
  const out: SqlSegment[] = [];
  let buf = '';
  let i = 0;
  const push = (code: boolean, text: string) => {
    if (text) out.push({ code, text });
  };
  while (i < src.length) {
    const rest = src.slice(i);
    if (rest.startsWith('--')) {
      push(true, buf);
      buf = '';
      const nl = src.indexOf('\n', i);
      const stop = nl === -1 ? src.length : nl; // the newline itself stays in code, so lines never glue
      push(false, src.slice(i, stop));
      i = stop;
      continue;
    }
    if (rest.startsWith('/*')) {
      push(true, buf);
      buf = '';
      let depth = 1; // Postgres nests block comments
      let j = i + 2;
      while (j < src.length && depth > 0) {
        if (src.startsWith('/*', j)) {
          depth += 1;
          j += 2;
        } else if (src.startsWith('*/', j)) {
          depth -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      push(false, src.slice(i, j));
      i = j;
      continue;
    }
    const quote = src[i] === "'" || src[i] === '"' ? src[i] : null;
    if (quote) {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === quote) {
          if (src[j + 1] === quote) {
            j += 2; // '' / "" is an escaped quote, not the end
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      buf += src.slice(i, j);
      i = j;
      continue;
    }
    const dollarTag = /^\$[A-Za-z_]*\$/.exec(rest)?.[0];
    if (dollarTag) {
      const end = src.indexOf(dollarTag, i + dollarTag.length);
      const j = end === -1 ? src.length : end + dollarTag.length;
      buf += src.slice(i, j);
      i = j;
      continue;
    }
    buf += src[i];
    i += 1;
  }
  push(true, buf);
  return out;
}

/** `prosrc` reduced to what actually runs: comments gone, whitespace flattened, case-folded. */
function executableSql(prosrc: string): string {
  return sqlSegments(prosrc)
    .filter((seg) => seg.code)
    .map((seg) => seg.text)
    .join('')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A COPY of a resolved body with the contract's executable text deleted and every comment left
 * exactly where it was. This is the shape of both regressions: a migration re-applies the function
 * from a body that predates the fix, and carries forward the paragraph explaining it.
 */
function codeRemovedCommentsKept(body: string, code: RegExp): string {
  const global = new RegExp(code.source, 'gi');
  return sqlSegments(body)
    .map((seg) => (seg.code ? seg.text.replace(global, ' ') : seg.text))
    .join('');
}

function assertContract(body: string | undefined, { fn, must, code, why }: ResolvedContract): void {
  expect(body, `${fn} is not defined at all on a fully-migrated database`).toBeDefined();
  expect(
    executableSql(body as string),
    `the LAST migration to define ${fn} is the one that wins, and its EXECUTABLE body no longer ` +
      `${must} (${code}) — a comment still saying so does not run: ${why}`,
  ).toMatch(code);
}

/**
 * Every contract in this file is only as trustworthy as this reduction. Too aggressive and a real
 * contract disappears (the cases above go red for the wrong reason); too lenient and prose satisfies
 * the pattern again, which is the bug this file was rewritten to fix. Neither direction is visible
 * from the resolved bodies alone, because none of them happens to quote a `--` today.
 */
describe('executableSql keeps what runs and drops what does not', () => {
  it('drops line and block comments, including the identifier they name', () => {
    expect(executableSql('-- intro_note = null is from 20260909000000\nselect 1;')).toBe(
      'select 1;',
    );
    expect(executableSql('/* set intro_note = null */ select 2;')).toBe('select 2;');
  });

  it('never lets a comment glue itself to the next statement', () => {
    expect(executableSql('select 1; -- why\nselect 2;')).toBe('select 1; select 2;');
  });

  it('keeps a `--` that is inside a string literal, because it is data and it runs', () => {
    expect(executableSql("update t set note = 'a -- b', flag = true;")).toBe(
      "update t set note = 'a -- b', flag = true;",
    );
    expect(executableSql("select 'it''s -- fine', 3;")).toBe("select 'it''s -- fine', 3;");
  });
});

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

  it.each(CONTRACTS)('$fn still $must', (contract) => {
    assertContract(bodies.get(contract.fn), contract);
  });

  /**
   * A GUARD NOBODY HAS WATCHED FAIL IS NOT A GUARD.
   *
   * The cases above are green, and green proves nothing by itself: they would be just as green if
   * the assertion could not fail. So each contract is re-run against a MUTATED COPY of its own
   * resolved body — the real statement deleted, the comments untouched — which is precisely how
   * both regressions were written. The database is never touched; only the string is.
   *
   * For the two contracts whose commentary names what it documents, the same mutant is also checked
   * to still CONTAIN the bare substring this file used to assert on. That is the false green this
   * test replaced, kept here as executable evidence rather than as a claim in a comment.
   */
  it.each(CONTRACTS)(
    '$fn goes RED when the statement is deleted and only the comment naming it survives',
    (contract) => {
      const body = bodies.get(contract.fn);
      expect(body, `${contract.fn} is not defined at all`).toBeDefined();

      const gutted = codeRemovedCommentsKept(body as string, contract.code);
      expect(
        gutted,
        'the mutation removed nothing — the pattern matches no executable code',
      ).not.toBe(body);
      expect(() => assertContract(gutted, contract)).toThrow();

      if (contract.alsoSaidInAComment) {
        expect(
          gutted,
          `${contract.fn}'s own comments no longer say "${contract.alsoSaidInAComment}", so this ` +
            'contract no longer demonstrates the false green it was written for — drop the field',
        ).toContain(contract.alsoSaidInAComment);
      }
    },
  );
});
