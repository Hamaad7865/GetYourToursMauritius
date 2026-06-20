'use client';

/* eslint-disable @next/next/no-html-link-for-pages -- this boundary replaces the whole document and runs
   when even the root layout / router context may have failed, so it must use a plain <a> (next/link's
   <Link> depends on the app-router context that isn't guaranteed here). */

/**
 * Ultimate fallback: catches errors thrown in the ROOT layout itself, where the normal error boundary
 * can't render. It replaces the whole document, so it must be fully self-contained (its own <html>/<body>,
 * inline styles — no Tailwind/layout, which may be exactly what failed). Keeps a crash from ever showing
 * a blank white screen.
 */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          background: '#fffdf9',
          color: '#0a2e36',
        }}
      >
        <div style={{ maxWidth: 440, padding: 24, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: '0 0 10px' }}>Something went wrong</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, color: '#4a5b5f', margin: '0 0 22px' }}>
            We hit an unexpected error. Please try again — if it keeps happening, contact us and we’ll
            help you book directly.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: '#0e8c92',
              color: '#fff',
              border: 0,
              borderRadius: 999,
              padding: '11px 24px',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <p style={{ marginTop: 18, marginBottom: 0 }}>
            <a href="/" style={{ color: '#0e8c92', fontSize: 14, fontWeight: 600, textDecoration: 'none' }}>
              Back to home
            </a>
          </p>
        </div>
      </body>
    </html>
  );
}
