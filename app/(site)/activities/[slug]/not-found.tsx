import Link from 'next/link';
import { SiteHeader } from '@/components/site/SiteHeader';
import { SiteFooter } from '@/components/site/SiteFooter';

export const runtime = 'edge';

export default function ActivityNotFound() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex max-w-shell flex-col items-center px-6 py-24 text-center">
        <p className="text-sm font-bold uppercase tracking-wider text-teal">404</p>
        <h1 className="mt-3 font-display text-4xl font-medium tracking-tight text-ink">
          We couldn&apos;t find that activity
        </h1>
        <p className="mt-3 max-w-md text-ink-muted">
          It may have been unpublished or the link is out of date. Browse everything Belle Mare
          Tours runs on the east coast instead.
        </p>
        <Link
          href="/activities"
          className="mt-7 rounded-xl bg-teal px-6 py-3 text-sm font-bold text-white hover:bg-teal-dark"
        >
          Browse all activities
        </Link>
      </main>
      <SiteFooter />
    </>
  );
}
