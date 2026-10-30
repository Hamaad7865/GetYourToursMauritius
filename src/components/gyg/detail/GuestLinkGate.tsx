'use client';

import { useState } from 'react';
import Link from '@/components/site/LocaleLink';
import { useAuth } from '@/components/auth/AuthProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { reportClientError } from '@/lib/client-error-report';

/**
 * What the emailed manage link lands on when this browser does not own the booking yet.
 *
 * NOTHING HAPPENS UNTIL THE CLICK, and that is the point of this screen. Mail scanners open emailed
 * links and some run JavaScript. If this page signed in and adopted on load, a scanner would create an
 * anonymous user and take the booking away from the guest's own device.
 *
 * A guest (or nobody) adopts through the link. A real account never does: it gets the booking through
 * the confirmed-email claim, or is told how to, so a forwarded email cannot move a booking into a
 * stranger's account.
 */
export function GuestLinkGate({
  bookingRef,
  onStart,
  onOpened,
}: {
  bookingRef: string;
  /** Tells the page to keep this screen up while the session the click creates arrives. */
  onStart: () => void;
  /** Loads the booking with this token. Resolves true once it is on screen. */
  onOpened: (accessToken: string) => Promise<boolean>;
}) {
  const t = useT();
  const { user, session } = useAuth();
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  async function openBooking() {
    onStart();
    setBusy(true);
    setRefusal(null);
    try {
      if (user && session) {
        await fetch('/api/v1/account/claim-guest-bookings', {
          method: 'POST',
          headers: { authorization: `Bearer ${session.access_token}` },
        });
        if (!(await onOpened(session.access_token))) {
          setRefusal(
            t(
              'This booking isn’t linked to your account. Sign in with the email address it was booked with to add it, or sign out to open it as a guest.',
            ),
          );
        }
        return;
      }

      let accessToken = session?.access_token ?? null;
      if (!accessToken) {
        const { data, error } = await getBrowserSupabase().auth.signInAnonymously();
        if (error) {
          reportClientError({ kind: 'guest-session-failed', message: error.message });
        }
        accessToken = data.session?.access_token ?? null;
      }
      if (!accessToken) {
        setRefusal(t('We couldn’t open your booking — please try again.'));
        return;
      }

      const res = await fetch(`/api/v1/bookings/${encodeURIComponent(bookingRef)}/adopt`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok || !(await onOpened(accessToken))) {
        setRefusal(
          t(
            'We can’t open this booking here. If you’ve added it to an account, sign in to see it. Otherwise, use Find my booking to get a fresh link.',
          ),
        );
      }
    } catch {
      setRefusal(t('We couldn’t open your booking — please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-16 text-center">
      <h1 className="font-display text-2xl font-semibold text-ink">
        {t('Booking {ref}', { ref: bookingRef })}
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">
        {t('Tap below to open your booking on this device.')}
      </p>
      <button
        type="button"
        onClick={openBooking}
        disabled={busy}
        className="mt-5 rounded-full bg-teal-dark px-7 py-3 text-sm font-bold text-white hover:bg-teal-dark/90 disabled:opacity-80"
      >
        {busy ? t('Opening…') : t('View my booking')}
      </button>
      {refusal && (
        <div className="mx-auto mt-5 max-w-sm">
          <p role="alert" className="text-sm text-coral-dark">
            {refusal}
          </p>
          <Link
            href="/bookings/find"
            className="mt-3 inline-block text-sm font-bold text-teal-dark underline"
          >
            {t('Find my booking')}
          </Link>
        </div>
      )}
    </div>
  );
}
