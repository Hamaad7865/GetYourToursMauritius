'use client';

import { useState } from 'react';
import { useT } from '@/components/site/PreferencesProvider';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { friendlyAuthError } from '@/lib/auth/auth-error';
import { authCallbackUrl } from '@/components/auth/AuthDialog';

/**
 * For a guest on their booking page: turn this guest session into an account. Supabase upgrades the
 * anonymous user in place once the email is confirmed, so the user id does not change and every booking
 * comes with it. Nothing to claim, and nothing is lost if they ignore this.
 *
 * A password cannot be set until the address is confirmed (Supabase refuses it on an anonymous user), so
 * the banner only asks for the email; "Forgot password" adds one later.
 *
 * The success text does not say whether the address already has an account. Supabase refuses that case,
 * and answering differently would tell a stranger which addresses are registered.
 */
export function SaveBookingBanner({ email }: { email: string }) {
  const t = useT();
  const [value, setValue] = useState(email);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { error: updateError } = await getBrowserSupabase().auth.updateUser(
        { email: value.trim() },
        { emailRedirectTo: authCallbackUrl() },
      );
      if (updateError && updateError.code !== 'email_exists') throw updateError;
      setSent(true);
    } catch (err) {
      setError(friendlyAuthError(err, t).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-teal/20 bg-teal/5 p-4 text-left">
      <h2 className="text-sm font-bold text-ink">{t('Save your booking to an account')}</h2>
      {sent ? (
        <p role="status" className="mt-1 text-[13px] leading-relaxed text-ink-muted">
          {t(
            'Check your inbox and tap the link to confirm your email. Already have an account? Just sign in.',
          )}
        </p>
      ) : (
        <>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
            {t(
              'You booked as a guest. Confirm your email and you can see this booking from any device. It’s free and optional.',
            )}
          </p>
          <form onSubmit={save} className="mt-3 flex flex-col gap-2 sm:flex-row">
            <input
              type="email"
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
              autoComplete="email"
              aria-label={t('Email address')}
              className="min-w-0 flex-1 rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 text-sm outline-none focus:border-teal"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-teal-dark px-5 py-2.5 text-sm font-bold text-white hover:bg-teal-dark/90 disabled:opacity-80"
            >
              {busy ? t('Sending…') : t('Save my booking')}
            </button>
          </form>
          {error && (
            <p role="alert" className="mt-2 text-[13px] font-medium text-coral-dark">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
