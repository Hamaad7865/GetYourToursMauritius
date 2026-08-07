import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';
import { pgliteServiceRoleRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { hashQuoteToken } from '@/lib/quotes/token';
import { resolveQuoteForToken } from '@/lib/quotes/resolve';
import { SITE } from '@/lib/seo/site';
import type { NotificationMessage } from '@/lib/notifications/types';

/**
 * POST /api/v1/admin/quotes/send — the operator's Send button, against the REAL schema
 * (20260909000000).
 *
 * This route is the only thing that ever writes `quotes.token_hash`, so it is the only thing that can
 * turn a draft into an offer a guest can open and pay. Everything asserted here is one of the two
 * halves of that:
 *
 *  - WHAT MUST NOT BE SENT. A quote whose validity has passed, one with no lines, a zero total or a
 *    NEGATIVE total, one that was withdrawn, and one the guest has already accepted. Each of those is
 *    an email nobody can act on, and an email cannot be recalled — so the refusals are also asserted
 *    to write NOTHING: no token, no status change, no `sent_at`. A quote carrying a CATALOGUE line
 *    used to be on this list, while api_convert_quote had no way to reserve the seat; it now converts
 *    and is asserted below to send, holding no capacity until the guest actually pays.
 *  - WHAT THE RAW TOKEN MAY TOUCH. It is minted here, hashed into `quotes.token_hash`, put in the
 *    guest's emailed URL and returned once to the operator. Nowhere else — the stored column is
 *    asserted to be the SHA-256 and never the token, and the guest's email is asserted to be the only
 *    place it is written down.
 *
 * RE-SEND ROTATES THE TOKEN, and that is a decision, not an accident: `quotes.token_hash` holds ONE
 * hash, so a second send necessarily invalidates the first link. The test named for it pins both
 * halves — the new link opens the quote, the old one no longer does.
 *
 * `requireUser` is faked (the JWT itself is covered by tests/unit/auth-jwt.test.ts); the STAFF check
 * is not. It runs against real `profiles` rows, because the trap it exists to avoid — reading the
 * JWT's `role` claim, which is the Postgres role selector `authenticated`, as if it were the app's
 * business role — cannot be caught by a mock that hands back a business role nobody uses.
 */

const ADMIN = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const STAFF = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
const CUSTOMER = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';
const SEO = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
const NO_PROFILE = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';

const hoisted = vi.hoisted(() => ({
  shim: null as SupabaseShim | null,
  /** Bearer token -> auth user id. A token that is not in here is rejected, like a bad JWT. */
  users: new Map<string, string>(),
  /** Every message handed to the notification provider, in order. */
  sent: [] as NotificationMessage[],
  /** Set to make the provider throw, so the email-failed path can be exercised. */
  sendError: null as Error | null,
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

vi.mock('@/lib/http/auth', async () => {
  const { UnauthorizedError } = await import('@/lib/services/errors');
  return {
    requireUser: async (req: Request) => {
      const header = req.headers.get('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      const id = hoisted.users.get(token);
      if (!id) throw new UnauthorizedError();
      // `role` is what a real Supabase JWT carries: the POSTGRES role selector, never the app's
      // business role. A staff gate written against this value admits every signed-in customer.
      return { id, email: 'staff@example.com', role: 'authenticated' };
    },
  };
});

vi.mock('@/lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications')>();
  return {
    ...actual,
    getNotificationProvider: () => ({
      name: 'test',
      send: async (message: NotificationMessage) => {
        if (hoisted.sendError) throw hoisted.sendError;
        hoisted.sent.push(message);
      },
    }),
  };
});

const { POST } = await import('../../app/api/v1/admin/quotes/send/route');

interface SeedLine {
  kind: 'custom' | 'catalogue' | 'rental';
  description?: string;
  priceLabel?: string;
  option?: { optionId: string; occurrenceId: string };
  quantity: number;
  unitAmountMinor: number;
}

interface SeededQuote {
  id: string;
  ref: string;
  email: string;
}

interface QuoteRow {
  status: string;
  token_hash: string | null;
  sent_at: string | null;
}

describe('POST /api/v1/admin/quotes/send', () => {
  let db: TestDb;
  let operatorId: string;
  let seq = 0;

  async function send(quoteId: unknown, bearer: string | null = 'admin-token'): Promise<Response> {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (bearer) headers.set('authorization', `Bearer ${bearer}`);
    return POST(
      new Request('https://x/api/v1/admin/quotes/send', {
        method: 'POST',
        headers,
        body: JSON.stringify({ quoteId }),
      }),
    );
  }

  /** A catalogue option nobody else's test touches: one price tier, one future occurrence. */
  async function seedOption(): Promise<{ optionId: string; occurrenceId: string }> {
    seq += 1;
    const activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, $2, 'activity', 'Quote Send Tour', 'Sightseeing tours', 'published')
         returning id`,
        [operatorId, `quote-send-tour-${seq}`],
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
       values ($1, 'Adult', 7500, null)`,
      [optionId],
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
      lines?: SeedLine[];
      totalMinor?: number;
      internalNotes?: string | null;
      converted?: boolean;
      locale?: 'en' | 'fr';
    } = {},
  ): Promise<SeededQuote> {
    seq += 1;
    const ref = `QSEND${seq}`;
    const email = `marie${seq}@example.com`;
    const validUntil = new Date(Date.now() + (input.validUntilDays ?? 7) * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const lines = input.lines ?? [
      {
        kind: 'custom' as const,
        description: 'Private guide, full day',
        quantity: 2,
        unitAmountMinor: 6_000,
      },
    ];
    const total =
      input.totalMinor ?? lines.reduce((sum, l) => sum + l.quantity * l.unitAmountMinor, 0);

    const { rows } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, customer_phone, status, valid_until,
                           total_minor, intro_note, internal_notes, locale)
       values ($1, 'Marie Dupont', $2, '+230 5555 1234', $3::quote_status, $4::date, $5,
               'As discussed on the phone.', $6, $7::content_locale)
       returning id`,
      [
        ref,
        email,
        input.status ?? 'draft',
        validUntil,
        total,
        input.internalNotes ?? 'Margin is thin — do not discount further.',
        input.locale ?? 'en',
      ],
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

    if (input.converted) {
      const bookingId = (
        await db.pg.query<{ id: string }>(
          `insert into bookings (customer_name, customer_email, status, source, currency, total_minor,
                                 operator_payout_minor, payment_state)
           values ('Marie Dupont', $1, 'payment_pending', 'quote', 'EUR', $2, $2, 'pending')
           returning id`,
          [email, total],
        )
      ).rows[0]!.id;
      await db.pg.query(
        `update quotes set booking_id = $2, converted_at = now(), status = 'accepted' where id = $1`,
        [id, bookingId],
      );
    }
    return { id, ref, email };
  }

  async function readQuote(id: string): Promise<QuoteRow> {
    const { rows } = await db.pg.query<QuoteRow>(
      `select status::text as status, token_hash, sent_at::text as sent_at from quotes where id = $1`,
      [id],
    );
    return rows[0]!;
  }

  /** The raw token out of the URL the route handed back. */
  function tokenOf(url: string): string {
    return new URL(url).searchParams.get('t') ?? '';
  }

  beforeAll(async () => {
    db = await createTestDb();
    hoisted.shim = makeSupabaseShim(db.pg);
    await db.asOwner();

    await db.pg.query(`insert into operators (name, slug) values ('Belle Mare Tours', 'bmt-send')`);
    operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`)).rows[0]!
      .id;

    await db.pg.query(`insert into auth.users (id) values ($1), ($2), ($3), ($4), ($5)`, [
      ADMIN,
      STAFF,
      CUSTOMER,
      SEO,
      NO_PROFILE,
    ]);
    await db.pg.query(
      `insert into profiles (id, full_name, role)
       values ($1, 'Owner', 'admin'), ($2, 'Guide', 'staff'), ($3, 'Guest', 'customer'),
              ($4, 'SEO hire', 'seo')`,
      [ADMIN, STAFF, CUSTOMER, SEO],
    );
    hoisted.users.set('admin-token', ADMIN);
    hoisted.users.set('staff-token', STAFF);
    hoisted.users.set('customer-token', CUSTOMER);
    hoisted.users.set('seo-token', SEO);
    hoisted.users.set('no-profile-token', NO_PROFILE);

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
    hoisted.sent.length = 0;
    hoisted.sendError = null;
  });

  // ── The staff gate ────────────────────────────────────────────────────────
  it('refuses a caller with no bearer token', async () => {
    const quote = await seedQuote();
    const res = await send(quote.id, null);
    expect(res.status).toBe(401);
    expect(hoisted.sent).toHaveLength(0);
    expect((await readQuote(quote.id)).token_hash).toBeNull();
  });

  it('refuses a signed-in customer — the JWT role claim is not the business role', async () => {
    // THE TRAP: `requireUser().role` is 'authenticated' for staff and customer alike, so a gate
    // written against it would let this through and email a stranger's quote to its guest.
    const quote = await seedQuote();
    const res = await send(quote.id, 'customer-token');
    expect(res.status).toBe(403);
    expect(hoisted.sent).toHaveLength(0);
    expect((await readQuote(quote.id)).token_hash).toBeNull();
  });

  it('refuses a signed-in user with no profile row at all', async () => {
    const quote = await seedQuote();
    expect((await send(quote.id, 'no-profile-token')).status).toBe(403);
    expect(hoisted.sent).toHaveLength(0);
  });

  it('refuses the SEO hire — a quote carries the guest’s name, email and price', async () => {
    const quote = await seedQuote();
    expect((await send(quote.id, 'seo-token')).status).toBe(403);
    expect(hoisted.sent).toHaveLength(0);
  });

  it('admits a staff account, not only an admin', async () => {
    const quote = await seedQuote();
    expect((await send(quote.id, 'staff-token')).status).toBe(200);
    expect(hoisted.sent).toHaveLength(1);
  });

  it('answers 404 for a quote that does not exist', async () => {
    const res = await send('11111111-2222-3333-4444-555555555555');
    expect(res.status).toBe(404);
    expect(hoisted.sent).toHaveLength(0);
  });

  // ── The send itself ───────────────────────────────────────────────────────
  it('mints a link, stores only its hash, marks the quote sent and emails the guest', async () => {
    const quote = await seedQuote();

    const res = await send(quote.id);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // The operator's copy button gets the OPEN route, never `/quotes/{ref}?t=…` — see
    // src/lib/quotes/link-cookie.ts for why a raw token must never reach a rendered page's URL.
    const token = tokenOf(body.data.url);
    expect(body.data.url).toBe(`${SITE.url}/api/v1/quotes/${quote.ref}/open?t=${token}`);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const row = await readQuote(quote.id);
    expect(row.status).toBe('sent');
    expect(row.sent_at).not.toBeNull();
    // ONLY the hash is persisted. A database read (or a leaked backup) cannot mint a working link.
    expect(row.token_hash).toBe(await hashQuoteToken(token));
    expect(row.token_hash).not.toBe(token);

    // …and the link the guest was emailed actually opens the quote.
    expect(await resolveQuoteForToken(quote.ref, token)).not.toBeNull();

    expect(hoisted.sent).toHaveLength(1);
    const email = hoisted.sent[0]!;
    expect(email.channel).toBe('email');
    expect(email.recipient).toBe(quote.email);
    expect(email.subject).toContain(quote.ref);
    expect(email.html).toContain(body.data.url);
    expect(email.text).toContain(body.data.url);
    // The itemised offer, at the figure the card will be charged.
    expect(email.text).toContain('Private guide, full day');
    expect(email.text).toContain('EUR 120.00');
  });

  it('never writes the raw token anywhere but the guest’s email', async () => {
    const quote = await seedQuote();
    const body = await (await send(quote.id)).json();
    const token = tokenOf(body.data.url);

    // Every text-ish column of the row, as one blob: the token must appear in none of them.
    const { rows } = await db.pg.query<{ blob: string }>(
      `select coalesce(ref,'') || coalesce(customer_name,'') || coalesce(customer_email,'')
              || coalesce(intro_note,'') || coalesce(internal_notes,'') || coalesce(token_hash,'')
              as blob
         from quotes where id = $1`,
      [quote.id],
    );
    expect(rows[0]!.blob).not.toContain(token);
    // The outbound message carries no payload copy of it either — nothing a provider could log.
    expect(JSON.stringify(hoisted.sent[0]!.payload)).not.toContain(token);
  });

  it('keeps the staff-only internal note out of the guest’s email', async () => {
    const quote = await seedQuote({ internalNotes: 'Margin is thin — do not discount further.' });
    await send(quote.id);
    const email = hoisted.sent[0]!;
    expect(`${email.subject}${email.text}${email.html}`).not.toContain('Margin is thin');
    // The note the operator wrote FOR the guest is a different column, and it does go out.
    expect(email.text).toContain('As discussed on the phone.');
  });

  it('emails a French quote in French, and leaves an English one in English', async () => {
    // `quotes.locale` is the language the operator drafted the offer in, and api_convert_quote copies
    // it into `bookings.locale` — where it already picks the language of the confirmation email and
    // the VAT invoice. The column has to be SELECTED here and handed to the renderer, or a French
    // guest reads an English offer and then, one payment later, receives French paperwork about it.
    const fr = await seedQuote({ locale: 'fr' });
    expect((await send(fr.id)).status).toBe(200);
    const french = hoisted.sent[0]!;
    expect(french.subject, 'the send route never read quotes.locale').toContain('Votre devis');
    expect(french.text).toContain('Voici le devis que vous nous avez demandé');
    expect(french.html).toContain('Voir et payer votre devis');

    hoisted.sent.length = 0;
    const en = await seedQuote({ locale: 'en' });
    expect((await send(en.id)).status).toBe(200);
    const english = hoisted.sent[0]!;
    expect(english.subject).not.toContain('devis');
    expect(english.text).toContain('Here is the quote you asked us for');
  });

  it('sends the quote FROM the monitored info@ inbox, not the send-only bookings@ identity', async () => {
    // Phase D. RESEND_FROM (bookings@) is a send-only identity nobody reads and carries every
    // confirmation/refund/invoice; a QUOTE is different — a guest reading a priced offer should be
    // able to hit Reply and reach a person. So the quote_sent message overrides `from` to info@
    // (SITE.email) per-message, leaving RESEND_FROM — and thus every other template — untouched.
    const quote = await seedQuote();
    expect((await send(quote.id)).status).toBe(200);
    expect(hoisted.sent).toHaveLength(1);
    expect(hoisted.sent[0]!.from).toBe(SITE.email);
  });

  it('honours QUOTE_FROM as the quote sender when it is set', async () => {
    // The optional override for a future re-point of the quote sender, without moving RESEND_FROM.
    const { resetServerEnvCache } = await import('@/lib/config/env');
    const previous = process.env.QUOTE_FROM;
    process.env.QUOTE_FROM = 'quotes@bellemaretours.com';
    resetServerEnvCache();
    try {
      const quote = await seedQuote();
      expect((await send(quote.id)).status).toBe(200);
      expect(hoisted.sent[0]!.from).toBe('quotes@bellemaretours.com');
    } finally {
      if (previous === undefined) delete process.env.QUOTE_FROM;
      else process.env.QUOTE_FROM = previous;
      resetServerEnvCache();
    }
  });

  // ── What must not be sent ─────────────────────────────────────────────────
  it('refuses a quote whose validity has already passed', async () => {
    const quote = await seedQuote({ validUntilDays: -1 });
    const res = await send(quote.id);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain(quote.ref);
    expect(body.error.message).toMatch(/valid until/i);
    expect(hoisted.sent).toHaveLength(0);
    const row = await readQuote(quote.id);
    expect(row.token_hash).toBeNull();
    expect(row.status).toBe('draft');
  });

  it('SENDS a quote carrying a catalogue line — the seat is reserved when the guest pays', async () => {
    // This route used to refuse one, because api_convert_quote could not convert it: the hold path
    // that reserves the seat was unbuilt, so the email would have carried a priced offer whose Pay
    // button could only say "message us". The conversion now takes the hold and writes the
    // booking_items row in the transaction that mints the booking, so a quote of real tours — the
    // module's motivating case — is exactly what this route is for.
    const option = await seedOption();
    const quote = await seedQuote({
      lines: [
        { kind: 'catalogue', priceLabel: 'Adult', option, quantity: 2, unitAmountMinor: 7500 },
      ],
    });

    const res = await send(quote.id);

    expect(res.status).toBe(200);
    expect(hoisted.sent).toHaveLength(1);
    // A catalogue line has no free-text description, so the guest reads its TIER — the same
    // substitution api_convert_quote makes when it writes the booking_items row.
    expect(hoisted.sent[0]!.html).toContain('Adult');
    expect(hoisted.sent[0]!.html).toContain('150.00');
    const row = await readQuote(quote.id);
    expect(row.status).toBe('sent');
    expect(
      row.token_hash,
      'the guest was emailed a link with no hash stored behind it',
    ).not.toBeNull();
  });

  it('does NOT pre-empt the seat: sending reserves nothing, paying does', async () => {
    // An offer is not a booking. Holding capacity at send time would let one drafted quote sit on a
    // departure's last seats for as long as the operator left it unsent-and-unpaid, and the answer
    // would be stale by the time the guest read the email anyway — the only availability check worth
    // trusting is the one create_hold takes under the occurrence's own lock as the payment is made.
    const option = await seedOption();
    const quote = await seedQuote({
      lines: [
        { kind: 'catalogue', priceLabel: 'Adult', option, quantity: 2, unitAmountMinor: 7500 },
      ],
    });

    expect((await send(quote.id)).status).toBe(200);

    const { rows } = await db.pg.query<{ used: number }>(`select used_capacity($1)::int as used`, [
      option.occurrenceId,
    ]);
    expect(rows[0]!.used, 'sending a quote reserved capacity').toBe(0);
  });

  it('refuses a quote with no lines behind its total', async () => {
    const quote = await seedQuote({ lines: [], totalMinor: 12_000 });
    const res = await send(quote.id);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/no lines|nothing itemised/i);
    expect(hoisted.sent).toHaveLength(0);
    expect((await readQuote(quote.id)).token_hash).toBeNull();
  });

  it('refuses a zero total', async () => {
    const quote = await seedQuote({
      lines: [{ kind: 'custom', description: 'Goodwill upgrade', quantity: 1, unitAmountMinor: 0 }],
    });
    const res = await send(quote.id);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/nothing to charge|zero/i);
    expect(hoisted.sent).toHaveLength(0);
    expect((await readQuote(quote.id)).token_hash).toBeNull();
  });

  it('refuses a NEGATIVE total', async () => {
    // `quotes.total_minor` carries no `>= 0` CHECK, so this is representable; api_convert_quote reads
    // it as `<= 0` and refuses, and a card cannot be charged a negative figure anyway.
    const quote = await seedQuote({ totalMinor: -12_000 });
    const res = await send(quote.id);
    expect(res.status).toBe(400);
    expect((await res.json()).error.message).toMatch(/negative/i);
    expect(hoisted.sent).toHaveLength(0);
    expect((await readQuote(quote.id)).token_hash).toBeNull();
  });

  it('refuses a total that has drifted from its lines', async () => {
    const quote = await seedQuote({ totalMinor: 50_000 });
    const res = await send(quote.id);
    expect(res.status).toBe(400);
    expect(hoisted.sent).toHaveLength(0);
    expect((await readQuote(quote.id)).token_hash).toBeNull();
  });

  it('refuses a withdrawn quote — its public page would 404', async () => {
    const quote = await seedQuote({ status: 'cancelled' });
    const res = await send(quote.id);
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toMatch(/withdrawn|cancelled/i);
    expect(hoisted.sent).toHaveLength(0);
    expect((await readQuote(quote.id)).token_hash).toBeNull();
  });

  it('refuses a quote the guest has already accepted', async () => {
    // Re-sending would rotate the token under a guest who may be at the card form right now, and
    // rewrite `accepted` back to `sent`.
    const quote = await seedQuote({ converted: true });
    const res = await send(quote.id);
    expect(res.status).toBe(409);
    expect(hoisted.sent).toHaveLength(0);
    const row = await readQuote(quote.id);
    expect(row.status).toBe('accepted');
    expect(row.token_hash).toBeNull();
  });

  // ── Re-send ───────────────────────────────────────────────────────────────
  it('re-send mints a NEW link and kills the old one', async () => {
    const quote = await seedQuote();
    const first = tokenOf((await (await send(quote.id)).json()).data.url);
    const firstSentAt = (await readQuote(quote.id)).sent_at;

    const second = tokenOf((await (await send(quote.id)).json()).data.url);

    expect(second).not.toBe(first);
    expect(hoisted.sent).toHaveLength(2);
    // `quotes.token_hash` holds ONE hash, so the newest email is the live one and every earlier link
    // stops working. Decided, not incidental — a forwarded old link must not outlive a re-price.
    expect(await resolveQuoteForToken(quote.ref, second)).not.toBeNull();
    expect(await resolveQuoteForToken(quote.ref, first)).toBeNull();
    const row = await readQuote(quote.id);
    expect(row.token_hash).toBe(await hashQuoteToken(second));
    expect(row.sent_at).not.toBe(firstSentAt);
  });

  it('a failed email leaves no link the guest could be holding, and re-sending fixes it', async () => {
    const quote = await seedQuote();
    hoisted.sendError = new Error('resend is down');

    const res = await send(quote.id);
    expect(res.status).toBe(500);
    expect(hoisted.sent).toHaveLength(0);
    // The token WAS written before the send — deliberately, because the opposite order emails a link
    // that cannot be opened. Nobody holds this one, and the quote reads `sent` with no email behind
    // it, which is what the operator's error toast is for.
    expect((await readQuote(quote.id)).token_hash).not.toBeNull();

    hoisted.sendError = null;
    const retry = await send(quote.id);
    expect(retry.status).toBe(200);
    const token = tokenOf((await retry.json()).data.url);
    expect(hoisted.sent).toHaveLength(1);
    expect(await resolveQuoteForToken(quote.ref, token)).not.toBeNull();
  });

  it('rejects a body that is not a quote id', async () => {
    expect((await send('not-a-uuid')).status).toBe(400);
    expect(hoisted.sent).toHaveLength(0);
  });
});
