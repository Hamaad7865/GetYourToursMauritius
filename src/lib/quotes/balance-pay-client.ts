import { quoteBalancePagePath } from './link-cookie';

/**
 * The browser-side half of "Pay balance" on the durable balance page: one POST to
 * /api/v1/quotes/{ref}/balance/pay, and the decision about what its answer means.
 *
 * The balance's analogue of {@link import('./pay-client').startQuotePayment}, and simpler: there is no
 * conversion, so no "already converted" outcome — the deposit already minted and confirmed the booking.
 * Kept out of the component so the money-path behaviour is testable in a `node` environment with no
 * DOM.
 *
 * NO TOKEN IN THE REQUEST. The balance link token lives in an httpOnly cookie scoped to
 * /api/v1/quotes/{ref}/balance (see link-cookie.ts), so the browser attaches it and no script ever
 * holds it. `credentials: 'same-origin'` is therefore load-bearing, not decoration.
 */

/** Exactly what the pay route hands back on success; see src/lib/services/payments.ts. */
export interface BalanceChargeHandoff {
  chargeCurrency: string;
  chargeAmountMinor: number;
}

export type BalancePayOutcome =
  /** An embedded Peach session: navigate to `href`, disclosing `charge` on the way. */
  | {
      kind: 'checkout';
      bookingRef: string;
      checkoutId: string;
      href: string;
      charge?: BalanceChargeHandoff;
    }
  /** A hosted redirect (and the dev stub) — the second shape `paymentLinkSchema` documents. */
  | { kind: 'redirect'; href: string }
  | { kind: 'error'; message: string };

interface PayBody {
  ok?: boolean;
  data?: {
    checkoutId?: string;
    bookingRef?: string;
    redirectUrl?: string;
    chargeCurrency?: string;
    chargeAmountMinor?: number;
  };
  error?: { code?: string; message?: string };
}

const GENERIC = 'Sorry — we could not start this payment.';

/**
 * The likeliest refusal, and the only one with a remedy the guest can act on. The balance cookie lives
 * two hours, so a guest who opens the link, talks it over and comes back to a stale tab clicks with no
 * credential attached. The route answers 404 — deliberately, and NOT a distinguishable 401, because
 * `quotes.ref` is the path segment of a forwarded link and a per-case status would make the page an
 * existence oracle — so this is shown verbatim, while the fix is one click away in the link the guest
 * already has.
 */
const LINK_TIMED_OUT = 'This balance link has timed out. Please open the link we sent you again.';

/** Matches Checkout.tsx and the deposit pay client: three retries, 1.5s apart. */
const PENDING_RETRIES = 3;
const PENDING_WAIT_MS = 1500;

export interface StartBalancePaymentOptions {
  quoteRef: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export async function startBalancePayment({
  quoteRef,
  fetchImpl,
  sleep,
}: StartBalancePaymentOptions): Promise<BalancePayOutcome> {
  const doFetch = fetchImpl ?? fetch;
  const wait = sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const attempt = async (): Promise<{ res: Response; body: PayBody | null }> => {
    const res = await doFetch(`/api/v1/quotes/${encodeURIComponent(quoteRef)}/balance/pay`, {
      method: 'POST',
      // The cookie is the credential. Nothing is sent in the body.
      credentials: 'same-origin',
    });
    const body = (await res.json().catch(() => null)) as PayBody | null;
    return { res, body };
  };

  try {
    let { res, body } = await attempt();

    // `checkout_pending` (409) is a RACE, not a failure: create_payment single-flights the Peach session
    // behind a lease, and the request holding it records the session id within a second or two — after
    // which this call REUSES it. This is exactly the "two opens reuse one live session" behaviour.
    for (
      let retry = 0;
      retry < PENDING_RETRIES && !body?.ok && body?.error?.code === 'checkout_pending';
      retry += 1
    ) {
      await wait(PENDING_WAIT_MS);
      ({ res, body } = await attempt());
    }

    if (!res.ok || !body?.ok || !body.data) {
      if (res.status === 404 || body?.error?.code === 'not_found') {
        return { kind: 'error', message: LINK_TIMED_OUT };
      }
      return { kind: 'error', message: body?.error?.message ?? GENERIC };
    }

    const { checkoutId, bookingRef, redirectUrl, chargeCurrency, chargeAmountMinor } = body.data;
    if (checkoutId && bookingRef) {
      const charge =
        typeof chargeAmountMinor === 'number' && chargeCurrency
          ? { chargeCurrency, chargeAmountMinor }
          : undefined;
      return {
        kind: 'checkout',
        bookingRef,
        checkoutId,
        // `return=` so the guest lands back on their own balance page after paying. The default,
        // /bookings/{ref}, renders "Sign in to view booking …" for someone who has no account.
        href:
          `/bookings/${encodeURIComponent(bookingRef)}/pay` +
          `?cid=${encodeURIComponent(checkoutId)}` +
          `&return=${encodeURIComponent(quoteBalancePagePath(quoteRef))}`,
        ...(charge ? { charge } : {}),
      };
    }
    if (redirectUrl) return { kind: 'redirect', href: redirectUrl };
    return { kind: 'error', message: GENERIC };
  } catch {
    // A network failure or an HTML error page from the CDN. Never a success.
    return { kind: 'error', message: GENERIC };
  }
}
