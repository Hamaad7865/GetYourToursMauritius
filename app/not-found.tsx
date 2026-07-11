import Link from 'next/link';

// The global 404 is self-contained — no providers, no hooks — so the root layout stays STATIC and the
// Cloudflare (next-on-pages) build can ship /_not-found as a static route. (Real pages get the full
// header/footer + localisation via app/(site)/layout.tsx.)
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[80vh] max-w-shell flex-col items-center justify-center px-6 py-24 text-center">
      <span className="font-display text-2xl font-semibold tracking-tight text-teal">
        GetYourTours <span className="text-ink">Mauritius</span>
      </span>
      <p className="mt-10 text-sm font-bold uppercase tracking-wider text-teal">404</p>
      <h1 className="mt-3 font-display text-4xl font-medium tracking-tight text-ink">
        We couldn&apos;t find that page
      </h1>
      <p className="mt-3 max-w-md text-ink-muted">
        The link may be out of date. Head back home, or browse the tours and activities Belle Mare
        Tours runs across Mauritius.
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
  );
}
