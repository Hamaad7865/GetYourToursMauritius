'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useT } from '@/components/site/PreferencesProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';

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
    // so the booking page already reflects "confirmed" rather than waiting on the webhook. Best
    // effort: if it fails, the webhook (and the booking page) remain fallbacks, so we still return.
    const confirmThenReturn = async () => {
      try {
        const { data } = await getBrowserSupabase().auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          await fetch('/api/v1/payments/sync', {
            method: 'POST',
            headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
            body: JSON.stringify({ checkoutId }),
          });
        }
      } catch {
        // ignore — confirmation falls back to the webhook
      }
      router.replace(returnUrl);
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
