'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { useResumePayment } from './ResumePaymentButton';

/**
 * Rendered on /bookings/{ref}/pay when no `cid` is present — the case a returning customer hits via
 * the email link or a new tab (the checkout session is created by POST /api/v1/payments, which that
 * navigation never called). Instead of a cold "could not start this payment" dead-end, we auto-mint a
 * fresh checkout and redirect to /pay?cid=… (or the hosted redirectUrl). A manual button backs the
 * auto-attempt for when it can't run (not signed in, or it errored).
 */
export function PayPageFallback({
  bookingRef,
  returnUrl,
}: {
  bookingRef: string;
  returnUrl: string;
}) {
  const t = useT();
  const { session, loading: authLoading, openAuth } = useAuth();
  const { resume, busy, error, notPayable } = useResumePayment(bookingRef);
  // Run the auto-mint exactly once, the first time a session is available.
  const triedRef = useRef(false);

  useEffect(() => {
    if (authLoading || !session || triedRef.current) return;
    triedRef.current = true;
    void resume();
  }, [authLoading, session, resume]);

  if (authLoading) {
    return <p className="py-6 text-center text-sm text-ink-muted">{t('Loading your booking…')}</p>;
  }

  if (!session) {
    return (
      <div className="rounded-xl border border-ink/10 bg-white p-4">
        <p className="text-sm text-ink-muted">{t('Please sign in to complete your payment.')}</p>
        <button
          type="button"
          onClick={() => openAuth('signin')}
          className="mt-3 inline-flex rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
        >
          {t('Sign in')}
        </button>
      </div>
    );
  }

  // Already paid / terminal — a clear, non-alarming note plus a way back, never a charge.
  if (notPayable) {
    return (
      <div className="rounded-xl border border-teal/30 bg-teal/5 p-4">
        <p className="text-sm font-medium text-ink">
          {t('This booking is already paid or has expired.')}
        </p>
        <a
          href={returnUrl}
          className="mt-3 inline-block text-sm font-bold text-teal hover:text-teal-dark"
        >
          {t('Back to your booking')}
        </a>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-coral/30 bg-coral/5 p-4">
        <p role="alert" className="text-sm font-medium text-coral">
          {error}
        </p>
        <button
          type="button"
          onClick={() => void resume()}
          disabled={busy}
          className="mt-3 inline-flex rounded-full bg-teal px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark disabled:opacity-60"
        >
          {busy ? t('Starting…') : t('Try again')}
        </button>
        <a
          href={returnUrl}
          className="ml-3 inline-block text-sm font-bold text-teal hover:text-teal-dark"
        >
          {t('Back to your booking')}
        </a>
      </div>
    );
  }

  // Default: the auto-mint is in flight (or about to be). Reassuring interim copy, never a dead-end.
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-3 rounded-xl bg-gold-light/20 px-4 py-3 text-sm text-ink"
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-teal/30 border-t-teal"
      />
      <span>{t('Starting your payment…')}</span>
    </div>
  );
}
