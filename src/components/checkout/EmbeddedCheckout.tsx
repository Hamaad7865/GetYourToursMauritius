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
                const body = (await res.json().catch(() => null)) as
                  | { ok?: boolean; data?: { confirmed?: boolean } }
                  | null;
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
      if (cancelled) return;
      const Checkout = window.Checkout;
      if (!Checkout) {
        setError(t('We could not load the payment form. Please try again.'));
        return;
      }
      try {
        const instance = Checkout.initiate({
          key: entityId,
          checkoutId,
          events: {
            onCompleted: () => {
              void confirmThenReturn();
            },
            onCancelled: () => router.replace(returnUrl),
            onExpired: () => setError(t('This payment session expired. Please start again.')),
          },
        });
        instance.render('#payment-form');
      } catch {
        setError(t('We could not start the payment form. Please try again.'));
      }
    };

    if (window.Checkout) {
      mount();
      return () => {
        cancelled = true;
      };
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${scriptUrl}"]`);
    if (existing) {
      existing.addEventListener('load', mount, { once: true });
    } else {
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.async = true;
      script.addEventListener('load', mount, { once: true });
      script.addEventListener(
        'error',
        () => setError(t('We could not reach the payment provider. Please try again.')),
        { once: true },
      );
      document.body.appendChild(script);
    }

    return () => {
      cancelled = true;
    };
  }, [scriptUrl, entityId, checkoutId, returnUrl, router, t]);

  if (error) {
    return (
      <div className="rounded-xl border border-coral/30 bg-coral/5 p-4">
        <p role="alert" className="text-sm font-medium text-coral">
          {error}
        </p>
        <a href={returnUrl} className="mt-3 inline-block text-sm font-bold text-teal hover:text-teal-dark">
          {t('Back to your booking')}
        </a>
      </div>
    );
  }

  // Peach's widget injects an iframe into #payment-form. Give the target an explicit height (inline,
  // so it can't be purged or overridden) and force the iframe to fill it — otherwise the card fields
  // and Pay button get squeezed into a short inner scroll area.
  return (
    <>
      <style>{PEACH_WIDGET_CSS}</style>
      <div id="payment-form" className="w-full" style={{ height: 1000 }} />
    </>
  );
}

// Peach's widget has no auto-resize: it fills its target via height:100%. So the target must be tall
// enough for the WHOLE card + billing form, else the form gets its own inner scrollbar on top of the
// page's. We size the target and let every wrapper fill it (one chain, one page scrollbar).
const PEACH_WIDGET_CSS = `
#payment-form > div { height: 1000px !important; overflow: visible !important; }
#payment-form iframe { display: block; width: 100% !important; height: 1000px !important; border: 0; }`;
