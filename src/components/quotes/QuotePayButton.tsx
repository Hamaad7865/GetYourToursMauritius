'use client';

import { useState } from 'react';

/**
 * The Pay button on the public quote page.
 *
 * It posts the LINK TOKEN — the same raw token that is already in the page's URL — to
 * POST /api/v1/quotes/{ref}/pay, because the guest has no account and that token is the only thing
 * authenticating them. The route converts the quote into a booking and mints the Peach checkout; this
 * component only hands the guest to the existing pay page with the session id, so the widget, the
 * webhook, the confirmation email and the VAT invoice are all the untouched money path.
 *
 * Deliberately NOT localised, matching src/lib/email/quote.ts: the quote email the guest just read is
 * English-only, so a French page under an English email would be the odd half. Translating the module
 * is a follow-up that does both together.
 */
export function QuotePayButton({ quoteRef, token }: { quoteRef: string; token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    if (busy) return; // guard against a double-submit
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/quotes/${encodeURIComponent(quoteRef)}/pay`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        data?: { checkoutId?: string; bookingRef?: string; redirectUrl?: string };
        error?: { message?: string };
      } | null;
      if (!res.ok || !body?.ok || !body.data) {
        throw new Error(body?.error?.message ?? 'Sorry — we could not start this payment.');
      }

      const { checkoutId, bookingRef, redirectUrl } = body.data;
      if (checkoutId && bookingRef) {
        // The embedded Peach widget lives on the existing pay page, which mounts it from `cid` and
        // needs no session — the recovery path a returning customer already uses.
        // `busy` stays true: we are navigating away, so the button must not become clickable again.
        window.location.href = `/bookings/${encodeURIComponent(bookingRef)}/pay?cid=${encodeURIComponent(checkoutId)}`;
        return;
      }
      // A hosted redirect rather than an embedded session — the shape `paymentLinkSchema` documents
      // for redirect providers and the dev stub. Same two-shape handling as ResumePaymentButton.
      if (redirectUrl) {
        window.location.href = redirectUrl;
        return;
      }
      throw new Error('Sorry — we could not start this payment.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sorry — we could not start this payment.');
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void pay()}
        disabled={busy}
        className="inline-flex w-full items-center justify-center rounded-full bg-teal px-6 py-3 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-60 sm:w-auto"
      >
        {busy ? 'Starting…' : 'Accept & pay'}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-[13px] font-medium text-coral-dark">
          {error}
        </p>
      )}
    </>
  );
}
