import Link from 'next/link';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';

// The root not-found boundary. Reading cookies() in the root layout makes every route dynamic, so
// Next's implicit /_not-found route is dynamic too and must run on the Edge runtime for the Cloudflare
// Pages build (@cloudflare/next-on-pages) — the default 404 can't declare it, so we provide this one.
export const runtime = 'edge';

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-shell flex-col items-center px-6 py-24 text-center">
        <p className="text-sm font-bold uppercase tracking-wider text-teal">404</p>
        <h1 className="mt-3 font-display text-4xl font-medium tracking-tight text-ink">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-3 max-w-md text-ink-muted">
          The link may be out of date. Head back home, or browse everything Belle Mare Tours runs on
          the east coast of Mauritius.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/"
            className="rounded-xl bg-teal px-6 py-3 text-sm font-bold text-white hover:bg-teal-dark"
          >
            Back home
          </Link>
          <Link
            href="/activities"
            className="rounded-xl border border-ink/15 px-6 py-3 text-sm font-bold text-ink hover:border-teal hover:text-teal"
          >
            Browse activities
          </Link>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
