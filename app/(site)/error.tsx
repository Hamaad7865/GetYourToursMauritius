'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { reportClientError } from '@/lib/client-error-report';

/**
 * Branded error boundary for the public site. Renders inside the site shell (header/footer stay), so a
 * page-level render error degrades to a friendly "try again" instead of a crash. The global-error.tsx
 * fallback handles the rarer case of the root layout itself failing.
 */
export default function SiteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // React swallows render errors into this boundary (the window 'error' listener never sees them), so
  // report from here to capture client render crashes in the server log pipeline.
  useEffect(() => {
    reportClientError({
      kind: 'react.boundary',
      message: error.message,
      stack: error.stack,
      digest: error.digest,
    });
  }, [error]);

  return (
    <div className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="font-display text-2xl font-semibold text-ink">Something went wrong</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink/70">
        We hit an unexpected error loading this page. Please try again — any booking or payment in
        progress is safe.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-full bg-teal px-6 py-2.5 text-sm font-bold text-white hover:bg-teal-dark"
        >
          Try again
        </button>
        <Link
          href="/"
          className="rounded-full border border-ink/15 px-6 py-2.5 text-sm font-bold text-ink hover:border-teal hover:text-teal"
        >
          Back to home
        </Link>
      </div>
    </div>
  );
}
