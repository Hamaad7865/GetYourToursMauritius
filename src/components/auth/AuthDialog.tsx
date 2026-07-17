'use client';

import { useEffect, useRef, useState } from 'react';
import type { Provider } from '@supabase/supabase-js';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { useDialog } from '@/lib/a11y/useDialog';
import { usePreferences, useT } from '@/components/site/PreferencesProvider';
import {
  IconEye,
  IconEyeOff,
  IconGoogle,
  IconLock,
  IconMail,
  IconUser,
  IconX,
} from '@/components/ui/icons';
import type { AuthMode } from './AuthProvider';

const OAUTH: Array<{ provider: Provider; label: string; icon: React.ReactNode }> = [
  { provider: 'google', label: 'Continue with Google', icon: <IconGoogle /> },
];

/**
 * The `/auth/callback` URL with the current page recorded as `next`, so OAuth /
 * email-confirmation sign-in returns the visitor to where they were (matching the
 * email+password flow, which just closes the modal in place) instead of always
 * landing on the account page. The path also rides `sessionStorage` as a same-tab
 * fallback in case the provider strips the query string on the round-trip.
 */
function authCallbackUrl(): string {
  const url = new URL('/auth/callback', window.location.origin);
  const { pathname, search } = window.location;
  // Never bounce the user back to the callback page itself.
  if (!pathname.startsWith('/auth/callback')) {
    const next = pathname + search;
    url.searchParams.set('next', next);
    try {
      sessionStorage.setItem('gytm:authNext', next);
    } catch {
      // sessionStorage can be unavailable (private mode); the query param still carries `next`.
    }
  }
  return url.toString();
}

/**
 * Where Supabase's password-recovery email link should land. The browser client's
 * `detectSessionInUrl` + PKCE auto-exchanges the `?code` into a session there and fires a
 * `PASSWORD_RECOVERY` event, so the reset page only has to wait for that session.
 *
 * `lang` rides the redirect URL for the send-email hook: a reset is requested SIGNED OUT, so the
 * current UI language is the only signal available (no session → no metadata write). The hook
 * prefers the account's stored `user_metadata.lang` and falls back to this. The Supabase redirect
 * allow-list entry is `https://…/**`, which covers the query string.
 */
function resetRedirectUrl(lang: string): string {
  const url = new URL('/auth/reset-password', window.location.origin);
  url.searchParams.set('lang', lang);
  return url.toString();
}

/** GetYourGuide-style sign in / sign up modal. Email+password plus social providers. */
export function AuthDialog({
  mode,
  onClose,
  onSwitch,
}: {
  mode: AuthMode;
  onClose: () => void;
  onSwitch: (mode: AuthMode) => void;
}) {
  const t = useT();
  const { language } = usePreferences();
  const [view, setView] = useState<'auth' | 'forgot'>('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // On a successful email sign-in / sign-up-with-session, swap the card to a brief success animation
  // (checkmark) before the modal closes — instead of it just vanishing. Holds the heading to show.
  const [done, setDone] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  // APG modal behaviour: scroll-lock, Escape, focus the email field on open, trap Tab, and
  // restore focus to the trigger on close.
  const dialogRef = useDialog(true, onClose, () => emailRef.current);

  const signup = mode === 'signup';

  // Switching between sign in / sign up (or reopening into a fresh mode) drops the
  // forgot-password sub-view so the modal always reopens clean on the chosen mode.
  useEffect(() => {
    setView('auth');
  }, [mode]);

  // Toggling the forgot-password view unmounts/remounts the email field; move focus to the new
  // one after React commits. The initial open is already focused by useDialog, so skip first run.
  const viewMounted = useRef(false);
  useEffect(() => {
    if (viewMounted.current) emailRef.current?.focus();
    else viewMounted.current = true;
  }, [view]);

  // Let the success checkmark play, then close the modal (returning the user to where they were).
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(onClose, 1300);
    return () => window.clearTimeout(id);
  }, [done, onClose]);

  async function submitEmail(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const sb = getBrowserSupabase();
    try {
      if (signup) {
        const { data, error } = await sb.auth.signUp({
          email,
          password,
          options: {
            // `lang` = the site language the account was created in; the send-email auth hook reads
            // it to pick EN/FR for every later auth email (reset, magic link, email change).
            data: { full_name: name || null, lang: language },
            emailRedirectTo: authCallbackUrl(),
          },
        });
        if (error) throw error;
        // Email confirmation on → no session yet; otherwise we're signed straight in.
        // The message is deliberately identical whether or not the email already has an account:
        // Supabase returns the same session-less success for a duplicate signup (anti-enumeration —
        // never reveal which addresses are registered). The "Already have an account? Just sign in."
        // half nudges a returning customer who forgot they signed up, WITHOUT confirming to a stranger
        // that the address exists.
        if (!data.session) {
          setNotice(
            t('Check your inbox to confirm your email. Already have an account? Just sign in.'),
          );
          return;
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      // Success → play the checkmark animation; the effect above closes the modal once it has run.
      setDone(signup ? t('Welcome aboard!') : t('You’re in!'));
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Something went wrong. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const sb = getBrowserSupabase();
    try {
      await sb.auth.resetPasswordForEmail(email, { redirectTo: resetRedirectUrl(language) });
    } catch (err) {
      // A genuine network/transport failure is worth surfacing; a "user not found" from
      // Supabase would NOT throw here — it returns success-shaped — so this only catches
      // real failures and never leaks whether the account exists.
      if (err instanceof TypeError) {
        setError(t('Something went wrong. Please try again.'));
        setBusy(false);
        return;
      }
    }
    // No user enumeration: same neutral confirmation whether or not the email exists.
    setNotice(
      t("If an account exists for that email, we've sent a password reset link. Check your inbox."),
    );
    setBusy(false);
  }

  async function oauth(provider: Provider) {
    setBusy(true);
    setError(null);
    try {
      const { error } = await getBrowserSupabase().auth.signInWithOAuth({
        provider,
        options: { redirectTo: authCallbackUrl() },
      });
      if (error) throw error;
      // Success redirects the browser away; nothing more to do here.
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('Could not continue with {provider}.', { provider }),
      );
      setBusy(false);
    }
  }

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={
        view === 'forgot'
          ? t('Reset your password')
          : signup
            ? t('Create an account')
            : t('Sign in')
      }
      onMouseDown={onClose}
    >
      <div
        className="animate-float-in relative w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Close')}
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-ink-muted hover:bg-cream hover:text-ink"
        >
          <IconX width={18} height={18} />
        </button>

        {done ? (
          <div className="flex flex-col items-center justify-center px-2 py-10 text-center">
            <span className="relative grid h-20 w-20 place-items-center">
              <span
                aria-hidden
                className="animate-ring-echo absolute h-16 w-16 rounded-full bg-teal/25"
              />
              <span className="animate-pop grid h-20 w-20 place-items-center rounded-full bg-teal text-white shadow-[0_16px_34px_-12px_rgba(14,140,146,0.75)]">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    className="animate-draw-check"
                    d="M5 12.8l4.2 4.2L19 7.2"
                    stroke="currentColor"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
            </span>
            <h2
              role="status"
              aria-live="polite"
              className="animate-float-in mt-5 font-display text-2xl font-semibold text-ink"
            >
              {done}
            </h2>
            <p className="animate-float-in mt-1 text-sm text-ink-muted">{t('Taking you back…')}</p>
          </div>
        ) : (
          <>
            <h2 className="font-display text-2xl font-semibold text-ink">
              {view === 'forgot'
                ? t('Reset your password')
                : signup
                  ? t('Create your account')
                  : t('Welcome back')}
            </h2>
            <p className="mt-1 text-sm text-ink-muted">
              {view === 'forgot'
                ? t("Enter your email and we'll send you a link to reset your password.")
                : signup
                  ? t('Book direct with Belle Mare Tours and track every trip.')
                  : t('Sign in to manage your bookings.')}
            </p>

            {view === 'auth' && (
              <>
                <div className="mt-5 flex flex-col gap-2">
                  {OAUTH.map((o) => (
                    <button
                      key={o.provider}
                      type="button"
                      disabled={busy}
                      onClick={() => oauth(o.provider)}
                      className="flex items-center justify-center gap-2.5 rounded-xl border border-ink/15 bg-white px-4 py-2.5 text-sm font-bold text-ink transition hover:bg-cream disabled:opacity-60"
                    >
                      {o.icon}
                      {t(o.label)}
                    </button>
                  ))}
                </div>

                <div className="my-5 flex items-center gap-3 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
                  <span className="h-px flex-1 bg-ink/10" />
                  {t('or')}
                  <span className="h-px flex-1 bg-ink/10" />
                </div>
              </>
            )}

            {view === 'forgot' ? (
              <form onSubmit={submitForgot} className="mt-5 flex flex-col gap-3">
                <Field icon={<IconMail width={18} height={18} />}>
                  <input
                    ref={emailRef}
                    type="email"
                    required
                    aria-required="true"
                    aria-label={t('Email address')}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'auth-error' : undefined}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('Email address')}
                    autoComplete="email"
                    className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
                  />
                </Field>

                {error && (
                  <p
                    id="auth-error"
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
                  {busy ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <span
                        aria-hidden
                        className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                      />
                      {t('Sending…')}
                    </span>
                  ) : (
                    t('Send reset link')
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    setView('auth');
                  }}
                  className="text-center text-sm font-bold text-teal-dark hover:text-teal-dark/80"
                >
                  {t('Back to sign in')}
                </button>
              </form>
            ) : (
              <form onSubmit={submitEmail} className="flex flex-col gap-3">
                {signup && (
                  <Field icon={<IconUser width={18} height={18} />}>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      aria-label={t('Full name')}
                      placeholder={t('Full name')}
                      autoComplete="name"
                      className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
                    />
                  </Field>
                )}
                <Field icon={<IconMail width={18} height={18} />}>
                  <input
                    ref={emailRef}
                    type="email"
                    required
                    aria-required="true"
                    aria-label={t('Email address')}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? 'auth-error' : undefined}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('Email address')}
                    autoComplete="email"
                    className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
                  />
                </Field>
                <Field icon={<IconLock width={18} height={18} />}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    required
                    minLength={6}
                    aria-required="true"
                    aria-label={t('Password')}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={`auth-password-hint${error ? ' auth-error' : ''}`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('Password')}
                    autoComplete={signup ? 'new-password' : 'current-password'}
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
                <span id="auth-password-hint" className="sr-only">
                  {t('Password must be at least 6 characters.')}
                </span>

                {!signup && (
                  <div className="-mt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setNotice(null);
                        setView('forgot');
                      }}
                      className="text-[13px] font-semibold text-teal-dark hover:text-teal-dark/80"
                    >
                      {t('Forgot password?')}
                    </button>
                  </div>
                )}

                {error && (
                  <p
                    id="auth-error"
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
                  {busy ? (
                    <span className="inline-flex items-center justify-center gap-2">
                      <span
                        aria-hidden
                        className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                      />
                      {signup ? t('Creating your account…') : t('Signing you in…')}
                    </span>
                  ) : signup ? (
                    t('Create account')
                  ) : (
                    t('Sign in')
                  )}
                </button>
              </form>
            )}

            {view === 'auth' && (
              <p className="mt-5 text-center text-sm text-ink-muted">
                {signup ? t('Already have an account?') : t('New to Belle Mare Tours?')}{' '}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setNotice(null);
                    onSwitch(signup ? 'signin' : 'signup');
                  }}
                  className="font-bold text-teal-dark hover:text-teal-dark/80"
                >
                  {signup ? t('Sign in') : t('Create one')}
                </button>
              </p>
            )}
          </>
        )}
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
