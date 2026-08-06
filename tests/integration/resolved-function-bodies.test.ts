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
  // The erasure's SCOPE. api_erase_user normalised only the REQUEST and compared it against a raw
  // `lower(customer_email)`, so a booking or quote whose stored address carried the whitespace it was
  // pasted with fell outside an Art. 17 sweep and was silently retained with the guest's name, address,
  // phone and free text on it — while the call returned ok: true. This is the highest-value row in the
  // file to pin: the only evidence of the failure is data nobody can see, and api_erase_user is the
  // function this repo has already silently re-defined from a stale body TWICE.
  {
    fn: 'api_erase_user',
    must: 'normalises the STORED address through quote_email_key, not lower() alone',
    code: /\bquote_email_key\s*\(\s*customer_email\s*\)\s*=\s*v_email\b/,
    alsoSaidInAComment: 'quote_email_key(customer_email) = v_email',
    why:
      'the erasure matches only rows whose address is stored exactly as typed, so a booking or quote ' +
      'carrying a pasted leading/trailing space keeps the guest’s name, email, phone and notes forever',
  },
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
  // The deposit is the first `booking` payments row SIZED to it, not a partial capture — that is the
  // whole design (20260912000000): append_payment_event confirms a booking when THIS row is paid in
  // full, so a deposit-sized row confirms on the deposit. A re-definition that re-inlined the old
  // `amount_minor = v_booking.total_minor` would charge a quote guest the full price at the deposit
  // step; a naive `v_booking.deposit_minor` with no fallback would charge an ordinary customer booking
  // 0 (deposit_minor DEFAULTS to 0 for the non-quote path). Both are silent — the suite stays green
  // for the customer path in the first case and only the quote guest sees the second. Pin the shape.
  {
    fn: 'create_payment',
    must: 'sizes the first booking payments row to the deposit, falling back to total_minor',
    code: /\bcoalesce\s*\(\s*nullif\s*\(\s*v_booking\.deposit_minor\s*,\s*0\s*\)\s*,\s*v_booking\.total_minor\s*\)/,
    why:
      'the first booking row is the DEPOSIT charge; losing the coalesce/nullif either bills a quote ' +
      'guest the full price at the deposit step or bills a depositless customer booking its default 0',
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
  // Deposit sizing at conversion (20260912000000). The booking is minted with deposit_minor and
  // balance_due_minor derived from quotes.deposit_bps; a re-definition from the pre-deposit body would
  // leave both at their column DEFAULT (0), so create_payment would charge the full total and the
  // deposit feature would silently revert to pay-in-full for every quote. Pin the computation itself.
  {
    fn: 'api_convert_quote',
    must: 'sizes the booking deposit from deposit_bps at conversion',
    code: /\bv_deposit_minor\s*:=\s*round\s*\(\s*v_quote\.total_minor\s*\*\s*v_quote\.deposit_bps\s*\/\s*10000/,
    why:
      'without it the booking carries deposit_minor/balance_due_minor at their default 0, so the ' +
      'deposit charge collapses to the full total and no balance is ever owed',
  },
  // append_payment_event maintains balance_due_minor (20260912000000, Task 3). This is the repo's most
  // dangerous function and has ALREADY been re-declared from a stale body twice; a re-definition from
  // the pre-deposit copy would silently drop this statement, leaving balance_due_minor frozen at its
  // conversion value forever — a quote guest's balance would still read as owed after they paid it, and
  // every downstream "is this fully settled?" read off the column would be wrong. The comment paragraph
  // above the statement names `balance_due_minor` too, so a bare-substring assertion would false-green
  // on exactly that dropped-code / kept-comment shape. Pin the STATEMENT: the assignment to
  // balance_due_minor via greatest(0, …), summing paid_minor over the purpose-scoped rows.
  {
    fn: 'append_payment_event',
    must: 'recomputes balance_due_minor as a purpose-scoped sum of paid_minor',
    code: /\bbalance_due_minor\s*=\s*greatest\s*\(\s*0\s*,[\s\S]*?\bsum\s*\(\s*pay\.paid_minor\s*\)[\s\S]*?\bpurpose\s+in\s*\(\s*'booking'\s*,\s*'balance'\s*\)/,
    alsoSaidInAComment: 'balance_due_minor',
    why:
      'a re-definition from the pre-deposit body drops the balance_due_minor projection, so a paid ' +
      'balance never clears the amount owed and the column lies to every reader that trusts it',
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
  // The claim and the conversion have to decide "the same address" the same way, which is why the
  // rule is a function (quote_email_key, 20260909000000 section 6c-bis) rather than an expression
  // copied into two places. This pins the side that had drifted: the owner match btrimmed, the claim
  // did not, so a booking minted for a pasted ' nina@example.com' was matchable at payment and
  // unclaimable forever afterwards.
  {
    fn: 'api_claim_quote_bookings',
    must: 'normalises the BOOKING address the same way conversion does',
    code: /\bquote_email_key\s*\(\s*b\.customer_email\s*\)/,
    alsoSaidInAComment: 'quote_email_key on the BOOKING column too',
    why:
      'a `lower()`-only compare cannot see a booking whose stored address carries the whitespace it ' +
      'was quoted with — the guest paid, and their own sign-in can never pick that booking up',
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
 *
 * THE MATCH RUNS OVER THE JOINED CODE, exactly as {@link executableSql} matches it, and never over
 * each segment on its own. Several contracts pin a RANGE — api_erase_user's runs from
 * `update quotes set` to `intro_note = null` — and a `--` comment anywhere inside that range splits
 * it across two code segments. Per segment, neither half matches: the mutant would come back
 * identical to the body and the bite proof would report 'the mutation removed nothing' about a
 * contract that is perfectly intact, while the contract's own assertion stayed correctly green. The
 * direction is safe (a false RED, never a false green), but the next person to comment that UPDATE
 * would be sent looking for a bug that is not there.
 *
 * So the code runs are concatenated, each character remembering which segment it came from; the
 * match is deleted from that joined text and a single space left at its start; and the segments are
 * rebuilt from the survivors, with every comment put back untouched.
 */
function codeRemovedCommentsKept(body: string, code: RegExp): string {
  const segments = sqlSegments(body);
  const owner: number[] = []; // joined-text position -> index of the segment it came from
  let joined = '';
  segments.forEach((seg, s) => {
    if (!seg.code) return;
    joined += seg.text;
    for (let k = 0; k < seg.text.length; k += 1) owner.push(s);
  });

  // 0 = survives, 1 = inside a match, 2 = first character of a match (becomes the single space).
  const cut = new Uint8Array(joined.length);
  for (const m of joined.matchAll(new RegExp(code.source, 'gi'))) {
    if (!m[0]) continue;
    const start = m.index ?? 0;
    for (let k = start; k < start + m[0].length; k += 1) cut[k] = 1;
    cut[start] = 2;
  }

  const rebuilt = new Map<number, string>();
  for (let i = 0; i < joined.length; i += 1) {
    const s = owner[i]!;
    const kept = cut[i] === 2 ? ' ' : cut[i] === 1 ? '' : joined[i]!;
    rebuilt.set(s, (rebuilt.get(s) ?? '') + kept);
  }

  return segments.map((seg, s) => (seg.code ? (rebuilt.get(s) ?? '') : seg.text)).join('');
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

  /**
   * A COMMENT INSIDE A CONTRACT'S SPAN MUST NOT BREAK THE MUTATION.
   *
   * Several contracts here pin a RANGE rather than a token — api_erase_user's runs from
   * `update quotes set` all the way to `intro_note = null` — and a maintainer is free to annotate any
   * line in between. That comment splits the span across two code SEGMENTS. The real assertion is
   * unaffected (executableSql joins the code back together before matching), but a mutation applied
   * per segment would then match neither half, hand back a copy identical to the body, and fail the
   * bite proof with 'the mutation removed nothing' — which reads as "your contract regex is broken"
   * about a contract that is perfectly intact.
   *
   * So this inserts exactly that comment into a COPY of the resolved body and pins both halves:
   * the contract still holds, and the bite proof still bites.
   */
  it('still guts a contract whose span a maintainer has commented in the middle of', () => {
    const contract = CONTRACTS.find((c) => c.fn === 'api_erase_user');
    expect(contract, 'the ranged contract this case is written about is gone').toBeDefined();
    const body = bodies.get('api_erase_user');
    expect(body, 'api_erase_user is not defined at all').toBeDefined();

    // A `--` between `set` and `intro_note = null`: the plainest edit a maintainer could make to the
    // retained-quote anonymize UPDATE. Anchored from `update quotes` on purpose — the RETAINED-BOOKING
    // anonymize a few lines above nulls a `customer_phone` too, and commenting that one would prove
    // nothing about this contract's span.
    const commented = (body as string).replace(
      /(update\s+quotes\b[\s\S]*?customer_phone\s*=\s*null,)/i,
      '$1 -- the phone, which the redact trigger does not reach\n',
    );
    expect(
      commented,
      'the anonymize UPDATE no longer has the line this case comments — re-anchor it',
    ).not.toBe(body);

    // 1. The contract itself is untouched: a comment does not run, so nothing it interrupts stopped
    //    running either.
    expect(() => assertContract(commented, contract!)).not.toThrow();

    // 2. And the bite proof still bites: the statement really is deleted, the comments really do
    //    survive, and the contract really does go red on the mutant.
    const gutted = codeRemovedCommentsKept(commented, contract!.code);
    expect(
      gutted,
      'the mutation removed nothing — a comment inside the span defeated it, so the bite proof for ' +
        'this contract would fail for a reason that has nothing to do with the contract',
    ).not.toBe(commented);
    expect(() => assertContract(gutted, contract!)).toThrow();
    expect(gutted, "the mutation ate the body's comments as well as its code").toContain(
      'the phone, which the redact trigger does not reach',
    );
  });
});
