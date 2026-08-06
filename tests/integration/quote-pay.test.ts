import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';
import { pgliteServiceRoleRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { hashQuoteToken, mintQuoteToken } from '@/lib/quotes/token';
import { QUOTE_TOKEN_COOKIE } from '@/lib/quotes/link-cookie';
import { SITE } from '@/lib/seo/site';
import type { CreatePaymentLinkInput } from '@/lib/services/payments';

/**
 * POST /api/v1/quotes/{ref}/pay — the guest's "Accept & pay", against the REAL schema
 * (20260909000000) and the REAL api_convert_quote.
 *
 * The route is authenticated by the LINK TOKEN, not by `requireUser`: the guest has no account, which
 * is the whole point of an emailed quote. The token arrives in the httpOnly cookie that
 * GET /api/v1/quotes/{ref}/open set (src/lib/quotes/link-cookie.ts), never in the body — so these
 * tests send it exactly as the browser does, in a `Cookie` header.
 *
 * What is asserted here is the ROUTE's half of the money path:
 *   - every refusal to open the quote is the SAME 404, so the endpoint is not an oracle for which
 *     quote refs exist (the ref is the path segment of a link that gets forwarded);
 *   - a second call REUSES the booking the first one minted instead of converting again;
 *   - the checkout is minted through `createPaymentLink`, with the QUOTE's return URL;
 *   - and the catalogue re-price gate: if a catalogue line's price has moved since the offer was
 *     sent, the guest is refused with a 409 rather than charged a figure they never agreed to.
 *
 * TWO TESTS AT THE END RECORD GAPS, THEY DO NOT SPECIFY BEHAVIOUR. Both are named KNOWN GAP / KNOWN
 * BLOCKER, both carry the commit that should delete them, and both are refusals the module is meant to
 * stop making: a quote carrying a scheduled activity cannot convert (the hold path Task 8 was
 * specified to add is not built), and an ownerless quote booking cannot actually be charged
 * (api_create_payment's authz guard). Each needs a money-path migration, so each has been raised for
 * sign-off rather than written unilaterally. Read them as a to-do list, not as the answer.
 *
 * `createPaymentLink` is faked for those tests, deliberately. Its own guarantee — that one booking can
 * never have two payable Peach sessions — is enforced by api_create_payment's single-flight lease and
 * is tested against the real database in tests/integration/payment-checkout-lease.test.ts. What this
 * file must prove is that the ROUTE cannot break that invariant from above, by minting a SECOND
 * BOOKING for one quote; the fake returns a checkout id derived from the booking ref so a second
 * booking would be visible as a second checkout id. The last test in the file runs the REAL
 * `createPaymentLink` and records where the money path currently stops.
 *
 * The PGlite session stays as the OWNER while the route runs. The harness's auth shim replicates
 * Supabase's stock default privileges for FUNCTIONS only (see tests/db/auth-shim.sql), so `bookings`
 * and `activity_option_prices` — which a real service-role client reads freely — carry no service_role
 * table grant here. The owner session is the faithful stand-in for a client that bypasses RLS; the
 * RPCs still run as service_role through `pgliteServiceRoleRpc`, which is where identity matters.
 */

const hoisted = vi.hoisted(() => ({
  shim: null as SupabaseShim | null,
  /** Every `createPaymentLink` input the route produced, in order. */
  calls: [] as CreatePaymentLinkInput[],
  /** false → the REAL createPaymentLink runs (the blocker test at the end). */
  fakeLink: true,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => {
    if (!hoisted.shim) throw new Error('shim not initialised');
    return hoisted.shim;
  },
}));

vi.mock('@/lib/http/context', async () => {
  const mod = await import('../db/route-context');
  return {
    buildServiceContext: () => mod.requireRouteContext(),
    serviceRoleRpcContext: () => mod.requireRouteContext(),
  };
});

vi.mock('@/lib/services/payments', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/services/payments')>();
  return {
    ...actual,
    createPaymentLink: async (
      ctx: Parameters<typeof actual.createPaymentLink>[0],
      input: CreatePaymentLinkInput,
      adminCtx: Parameters<typeof actual.createPaymentLink>[2],
    ) => {
      hoisted.calls.push(input);
      if (!hoisted.fakeLink) return actual.createPaymentLink(ctx, input, adminCtx);
      return {
        sessionId: `sess_${input.bookingRef}`,
        // Derived from the booking ref: two different bookings can never share a checkout id, so
        // "the same checkout id twice" is exactly "the same booking twice".
        checkoutId: `chk_${input.bookingRef}`,
        provider: 'stub',
        chargeAmountMinor: 636_000,
        chargeCurrency: 'MUR',
      };
    },
  };
});

const { POST } = await import('../../app/api/v1/quotes/[ref]/pay/route');

interface SeededQuote {
  id: string;
  ref: string;
  token: string;
  /** Unique per quote, so a second booking minted for it is countable. */
  email: string;
}

/** A freshly created activity option with one price tier and one future occurrence. */
interface SeededOption {
  optionId: string;
  occurrenceId: string;
}

interface SeedLine {
  kind: 'custom' | 'catalogue';
  description?: string;
  priceLabel?: string;
  option?: SeededOption;
  quantity: number;
  unitAmountMinor: number;
}

describe('POST /api/v1/quotes/{ref}/pay', () => {
  let db: TestDb;
  let operatorId: string;
  let seq = 0;

  /** The guest's request: a POST with no body, carrying the link cookie the browser attaches. */
  async function pay(ref: string, token?: string): Promise<Response> {
    const headers = new Headers();
    if (token !== undefined) headers.set('cookie', `${QUOTE_TOKEN_COOKIE}=${token}`);
    return POST(new Request(`https://x/api/v1/quotes/${ref}/pay`, { method: 'POST', headers }), {
      params: Promise.resolve({ ref }),
    });
  }

  /**
   * A catalogue option nobody else's test touches: one price tier, one future occurrence.
   *
   * Per test rather than per file on purpose — the re-price tests MOVE a price, and a shared fixture
   * would make them order-dependent (and silently so, since the gate's whole job is to notice a moved
   * price).
   */
  async function seedOption(label: string, amountMinor: number): Promise<SeededOption> {
    seq += 1;
    const activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, $2, 'activity', 'Quote Pay Tour', 'Sightseeing tours', 'published')
         returning id`,
        [operatorId, `quote-pay-tour-${seq}`],
      )
    ).rows[0]!.id;
    const optionId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Standard') returning id`,
        [activityId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests)
       values ($1, $2, $3, null)`,
      [optionId, label, amountMinor],
    );
    const occurrenceId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '10 days', now() + interval '10 days 4 hours', 20)
         returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;
    return { optionId, occurrenceId };
  }

  async function seedQuote(
    input: {
      status?: string;
      validUntilDays?: number;
      withToken?: boolean;
      lines?: SeedLine[];
      /** Override the stored total; defaults to the sum of the lines (what saveQuote writes). */
      totalMinor?: number;
    } = {},
  ): Promise<SeededQuote> {
    seq += 1;
    const ref = `QPAY${seq}`;
    const email = `marie${seq}@example.com`;
    const token = mintQuoteToken();
    const tokenHash = input.withToken === false ? null : await hashQuoteToken(token);
    const validUntil = new Date(Date.now() + (input.validUntilDays ?? 7) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const lines = input.lines ?? [
      {
        kind: 'custom' as const,
        description: 'Private guide, full day',
        quantity: 1,
        unitAmountMinor: 12_000,
      },
    ];
    const total =
      input.totalMinor ?? lines.reduce((sum, l) => sum + l.quantity * l.unitAmountMinor, 0);

    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, customer_phone, status, valid_until,
                           total_minor, intro_note, token_hash, sent_at)
       values ($1, 'Marie Dupont', $2, '+230 5555 1234', $3::quote_status, $4::date,
               $5, 'As discussed on the phone.', $6, now())
       returning id`,
      [ref, email, input.status ?? 'sent', validUntil, total, tokenHash],
    );
    const id = rows[0]!.id;

    for (const [position, line] of lines.entries()) {
      await db.pg.query(
        `insert into quote_items (quote_id, position, kind, session_occurrence_id, activity_option_id,
                                  price_label, description, quantity, unit_amount_minor, subtotal_minor)
         values ($1, $2, $3::quote_item_kind, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          position,
          line.kind,
          line.option?.occurrenceId ?? null,
          line.option?.optionId ?? null,
          line.priceLabel ?? null,
          line.description ?? null,
          line.quantity,
          line.unitAmountMinor,
          line.quantity * line.unitAmountMinor,
        ],
      );
    }
    return { id, ref, token, email };
  }

  /**
   * How many bookings this quote has ever minted — the number that must never reach two.
   *
   * Counted by the quote's own guest email rather than by `quotes.booking_id`, which holds one id by
   * definition and so could never show a second booking. api_convert_quote copies the email onto every
   * booking it mints, and each seeded quote gets its own address.
   */
  async function bookingCount(quote: SeededQuote): Promise<number> {
    const { rows } = await db.pg.query<{ n: number }>(
      `select count(*)::int as n from bookings where source = 'quote' and customer_email = $1`,
      [quote.email],
    );
    return rows[0]!.n;
  }

  beforeAll(async () => {
    db = await createTestDb();
    hoisted.shim = makeSupabaseShim(db.pg);
    await db.asOwner();

    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'bmt-quote')`,
    );
    operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`)).rows[0]!
      .id;

    setRouteContext({
      db: pgliteServiceRoleRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
    });
  });

  afterAll(async () => {
    setRouteContext(null);
    await db.close();
  });

  beforeEach(() => {
    hoisted.calls.length = 0;
    hoisted.fakeLink = true;
  });

  it('converts the quote once and hands back a checkout for the new booking', async () => {
    const quote = await seedQuote();

    const res = await pay(quote.ref, quote.token);

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.bookingRef).toMatch(/^BMT[0-9A-F]{13}$/);
    expect(body.data.checkoutId).toBe(`chk_${body.data.bookingRef}`);
    // The guest is told the MUR figure their card will be charged, so the pay page can state it.
    expect(body.data.chargeCurrency).toBe('MUR');

    const { rows } = await db.pg.query<{
      status: string;
      source: string;
      total_minor: string;
      converted_at: string | null;
    }>(
      `select b.status, b.source, b.total_minor, q.converted_at
         from quotes q join bookings b on b.id = q.booking_id where q.id = $1`,
      [quote.id],
    );
    expect(rows[0]!.status).toBe('payment_pending');
    expect(rows[0]!.source).toBe('quote');
    expect(Number(rows[0]!.total_minor)).toBe(12_000);
    expect(rows[0]!.converted_at).not.toBeNull();
  });

  it('returns the SAME checkout id when called twice — never a second payable booking', async () => {
    const quote = await seedQuote();

    const first = await pay(quote.ref, quote.token);
    const second = await pay(quote.ref, quote.token);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const a = (await first.json()).data;
    const b = (await second.json()).data;
    expect(b.bookingRef).toBe(a.bookingRef);
    expect(b.checkoutId).toBe(a.checkoutId);
    expect(await bookingCount(quote)).toBe(1);
    // Both calls went through createPaymentLink — the single-flight lease is what makes the second
    // one reuse the live Peach session, so the route must not route around it.
    expect(hoisted.calls).toHaveLength(2);
    expect(hoisted.calls[1]!.bookingRef).toBe(a.bookingRef);
  });

  it('sends Peach back to the QUOTE page, not to /bookings/{ref}', async () => {
    // This value becomes Peach's shopperResultUrl — where a card taking the redirect-based 3-D Secure
    // path returns the guest TOP-LEVEL. Left at /api/v1/payments' default, a quote guest is charged and
    // then shown "Sign in to view booking …", and they have no account. Absolute and same-origin are
    // both load-bearing: peach.ts derives the Origin header it sends from this URL.
    const quote = await seedQuote();

    await pay(quote.ref, quote.token);

    expect(hoisted.calls[0]!.returnUrl).toBe(`${SITE.url}/quotes/${quote.ref}`);
    expect(hoisted.calls[0]!.returnUrl).not.toContain('/bookings/');
  });

  it('answers 404 for a wrong token — never a 401 that would confirm the ref exists', async () => {
    const quote = await seedQuote();

    const res = await pay(quote.ref, 'f'.repeat(64));

    expect(res.status).toBe(404);
    expect(await bookingCount(quote)).toBe(0);
  });

  it('answers the same 404 when the link cookie has lapsed and nothing is sent', async () => {
    // The 2-hour cookie is shorter than a guest's attention: open the quote, talk it over at lunch,
    // come back to the still-rendered tab and click Pay with no credential attached. That 404 is what
    // startQuotePayment turns into "This quote link has timed out — open the link in your email again."
    const quote = await seedQuote();

    const res = await pay(quote.ref);

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('not_found');
  });

  it('answers 404 for a ref that does not exist at all', async () => {
    expect((await pay('QNOSUCHREF', 'f'.repeat(64))).status).toBe(404);
  });

  it('answers 404 for a withdrawn quote even with the right token', async () => {
    const quote = await seedQuote({ status: 'cancelled' });

    expect((await pay(quote.ref, quote.token)).status).toBe(404);
    expect(await bookingCount(quote)).toBe(0);
  });

  it('refuses with 409 when a catalogue line costs more today than it was quoted at', async () => {
    // THE KNOWN GAP in the plan's own self-review: a catalogue line is priced when the operator adds
    // it, and the catalogue can move before the guest pays. Charging quotes.total_minor anyway bills a
    // figure the guest never agreed to; silently re-pricing bills a figure they never SAW. Refuse.
    const option = await seedOption('Adult', 5500);
    const quote = await seedQuote({
      lines: [
        { kind: 'catalogue', priceLabel: 'Adult', option, quantity: 2, unitAmountMinor: 5500 },
      ],
    });
    await db.pg.query(
      `update activity_option_prices set amount_minor = 6000 where activity_option_id = $1`,
      [option.optionId],
    );

    const res = await pay(quote.ref, quote.token);

    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/price/i);
    expect(await bookingCount(quote)).toBe(0);
  });

  it('refuses with 409 when the quoted price tier no longer exists', async () => {
    // The other half of the same gap: the label was renamed or removed, so there is no current price
    // to compare against. Nothing proves the quoted figure still stands — fail closed.
    const option = await seedOption('Adult', 5500);
    const quote = await seedQuote({
      lines: [
        {
          kind: 'catalogue',
          priceLabel: 'Retired tier',
          option,
          quantity: 1,
          unitAmountMinor: 5500,
        },
      ],
    });

    const res = await pay(quote.ref, quote.token);

    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/price/i);
    expect(await bookingCount(quote)).toBe(0);
  });

  it('KNOWN GAP: a correctly-priced catalogue quote is refused — the hold path is not built', async () => {
    // THIS 409 IS NOT THE SPECIFIED ANSWER. It is a tracked gap, and the module's primary use case —
    // a tailor-made itinerary of tours — is on the wrong side of it.
    //
    // Two things are pinned here at once. The first is the positive control the re-price gate needs:
    // without it, "refuse on drift" is satisfied by refusing ALWAYS, so the refusal below must not be
    // the price message. The second is the gap. The conversion stops one step later, at
    // api_convert_quote's own `quote_has_catalogue_lines` guard (20260909000000), whose comment ends
    // "DELETE THIS GUARD IN THE TASK THAT ADDS THE HOLD PATH, not before". Task 8 was specified to add
    // it — take the hold against `session_occurrence_id` for each catalogue line, write the
    // `booking_items` row, drop the guard — and did not. Doing so deletes a guard from a money-path
    // SECURITY DEFINER function, so it is a migration, and it has been raised for sign-off rather than
    // written unilaterally.
    //
    // The refusal carries its OWN error code rather than the generic `conflict` (the precedent is
    // SoldOutError, for the same reason): the gap is then greppable, countable in error_logs, separable
    // by the page from a real price refusal, and the commit that deletes the guard has one symbol to
    // delete alongside it. DELETE THIS TEST in that commit and replace it with one asserting the seat
    // is actually held.
    //
    // While it stands it must fail CLOSED and leave nothing half-done: no booking minted, `converted_at`
    // unstamped, so the operator can still take this guest by hand and the same quote converts cleanly
    // the day the guard lifts.
    const option = await seedOption('Adult', 5500);
    const quote = await seedQuote({
      lines: [
        { kind: 'catalogue', priceLabel: 'Adult', option, quantity: 2, unitAmountMinor: 5500 },
      ],
    });

    const res = await pay(quote.ref, quote.token);

    expect(res.status).toBe(409);
    const { error } = await res.json();
    expect(error.code).toBe('quote_has_catalogue_lines');
    expect(error.message).toMatch(/scheduled activity/i);
    // Not the re-price refusal: the quoted figure still matches the catalogue to the cent.
    expect(error.message).not.toMatch(/price/i);

    expect(await bookingCount(quote)).toBe(0);
    const { rows } = await db.pg.query<{ booking_id: string | null; converted_at: string | null }>(
      `select booking_id, converted_at from quotes where id = $1`,
      [quote.id],
    );
    expect(rows[0]!.booking_id).toBeNull();
    expect(rows[0]!.converted_at).toBeNull();
  });

  it('KNOWN BLOCKER: the real createPaymentLink cannot pay an ownerless quote booking', async () => {
    // Run against the REAL payments service. api_create_payment ends its guard with
    //   if not (is_staff() or (auth.uid() is not null and v_booking.user_id = auth.uid()))
    // and a quote booking has NO user_id — the guest has no account — while the route calls as
    // service_role, for which auth.uid() is null. So the charge is refused: `forbidden` → 403.
    //
    // /api/v1/bookings states the same fact from the other side ("a guest booking could never be
    // paid"), which is why booking requires sign-in. Everything above this line is the route working
    // exactly as specified; the one thing standing between it and a paid quote is that SQL guard, and
    // relaxing it is a money-path migration on a function a parallel branch is also rewriting
    // (20260910000000). DELETE THIS TEST in the commit that lands that migration, and replace it with
    // one that asserts a checkout is minted.
    hoisted.fakeLink = false;
    const quote = await seedQuote();

    const res = await pay(quote.ref, quote.token);

    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('forbidden');
    // The conversion itself succeeded — the quote is converted and the booking exists, payable by
    // nobody until the guard moves.
    expect(await bookingCount(quote)).toBe(1);
  });
});
