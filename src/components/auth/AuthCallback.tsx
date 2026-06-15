'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getBrowserSupabase } from '@/lib/supabase/browser';

/**
 * Landing page for OAuth / email-confirmation redirects. The browser client
 * (detectSessionInUrl + PKCE) exchanges the `?code` for a session automatically; we just
 * wait for the session to materialise, then send the visitor on to their account.
 */
export function AuthCallback() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = getBrowserSupabase();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      router.replace('/account');
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
  }, [router]);

  return (
    <div className="grid min-h-[60vh] place-items-center px-6 text-center">
      {error ? (
        <div>
          <p className="text-sm font-medium text-coral">{error}</p>
          <a href="/account" className="mt-3 inline-block text-sm font-bold text-teal hover:text-teal-dark">
            Back to sign in
          </a>
        </div>
      ) : (
        <p className="text-sm font-medium text-ink-muted">Signing you in…</p>
      )}
    </div>
  );
}
