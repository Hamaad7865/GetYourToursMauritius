import type { Metadata } from 'next';
import Link from 'next/link';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Price } from '@/components/site/Price';
import { getDemoPackage } from '@/components/photo-demo/data';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Photo demo — booking confirmed',
  robots: { index: false },
};

export default async function PhotoDemoConfirmationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams;
  const pkg = getDemoPackage(q.pkg ?? '');
  const ref = q.ref ?? 'BMT-PHOTO-DEMO';
  const date = q.date
    ? new Date(`${q.date}T12:00:00`).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;
  const deposit = Number(q.deposit ?? 0);
  const total = Number(q.total ?? 0);

  return (
    <>
      <GygHeader />
      <main className="bg-white text-ink">
        <div className="mx-auto max-w-[720px] px-6 py-14 text-center sm:py-20">
          <p className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-teal-tint text-3xl text-teal-dark">
            ✓
          </p>
          <h1 className="mt-6 text-balance text-[clamp(28px,4vw,44px)] font-extrabold tracking-tight">
            {q.name ? `${q.name.split(' ')[0]}, your date is held.` : 'Your date is held.'}
          </h1>
          <p className="mx-auto mt-4 max-w-[52ch] text-[15px] leading-relaxed text-ink-muted">
            Booking <b className="text-ink">{ref}</b> is confirmed with the deposit paid.
            A receipt and the shoot details are on their way to your inbox.
          </p>

          <div className="mt-10 rounded-card border border-ink/10 bg-white p-6 text-left shadow-[0_4px_18px_-6px_rgba(10,46,54,0.08)]">
            <div className="flex items-center gap-4">
              {pkg && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pkg.image} alt="" className="h-20 w-20 rounded-xl object-cover" />
              )}
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-teal-dark">
                  {pkg?.category ?? 'Photography'}
                </p>
                <h2 className="mt-0.5 text-lg font-extrabold tracking-tight">
                  {pkg?.title ?? 'Photoshoot'}
                </h2>
              </div>
            </div>
            <ul className="mt-5 space-y-2 border-t border-ink/10 pt-4 text-sm">
              {date && (
                <li className="flex justify-between">
                  <span className="text-ink-muted">Date</span>
                  <b>{date}</b>
                </li>
              )}
              {q.slot && (
                <li className="flex justify-between">
                  <span className="text-ink-muted">Slot</span>
                  <b className="capitalize">{q.slot}</b>
                </li>
              )}
              <li className="flex justify-between">
                <span className="text-ink-muted">Paid today (50% deposit)</span>
                <b className="text-teal-dark">
                  <Price eur={deposit} />
                </b>
              </li>
              <li className="flex justify-between">
                <span className="text-ink-muted">Balance due on delivery</span>
                <b>
                  <Price eur={total - deposit} />
                </b>
              </li>
            </ul>
          </div>

          <div className="mt-8 rounded-card bg-teal-tint p-6 text-left">
            <h2 className="text-[15px] font-extrabold tracking-tight">What happens next</h2>
            <ul className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-ink-muted">
              <li>· Your photographer confirms the meeting point within 24 hours.</li>
              <li>· Sneak peek lands within 48 hours of the shoot.</li>
              <li>· The full gallery follows in 5 days — the balance is due only then.</li>
            </ul>
          </div>

          <div className="mt-10 flex flex-wrap justify-center gap-3">
            <Link
              href="/photo-demo"
              className="rounded-full bg-teal px-7 py-3.5 text-sm font-bold text-white transition hover:bg-teal-dark"
            >
              Back to packages
            </Link>
            <Link
              href="/photography/gallery"
              className="rounded-full border-[1.5px] border-ink/10 px-7 py-3.5 text-sm font-bold text-ink transition hover:border-teal hover:text-teal-dark"
            >
              Browse the gallery
            </Link>
          </div>
          <p className="mt-8 text-xs text-ink-muted">
            Demo flow — no booking was created and no card was charged.
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
