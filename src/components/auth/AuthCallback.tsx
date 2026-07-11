'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase/browser';

/** True if the string contains any ASCII control character (CR/LF/NUL/etc.). */
function hasControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    if (value.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

/**
 * Only allow a same-origin absolute path, so the `next` we redirect to can never be turned
 * into an open redirect (e.g. `//evil.com` or `/\evil.com`, which browsers treat as
 * protocol-relative). Anything else falls back to the account page.
 */
function safeInternalPath(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  if (hasControlChar(raw)) return null; // reject CRLF / control-char tricks
  if (raw.startsWith('/auth/callback')) return null; // never loop back to ourselves
  return raw;
}

/** Where to send the visitor after sign-in: the page they came from, else their account. */
function resolveRedirect(): string {
  let candidate: string | null = null;
  try {
    candidate = new URLSearchParams(window.location.search).get('next');
  } catch {
    candidate = null;
  }
  if (!candidate) {
    try {
      candidate = sessionStorage.getItem('gytm:authNext');
    } catch {
      candidate = null;
    }
  }
  return safeInternalPath(candidate) ?? '/account';
}

/**
 * Landing page for OAuth / email-confirmation redirects. The browser client
 * (detectSessionInUrl + PKCE) exchanges the `?code` for a session automatically; we just
 * wait for the session to materialise, then send the visitor back to the page they signed
 * in from (carried as `next`), falling back to their account.
 */
export function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  // Resolve during render, before the Supabase client strips the OAuth params (?code) — and
  // our ?next alongside them — off the URL.
  const [target] = useState(resolveRedirect);

  useEffect(() => {
    const sb = getBrowserSupabase();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        sessionStorage.removeItem('gytm:authNext');
      } catch {
        // ignore — best-effort cleanup
      }
      router.replace(target);
    };

    sb.auth.getSession().then(({ data }) => {
      if (data.session) finish();
    });
    const { data: sub } = sb.auth.onAuthStateChange((_e, session) => {
      if (session) finish();
    });

    // Fallback: if no session arrives, surface a retry instead of hanging.
    const timer = setTimeout(() => {
      if (!done) setError('We could not complete sign-in. Please try again.');
    }, 6000);

    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [router, target]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-6 text-center">
      {error ? (
        <div>
          <p className="text-sm font-medium text-coral">{error}</p>
          <Link
            href="/"
            className="mt-3 inline-block text-sm font-bold text-teal hover:text-teal-dark"
          >
            Back to home
          </Link>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <span
            aria-hidden
            className="h-10 w-10 animate-spin rounded-full border-[3px] border-teal/25 border-t-teal"
          />
          <p role="status" aria-live="polite" className="text-sm font-medium text-ink-muted">
            Signing you in…
          </p>
        </div>
      )}
    </div>
  );
}
