import { quoteInstallmentPagePath } from './link-cookie';

/**
 * Browser-side half of "Pay this installment": one POST to /api/v1/quotes/{ref}/i/{seq}/pay, and the
 * decision about what its answer means. The installment analogue of {@link
 * import('./balance-pay-client').startBalancePayment}. NO TOKEN in the request — it lives in the
 * httpOnly cookie the open route set (scoped to this seq), so `credentials: 'same-origin'` is
 * load-bearing. Kept out of the component so the money-path behaviour is testable without a DOM.
 */

export interface InstallmentChargeHandoff {
  chargeCurrency: string;
  chargeAmountMinor: number;
}

export type InstallmentPayOutcome =
  | {
      kind: 'checkout';
      bookingRef: string;
      checkoutId: string;
      href: string;
      charge?: InstallmentChargeHandoff;
    }
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
const LINK_TIMED_OUT = 'This payment link has timed out. Please open the link we sent you again.';
const PENDING_RETRIES = 3;
const PENDING_WAIT_MS = 1500;

export interface StartInstallmentPaymentOptions {
  quoteRef: string;
  seq: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export async function startInstallmentPayment({
  quoteRef,
  seq,
  fetchImpl,
  sleep,
}: StartInstallmentPaymentOptions): Promise<InstallmentPayOutcome> {
  const doFetch = fetchImpl ?? fetch;
  const wait = sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  const attempt = async (): Promise<{ res: Response; body: PayBody | null }> => {
    const res = await doFetch(`/api/v1/quotes/${encodeURIComponent(quoteRef)}/i/${seq}/pay`, {
      method: 'POST',
      credentials: 'same-origin',
    });
    const body = (await res.json().catch(() => null)) as PayBody | null;
    return { res, body };
  };

  try {
    let { res, body } = await attempt();

    // checkout_pending (409) is the single-flight lease race — retry a few times to reuse the winner's session.
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
        // return= so the guest lands back on THIS installment's page, not the /bookings sign-in wall.
        href:
          `/bookings/${encodeURIComponent(bookingRef)}/pay` +
          `?cid=${encodeURIComponent(checkoutId)}` +
          `&return=${encodeURIComponent(quoteInstallmentPagePath(quoteRef, seq))}`,
        ...(charge ? { charge } : {}),
      };
    }
    if (redirectUrl) return { kind: 'redirect', href: redirectUrl };
    return { kind: 'error', message: GENERIC };
  } catch {
    return { kind: 'error', message: GENERIC };
  }
}
