'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { useT } from '@/components/site/PreferencesProvider';
import { IconEye, IconEyeOff, IconLock } from '@/components/ui/icons';

type Phase = 'verifying' | 'ready' | 'invalid';

/**
 * Landing page for Supabase's password-recovery email link. The browser client
 * (detectSessionInUrl + PKCE) exchanges the `?code` for a session automatically and fires a
 * `PASSWORD_RECOVERY` event, so — exactly like AuthCallback — we just wait for the session
 * to materialise, then show the set-a-new-password form. If no session arrives within the
 * fallback window the link was bad/expired and we say so.
 */
export function ResetPassword() {
  const t = useT();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('verifying');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sb = getBrowserSupabase();
    let settled = false;
    const ready = () => {
      if (settled) return;
      settled = true;
      setPhase('ready');
    };

    // Any active session unlocks the form. The recovery link's PKCE exchange establishes one (and
    // fires PASSWORD_RECOVERY); we deliberately accept a pre-existing logged-in session too, since
    // updating your own password is in-scope — and gating strictly on the PASSWORD_RECOVERY event
    // would race the subscription (the event can fire before onAuthStateChange attaches).
    sb.auth.getSession().then(({ data }) => {
      if (data.session) ready();
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (session) ready();
    });

    // Fallback: no recovery session means the link was invalid or has expired.
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        setPhase('invalid');
      }
    }, 6000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  // Move keyboard focus to the first field once the form is shown (this is a full page, not a
  // focus-trapped modal, so nothing else does it).
  useEffect(() => {
    if (phase === 'ready') pwRef.current?.focus();
  }, [phase]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (password !== confirm) {
      setError(t('Passwords do not match'));
      return;
    }
    setBusy(true);
    const sb = getBrowserSupabase();
    try {
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw error;
      setNotice(t('Your password has been updated.'));
      router.replace('/account');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Something went wrong. Please try again.'));
      setBusy(false);
    }
  }

  if (phase === 'verifying') {
    return (
      <div className="grid min-h-[60vh] place-items-center px-6 text-center">
        <p className="text-sm font-medium text-ink-muted">{t('Verifying your reset link…')}</p>
      </div>
    );
  }

  if (phase === 'invalid') {
    return (
      <div className="grid min-h-[60vh] place-items-center px-6 text-center">
        <div>
          <p className="text-sm font-medium text-coral-dark">
            {t('This reset link is invalid or has expired. Please request a new one.')}
          </p>
          <Link
            href="/"
            className="mt-3 inline-block text-sm font-bold text-teal hover:text-teal-dark"
          >
            {t('Back to home')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-[60vh] place-items-center px-4 py-12">
      <div className="w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-2xl sm:p-8">
        <h1 className="font-display text-2xl font-semibold text-ink">{t('Set a new password')}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t('Enter a new password for your account.')}</p>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
          <Field icon={<IconLock width={18} height={18} />}>
            <input
              ref={pwRef}
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              aria-required="true"
              aria-label={t('New password')}
              aria-invalid={error ? true : undefined}
              aria-describedby={`reset-password-hint${error ? ' reset-error' : ''}`}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('New password')}
              autoComplete="new-password"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? t('Hide password') : t('Show password')}
              className="shrink-0 text-ink-muted hover:text-ink"
            >
              {showPassword ? (
                <IconEyeOff width={18} height={18} />
              ) : (
                <IconEye width={18} height={18} />
              )}
            </button>
          </Field>
          <Field icon={<IconLock width={18} height={18} />}>
            <input
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              aria-required="true"
              aria-label={t('Confirm password')}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'reset-error' : undefined}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder={t('Confirm password')}
              autoComplete="new-password"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
            />
          </Field>
          <span id="reset-password-hint" className="sr-only">
            {t('Password must be at least 6 characters.')}
          </span>

          {error && (
            <p
              id="reset-error"
              role="alert"
              aria-live="assertive"
              className="rounded-lg bg-coral/10 px-3 py-2 text-[13px] font-medium text-coral-dark"
            >
              {error}
            </p>
          )}
          {notice && (
            <p
              role="status"
              className="rounded-lg bg-teal/10 px-3 py-2 text-[13px] font-medium text-teal-dark"
            >
              {notice}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-xl bg-teal-dark px-4 py-2.5 text-sm font-bold text-white transition hover:bg-teal-dark/90 disabled:cursor-not-allowed disabled:bg-teal-dark/85"
          >
            {busy ? t('Please wait…') : t('Update password')}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2.5 rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 focus-within:border-teal">
      <span className="shrink-0 text-ink-muted" aria-hidden="true">
        {icon}
      </span>
      {children}
    </label>
  );
}
