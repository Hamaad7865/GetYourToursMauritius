import { describe, expect, it } from 'vitest';
import { startQuotePayment, type QuotePayOutcome } from '@/lib/quotes/pay-client';

/**
 * What the "Accept & pay" button on the public quote page actually does with the pay route's answer.
 *
 * Extracted from the component so the money-path behaviour is testable in this suite's `node`
 * environment (no DOM, no testing-library). The component keeps only the side effects the browser
 * owns: the sessionStorage charge handoff and `window.location.href`.
 *
 * Three properties, each of which the first cut of the button got wrong:
 *
 *  1. `checkout_pending` (409) is a RACE, not a failure. api_create_payment single-flights the Peach
 *     session behind a 90-second lease; while another request holds it the caller gets that code, and
 *     the winner records its session id within a second or two. Checkout.tsx and ResumePaymentButton
 *     both retry 3× at 1.5s. A button that reads only `error.message` shows the guest a hard failure
 *     for a two-tab race — and retrying by hand makes it worse, because api_convert_quote refuses to
 *     re-arm while `checkout_claimed_until > now()`, so the same refusal repeats for the life of the
 *     lease. This repo has already shipped one "an abandoned Peach widget made a booking unpayable
 *     forever" incident.
 *  2. `quote_already_converted` needs its own branch. It means a booking exists and has been paid or
 *     is being paid; "Sorry — we could not start this payment." is both alarming and wrong.
 *  3. The pinned MUR charge has to be handed forward. /bookings/{ref}/pay is the one screen where a
 *     card number is typed, so it is the one place the exact charged figure must be stated, and
 *     ChargeNotice reads it from the sessionStorage handoff the MINTING page writes.
 *
 * Plus the property the whole cookie redesign rests on: the request carries NO token. The link token
 * lives in an httpOnly cookie scoped to this ref, so it must never be put in a body a script can read.
 */

interface Attempt {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch stub that replays a queued list of `{ status, body }` answers, recording every call. */
function stubFetch(answers: { status: number; body: unknown }[], attempts: Attempt[]) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    attempts.push({ url: String(input), init });
    const answer = answers[Math.min(attempts.length - 1, answers.length - 1)]!;
    return new Response(JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  };
}

const okBody = {
  ok: true,
  data: {
    checkoutId: 'CID-123',
    bookingRef: 'BMT0123456789ABC',
    chargeCurrency: 'MUR',
    chargeAmountMinor: 1_150_000,
  },
};

const pendingBody = {
  ok: false,
  error: { code: 'checkout_pending', message: 'A checkout session is already being prepared' },
};

async function run(
  answers: { status: number; body: unknown }[],
  attempts: Attempt[] = [],
): Promise<{ outcome: QuotePayOutcome; attempts: Attempt[]; waits: number[] }> {
  const waits: number[] = [];
  const outcome = await startQuotePayment({
    quoteRef: 'Q0A1B2C3D4E5',
    fetchImpl: stubFetch(answers, attempts),
    sleep: async (ms) => {
      waits.push(ms);
    },
  });
  return { outcome, attempts, waits };
}

describe('quote pay flow', () => {
  it('sends no token — the httpOnly cookie is the credential', async () => {
    const { attempts } = await run([{ status: 200, body: okBody }]);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.url).toBe('/api/v1/quotes/Q0A1B2C3D4E5/pay');
    expect(attempts[0]!.init?.method).toBe('POST');
    // A token in the body would be a token a script on the page had to hold, which is the whole thing
    // the cookie exists to prevent.
    expect(String(attempts[0]!.init?.body ?? '')).not.toMatch(/token/i);
    expect(attempts[0]!.init?.credentials).toBe('same-origin');
  });

  it('hands the guest to the widget with the pinned charge and a return it can render', async () => {
    const { outcome } = await run([{ status: 200, body: okBody }]);

    expect(outcome.kind).toBe('checkout');
    if (outcome.kind !== 'checkout') throw new Error('unreachable');
    expect(outcome.bookingRef).toBe('BMT0123456789ABC');
    // The exact figure ChargeNotice states on the card screen.
    expect(outcome.charge).toEqual({ chargeCurrency: 'MUR', chargeAmountMinor: 1_150_000 });
    // Post-payment the guest must land somewhere they can actually see. /bookings/{ref} renders
    // "Sign in to view booking …" for a quote guest, who by definition has no account.
    expect(outcome.href).toBe(
      `/bookings/BMT0123456789ABC/pay?cid=CID-123&return=${encodeURIComponent('/quotes/Q0A1B2C3D4E5')}`,
    );
  });

  it('retries a checkout_pending race and uses the session the winner recorded', async () => {
    const { outcome, attempts, waits } = await run([
      { status: 409, body: pendingBody },
      { status: 409, body: pendingBody },
      { status: 200, body: okBody },
    ]);

    expect(attempts).toHaveLength(3);
    expect(waits).toEqual([1500, 1500]);
    expect(outcome.kind).toBe('checkout');
  });

  it('stops after three retries rather than hammering the lease', async () => {
    const { outcome, attempts } = await run([{ status: 409, body: pendingBody }]);

    expect(attempts).toHaveLength(4); // the first attempt plus three retries
    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') throw new Error('unreachable');
    expect(outcome.message).toContain('checkout session');
  });

  it('tells a guest who has already paid so, instead of a generic failure', async () => {
    const { outcome } = await run([
      {
        status: 409,
        body: {
          ok: false,
          error: {
            code: 'quote_already_converted',
            message: 'This quote has already been paid for or is being paid',
            details: { bookingRef: 'BMT9999999999XYZ' },
          },
        },
      },
    ]);

    expect(outcome.kind).toBe('converted');
    if (outcome.kind !== 'converted') throw new Error('unreachable');
    expect(outcome.bookingRef).toBe('BMT9999999999XYZ');
    expect(outcome.message).not.toMatch(/could not start/i);
  });

  it('names the quote email when the link has timed out, rather than echoing “Not found”', async () => {
    // The commonest refusal of the three, and the one the first cut had no branch for. Both link
    // cookies carry QUOTE_TOKEN_MAX_AGE_SECONDS = 2 hours, so a guest who opens the quote, discusses
    // it over lunch and comes back to the still-rendered tab clicks Accept & pay with no credential.
    // The pay route answers 404 (never a distinguishable 401 — the ref must not become an existence
    // oracle), whose message is the framework's own 'Not found'. Rendered verbatim in red under the
    // button, that names nothing the guest can do; the one action that recovers it is reopening the
    // emailed link, and the page says so nowhere.
    const { outcome } = await run([
      { status: 404, body: { ok: false, error: { code: 'not_found', message: 'Not found' } } },
    ]);

    expect(outcome.kind).toBe('error');
    if (outcome.kind !== 'error') throw new Error('unreachable');
    expect(outcome.message).not.toMatch(/^Not found\.?$/i);
    expect(outcome.message, 'the guest is not told to reopen the emailed link').toMatch(/email/i);
  });

  it('follows a hosted redirect when there is no embedded session', async () => {
    const { outcome } = await run([
      { status: 200, body: { ok: true, data: { redirectUrl: 'https://pay.example/abc' } } },
    ]);

    expect(outcome).toEqual({ kind: 'redirect', href: 'https://pay.example/abc' });
  });

  it('keeps the server’s message for any other refusal', async () => {
    const { outcome } = await run([
      {
        status: 409,
        body: { ok: false, error: { code: 'conflict', message: 'This quote has been withdrawn.' } },
      },
    ]);

    expect(outcome).toEqual({ kind: 'error', message: 'This quote has been withdrawn.' });
  });

  it('does not treat an unparseable answer as success', async () => {
    const outcome = await startQuotePayment({
      quoteRef: 'Q0A1B2C3D4E5',
      fetchImpl: async () => new Response('<html>gateway</html>', { status: 502 }),
      sleep: async () => {},
    });

    expect(outcome.kind).toBe('error');
  });
});
