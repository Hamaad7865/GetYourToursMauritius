import { quotePagePath } from './link-cookie';

/**
 * The browser-side half of "Accept & pay" on the public quote page: one POST to
 * /api/v1/quotes/{ref}/pay, and the decision about what its answer means.
 *
 * Kept out of the component so the money-path behaviour is testable in this suite (which runs in a
 * `node` environment with no DOM). The component is left with only the side effects the browser owns —
 * the sessionStorage charge handoff and `window.location.href`.
 *
 * NO TOKEN IN THE REQUEST. The link token lives in an httpOnly cookie scoped to `/api/v1/quotes/{ref}`
 * (see link-cookie.ts), so the browser attaches it and no script — ours, GTM's, or an injected one —
 * ever holds it. `credentials: 'same-origin'` is therefore load-bearing, not decoration.
 */

/** Exactly what the pay route hands back on success; see src/lib/services/payments.ts. */
export interface QuoteChargeHandoff {
  chargeCurrency: string;
  chargeAmountMinor: number;
  /** EUR deposit + total (minor units) for a PARTIAL-deposit quote, so the pay page can disclose the
   *  "€X now, €Y balance later" split instead of a bare MUR figure. Both present together, or neither. */
  depositEurMinor?: number;
  totalEurMinor?: number;
}

export type QuotePayOutcome =
  /** An embedded Peach session: navigate to `href`, disclosing `charge` on the way. */
  | {
      kind: 'checkout';
      bookingRef: string;
      checkoutId: string;
      href: string;
      charge?: QuoteChargeHandoff;
    }
  /** A hosted redirect (and the dev stub) — the second shape `paymentLinkSchema` documents. */
  | { kind: 'redirect'; href: string }
  /** A booking already exists for this quote and has been paid, or is being paid right now. */
  | { kind: 'converted'; message: string; bookingRef?: string }
  | { kind: 'error'; message: string };

interface PayBody {
  ok?: boolean;
  data?: {
    checkoutId?: string;
    bookingRef?: string;
    redirectUrl?: string;
    chargeCurrency?: string;
    chargeAmountMinor?: number;
    depositEurMinor?: number;
    totalEurMinor?: number;
  };
  error?: { code?: string; message?: string; details?: { bookingRef?: string } };
}

const GENERIC = 'Sorry — we could not start this payment.';

/**
 * A booking exists and is paid or being paid. Distinct from a failure on purpose: api_convert_quote's
 * convert-once guard is the thing standing between a guest and a second payable booking, and the guest
 * who trips it has done nothing wrong.
 */
const ALREADY_CONVERTED =
  'You have already accepted this quote — a booking exists for it, and it has been paid or is being ' +
  'paid right now. Check your email for the confirmation, or message us.';

/**
 * The likeliest refusal of the three, and the only one with a remedy the guest can act on.
 *
 * Both link cookies carry QUOTE_TOKEN_MAX_AGE_SECONDS (2 hours), so a guest who opens the quote,
 * talks it over at lunch and comes back to the still-rendered tab clicks this button with no
 * credential attached. The route answers 404 — deliberately, and NOT a distinguishable 401, because
 * `quotes.ref` is the path segment of a link that gets forwarded and a per-case status would make the
 * page an existence oracle — so the server's own message is the framework's bare "Not found". Shown
 * verbatim in red under the button it names nothing to do, while the fix is one click away in the
 * email the guest already has.
 */
const LINK_TIMED_OUT =
  'This quote link has timed out. Please open the link in your quote email again.';

/** Matches Checkout.tsx and ResumePaymentButton: three retries, 1.5s apart. */
const PENDING_RETRIES = 3;
const PENDING_WAIT_MS = 1500;

export interface StartQuotePaymentOptions {
  quoteRef: string;
  /** Injectable for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

export async function startQuotePayment({
  quoteRef,
  fetchImpl,
  sleep,
}: StartQuotePaymentOptions): Promise<QuotePayOutcome> {
  const doFetch = fetchImpl ?? fetch;
  const wait = sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const attempt = async (): Promise<{ res: Response; body: PayBody | null }> => {
    const res = await doFetch(`/api/v1/quotes/${encodeURIComponent(quoteRef)}/pay`, {
      method: 'POST',
      // The cookie is the credential. Nothing is sent in the body, so there is no token for a script
      // to read back out of this request.
      credentials: 'same-origin',
    });
    const body = (await res.json().catch(() => null)) as PayBody | null;
    return { res, body };
  };

  try {
    let { res, body } = await attempt();

    // `checkout_pending` (409) is a RACE, not a failure: api_create_payment single-flights the Peach
    // session behind a 90-second lease, and the request holding it records the session id within a
    // second or two — after which this call REUSES it. Surfacing it as an error strands a guest whose
    // quote has in fact already converted and is payable, and their manual retry keeps failing for the
    // life of the lease because api_convert_quote also refuses to re-arm while
    // `checkout_claimed_until > now()`.
    for (
      let retry = 0;
      retry < PENDING_RETRIES && !body?.ok && body?.error?.code === 'checkout_pending';
      retry += 1
    ) {
      await wait(PENDING_WAIT_MS);
      ({ res, body } = await attempt());
    }

    if (!res.ok || !body?.ok || !body.data) {
      if (body?.error?.code === 'quote_already_converted') {
        const bookingRef = body.error.details?.bookingRef;
        return {
          kind: 'converted',
          message: ALREADY_CONVERTED,
          ...(bookingRef ? { bookingRef } : {}),
        };
      }
      if (res.status === 404 || body?.error?.code === 'not_found') {
        return { kind: 'error', message: LINK_TIMED_OUT };
      }
      return { kind: 'error', message: body?.error?.message ?? GENERIC };
    }

    const {
      checkoutId,
      bookingRef,
      redirectUrl,
      chargeCurrency,
      chargeAmountMinor,
      depositEurMinor,
      totalEurMinor,
    } = body.data;
    if (checkoutId && bookingRef) {
      const charge =
        typeof chargeAmountMinor === 'number' && chargeCurrency
          ? {
              chargeCurrency,
              chargeAmountMinor,
              // A genuine partial deposit rides along so ChargeNotice frames the charge as a deposit;
              // both figures travel together or neither does.
              ...(typeof depositEurMinor === 'number' && typeof totalEurMinor === 'number'
                ? { depositEurMinor, totalEurMinor }
                : {}),
            }
          : undefined;
      return {
        kind: 'checkout',
        bookingRef,
        checkoutId,
        // `return=` so the guest lands back on their own quote page after paying. The default,
        // /bookings/{ref}, renders "Sign in to view booking …" for someone who has no account — which
        // is every guest who reached this button.
        href:
          `/bookings/${encodeURIComponent(bookingRef)}/pay` +
          `?cid=${encodeURIComponent(checkoutId)}` +
          `&return=${encodeURIComponent(quotePagePath(quoteRef))}`,
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
