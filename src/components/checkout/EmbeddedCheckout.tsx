'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/site/PreferencesProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { SYNC_RETRY_ATTEMPTS, nextDelayMs } from '@/lib/checkout/confirm-poll';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Try to (re)obtain the user's access token, retrying briefly — it can be momentarily unavailable
 *  right after the widget completes (session refresh in flight). Returns null if it never appears. */
async function getAccessToken(attempts = 3): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      const { data } = await getBrowserSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (token) return token;
    } catch {
      // ignore and retry
    }
    if (i < attempts - 1) await sleep(500);
  }
  return null;
}

/** Append `?just_paid=1` to the booking return URL so the confirmation page knows a payment just
 *  completed and should poll for confirmation rather than show a cold "awaiting payment" dead-end. */
function withJustPaid(returnUrl: string): string {
  return returnUrl.includes('?') ? `${returnUrl}&just_paid=1` : `${returnUrl}?just_paid=1`;
}

// Minimal typing for Peach's global checkout.js widget (loaded at runtime from their CDN).
interface PeachCheckoutInstance {
  render: (selector: string) => void;
}
interface PeachCheckoutStatic {
  initiate: (opts: {
    key: string;
    checkoutId: string;
    options?: { paymentMethods?: { include?: string[]; exclude?: string[] } };
    events?: {
      onCompleted?: (event: unknown) => void;
      onCancelled?: (event: unknown) => void;
      onExpired?: (event: unknown) => void;
    };
  }) => PeachCheckoutInstance;
}
declare global {
  interface Window {
    Checkout?: PeachCheckoutStatic;
  }
}

/**
 * Mounts the Peach Payments embedded checkout widget. The server has already created the checkout
 * (we receive its `checkoutId`); here we load Peach's checkout.js and render the card form inline.
 *
 * The booking is confirmed ONLY by the verified webhook, never here — on completion (or cancel) we
 * just send the customer to their booking page, which reflects the real payment state.
 */
export function EmbeddedCheckout({
  scriptUrl,
  entityId,
  checkoutId,
  returnUrl,
}: {
  scriptUrl: string;
  entityId: string;
  checkoutId: string;
  returnUrl: string;
}) {
  const router = useRouter();
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const initiated = useRef(false);

  useEffect(() => {
    if (initiated.current) return;
    initiated.current = true;
    let cancelled = false;
    // The widget is "settled" once it either mounts or errors. A watchdog fails closed if NEITHER
    // happens within the timeout — e.g. the script 200s empty, is CSP-blocked, or the network stalls
    // so no `load` and no `error` event ever fires. Without it the payment form stays blank forever.
    let settled = false;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const fail = (msg: string) => {
      if (settled || cancelled) return;
      settled = true;
      if (watchdog) clearTimeout(watchdog);
      setError(msg);
    };
    const armWatchdog = () => {
      watchdog = setTimeout(
        () => fail(t('The payment form is taking too long to load. Please try again.')),
        20000,
      );
    };

    // On completion, confirm the booking from the provider's authoritative status before returning —
    // so the booking page already reflects "confirmed" rather than waiting on the webhook. We retry
    // the (idempotent) sync a few times with short backoff because the provider settlement can still
    // be 'pending' for a beat (Peach result 000.200) or the network can blip. We INSPECT the response
    // and stop early once it reports confirmed. Either way we eventually navigate — appending
    // `?just_paid=1` so the booking page polls for confirmation instead of showing a cold dead-end.
    const confirmThenReturn = async () => {
      let confirmed = false;
      try {
        const token = await getAccessToken();
        if (token) {
          for (let attempt = 0; attempt < SYNC_RETRY_ATTEMPTS; attempt++) {
            try {
              const res = await fetch('/api/v1/payments/sync', {
                method: 'POST',
                headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
                body: JSON.stringify({ checkoutId }),
              });
              if (res.ok) {
                const body = (await res.json().catch(() => null)) as {
                  ok?: boolean;
                  data?: { confirmed?: boolean };
                } | null;
                if (body?.data?.confirmed) {
                  confirmed = true;
                  break;
                }
              }
            } catch {
              // network blip — fall through to the backoff and retry
            }
            if (attempt < SYNC_RETRY_ATTEMPTS - 1) await sleep(nextDelayMs(attempt));
          }
        }
      } catch {
        // ignore — confirmation falls back to the page's polling and the webhook
      }
      if (cancelled) return;
      // If sync already confirmed, the plain booking page shows the success view immediately;
      // otherwise hand off to the page's own polling (Part B) via the just_paid flag.
      router.replace(confirmed ? returnUrl : withJustPaid(returnUrl));
    };

    const mount = () => {
      if (cancelled || settled) return;
      const Checkout = window.Checkout;
      if (!Checkout) {
        fail(t('We could not load the payment form. Please try again.'));
        return;
      }
      try {
        const instance = Checkout.initiate({
          key: entityId,
          checkoutId,
          // Card-only: render just the card form. Peach stacks the Apple Pay / wallet express button above
          // the card form with a large, unconfigurable gap (no spacing option exists), and two separate
          // widgets would need two checkout sessions. `include: ['CARD']` keeps it to one compact form,
          // robust to whatever else the merchant account enables.
          options: { paymentMethods: { include: ['CARD'] } },
          events: {
            onCompleted: () => {
              void confirmThenReturn();
            },
            onCancelled: () => router.replace(returnUrl),
            onExpired: () => setError(t('This payment session expired. Please start again.')),
          },
        });
        instance.render('#payment-form');
        // Rendered without throwing → the widget is up; stand the watchdog down.
        settled = true;
        if (watchdog) clearTimeout(watchdog);
      } catch {
        fail(t('We could not start the payment form. Please try again.'));
      }
    };

    if (window.Checkout) {
      mount();
      return () => {
        cancelled = true;
        if (watchdog) clearTimeout(watchdog);
      };
    }

    // Loading the script asynchronously (or waiting on one already in flight): arm the watchdog so a
    // script that never fires `load` OR `error` still surfaces a retry instead of a blank form.
    armWatchdog();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${scriptUrl}"]`);
    if (existing) {
      existing.addEventListener('load', mount, { once: true });
      existing.addEventListener(
        'error',
        () => fail(t('We could not reach the payment provider. Please try again.')),
        { once: true },
      );
    } else {
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.addEventListener('load', mount, { once: true });
      script.addEventListener(
        'error',
        () => fail(t('We could not reach the payment provider. Please try again.')),
        { once: true },
      );
      document.body.appendChild(script);
    }

    return () => {
      cancelled = true;
      if (watchdog) clearTimeout(watchdog);
    };
  }, [scriptUrl, entityId, checkoutId, returnUrl, router, t]);

  if (error) {
    return (
      <div className="rounded-xl border border-coral/30 bg-coral/5 p-4">
        <p role="alert" className="text-sm font-medium text-coral">
          {error}
        </p>
        <div className="mt-3 flex items-center gap-4">
          {/* A full reload re-runs the mount effect from scratch (the initiated ref is reset), so the
              customer can retry the payment form in place without losing their booking. */}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-sm font-bold text-teal hover:text-teal-dark"
          >
            {t('Try again')}
          </button>
          <a href={returnUrl} className="text-sm font-bold text-ink-muted hover:text-ink">
            {t('Back to your booking')}
          </a>
        </div>
      </div>
    );
  }

  // Peach's checkout.js injects an iframe into #payment-form. We give the target (and the iframe) a
  // comfortable MINIMUM height — enough so it never collapses to the 150px iframe default that squeezed
  // the card form into a tiny inner scroll — but we DON'T pin a fixed height. A hard height kept the
  // widget's "Secured by Peach" footer anchored to the bottom, ballooning a big empty gap between Apple
  // Pay and the card form (the "scroll down too much" symptom). With a floor instead, the iframe sizes
  // to its own content (and grows when the card accordion expands), so it stays snug.
  return (
    <>
      <style>{PEACH_WIDGET_CSS}</style>
      <div id="payment-form" className="w-full" style={{ minHeight: MIN_WIDGET_HEIGHT }} />
    </>
  );
}

// One floor height shared by the target, Peach's wrapper div and its iframe, so none of them collapse
// to the 150px iframe default before the widget loads — but nothing is pinned, so the card form sizes to
// its own content with no stretched gap. Tuned for the card-only form; nudge this single number if the
// live widget ends up slightly short (scroll) or slightly tall (a little dead space).
const MIN_WIDGET_HEIGHT = 480;
const PEACH_WIDGET_CSS = `
#payment-form, #payment-form > div { min-height: ${MIN_WIDGET_HEIGHT}px; overflow: visible !important; }
#payment-form iframe { display: block; width: 100% !important; min-height: ${MIN_WIDGET_HEIGHT}px; border: 0; }`;
