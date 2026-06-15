'use client';

import { useEffect, useRef, useState } from 'react';
import type { Provider } from '@supabase/supabase-js';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import {
  IconApple,
  IconEye,
  IconEyeOff,
  IconFacebook,
  IconGoogle,
  IconLock,
  IconMail,
  IconUser,
  IconX,
} from '@/components/ui/icons';
import type { AuthMode } from './AuthProvider';

const OAUTH: Array<{ provider: Provider; label: string; icon: React.ReactNode }> = [
  { provider: 'google', label: 'Continue with Google', icon: <IconGoogle /> },
  { provider: 'apple', label: 'Continue with Apple', icon: <IconApple width={16} height={16} /> },
  { provider: 'facebook', label: 'Continue with Facebook', icon: <IconFacebook /> },
];

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
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const signup = mode === 'signup';

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
            data: { full_name: name || null },
            emailRedirectTo: `${window.location.origin}/auth/callback`,
          },
        });
        if (error) throw error;
        // Email confirmation on → no session yet; otherwise we're signed straight in.
        if (!data.session) {
          setNotice('Check your inbox to confirm your email, then sign in.');
          return;
        }
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function oauth(provider: Provider) {
    setBusy(true);
    setError(null);
    try {
      const { error } = await getBrowserSupabase().auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      // Success redirects the browser away; nothing more to do here.
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not continue with ${provider}.`);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={signup ? 'Create an account' : 'Sign in'}
      onMouseDown={onClose}
    >
      <div
        className="relative w-full max-w-[420px] rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-ink-muted hover:bg-cream hover:text-ink"
        >
          <IconX width={18} height={18} />
        </button>

        <h2 className="font-display text-2xl font-semibold text-ink">
          {signup ? 'Create your account' : 'Welcome back'}
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          {signup
            ? 'Book direct with Belle Mare Tours and track every trip.'
            : 'Sign in to manage your bookings.'}
        </p>

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
              {o.label}
            </button>
          ))}
        </div>

        <div className="my-5 flex items-center gap-3 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
          <span className="h-px flex-1 bg-ink/10" />
          or
          <span className="h-px flex-1 bg-ink/10" />
        </div>

        <form onSubmit={submitEmail} className="flex flex-col gap-3">
          {signup && (
            <Field icon={<IconUser width={18} height={18} />}>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              autoComplete="email"
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
            />
          </Field>
          <Field icon={<IconLock width={18} height={18} />}>
            <input
              type={showPassword ? 'text' : 'password'}
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              autoComplete={signup ? 'new-password' : 'current-password'}
              className="w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
            />
            <button
              type="button"
              onClick={() => setShowPassword((s) => !s)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="shrink-0 text-ink-muted hover:text-ink"
            >
              {showPassword ? <IconEyeOff width={18} height={18} /> : <IconEye width={18} height={18} />}
            </button>
          </Field>

          {error && (
            <p className="rounded-lg bg-coral/10 px-3 py-2 text-[13px] font-medium text-coral">{error}</p>
          )}
          {notice && (
            <p className="rounded-lg bg-teal/10 px-3 py-2 text-[13px] font-medium text-teal-dark">{notice}</p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 rounded-xl bg-teal px-4 py-2.5 text-sm font-bold text-white transition hover:bg-teal-dark disabled:opacity-60"
          >
            {busy ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-muted">
          {signup ? 'Already have an account?' : 'New to Belle Mare Tours?'}{' '}
          <button
            type="button"
            onClick={() => {
              setError(null);
              setNotice(null);
              onSwitch(signup ? 'signin' : 'signup');
            }}
            className="font-bold text-teal hover:text-teal-dark"
          >
            {signup ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  );
}

function Field({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2.5 rounded-xl border border-ink/15 bg-white px-3.5 py-2.5 focus-within:border-teal">
      <span className="shrink-0 text-ink-muted">{icon}</span>
      {children}
    </label>
  );
}
