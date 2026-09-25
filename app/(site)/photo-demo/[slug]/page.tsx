import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Price } from '@/components/site/Price';
import { IconCheck } from '@/components/ui/icons';
import { DEMO_PACKAGES, getDemoPackage } from '@/components/photo-demo/data';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Photo demo — package',
  robots: { index: false },
};

function SpecTick({ children, strong = false }: { children: React.ReactNode; strong?: boolean }) {
  return (
    <li
      className={`flex items-center gap-3 py-2.5 text-[13.5px] leading-snug ${
        strong ? 'font-bold text-ink' : 'font-semibold text-ink/85'
      }`}
    >
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full border-[1.5px] border-teal-dark text-teal-dark">
        <IconCheck width={11} height={11} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

export default async function PhotoDemoPackagePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const pkg = getDemoPackage(slug);
  if (!pkg) notFound();
  const others = DEMO_PACKAGES.filter((p) => p.slug !== pkg.slug).slice(0, 3);

  return (
    <>
      <GygHeader />
      <main className="bg-white text-ink">
        <div className="mx-auto max-w-shell px-6 py-8 sm:py-10">
          <nav className="mb-6 text-[13px] text-ink-muted">
            <Link href="/photo-demo" className="font-semibold text-teal-dark hover:underline">
              Photography
            </Link>
            <span className="mx-2">/</span>
            <span>{pkg.title}</span>
          </nav>

          <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-12">
            <div className="min-w-0">
              {/* Gallery: lead frame + two-up below */}
              <div className="overflow-hidden rounded-card border border-ink/10">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={pkg.gallery[0]?.src ?? pkg.image}
                  alt={pkg.title}
                  className="aspect-[16/9] w-full object-cover"
                />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4">
                {pkg.gallery.slice(1).map((photo) => (
                  <figure
                    key={photo.src}
                    className="relative overflow-hidden rounded-card border border-ink/10"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={photo.src}
                      alt={photo.caption}
                      loading="lazy"
                      className="aspect-[16/10] w-full object-cover"
                    />
                    <figcaption className="absolute bottom-2.5 left-3 rounded-full bg-white/90 px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider text-ink">
                      {photo.caption}
                    </figcaption>
                  </figure>
                ))}
              </div>

              <p className="mt-7 text-base leading-relaxed text-ink/80">{pkg.summary}</p>

              <section className="mt-6 border-t border-ink/10 pt-6">
                <h2 className="text-lg font-bold text-ink">Includes</h2>
                <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink/80">
                  {pkg.includes.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </section>

              <Link
                href="/photography/gallery"
                className="mt-6 inline-block text-sm font-bold text-teal-dark underline underline-offset-4"
              >
                View full gallery
              </Link>
            </div>

            {/* Sticky price card — same slot as the real detail page */}
            <aside className="rounded-xl border border-ink/15 p-6 text-center lg:sticky lg:top-6">
              <h2 className="text-xl font-bold text-ink">{pkg.title}</h2>
              {pkg.bestSeller && (
                <p className="mt-1.5 text-[11px] font-extrabold uppercase tracking-[0.2em] text-coral">
                  Best seller
                </p>
              )}
              <p className="mt-5 text-sm text-ink-muted">From</p>
              <div className="text-5xl font-extrabold tracking-tight text-ink">
                <Price eur={pkg.priceEur} />
              </div>
              <p className="mt-2 text-[13px] font-semibold text-ink-muted">
                <span className="text-gold-light">★</span> {pkg.rating.toFixed(1)} · {pkg.reviews}{' '}
                reviews
              </p>
              <ul className="mt-5 divide-y divide-ink/10 border-y border-ink/10 text-left">
                <SpecTick>{pkg.durationLabel}</SpecTick>
                {pkg.photoCount > 0 && <SpecTick>Up to {pkg.photoCount} edited photos</SpecTick>}
                <SpecTick>{pkg.location}</SpecTick>
                <SpecTick>{pkg.delivery}</SpecTick>
                {pkg.addOns.length > 0 && (
                  <SpecTick strong>
                    Optional add-ons: {pkg.addOns.map((a) => a.name).join(', ')}
                  </SpecTick>
                )}
                <SpecTick>50% now, 50% when your photos are delivered</SpecTick>
              </ul>
              <Link
                href={`/photo-demo/${pkg.slug}/book`}
                className="mt-6 flex w-full items-center justify-center rounded-full bg-teal-dark px-7 py-4 text-base font-extrabold uppercase tracking-wide text-white hover:bg-teal-dark/90"
              >
                Book now
              </Link>
              <p className="mt-3 text-xs text-ink-muted">
                Only <Price eur={Math.round(pkg.priceEur / 2)} /> today — the rest on delivery
              </p>
            </aside>
          </div>

          {/* Other packages */}
          <section className="mt-16 border-t border-ink/10 pt-10">
            <h2 className="text-[clamp(24px,3vw,34px)] font-extrabold tracking-tight">
              Other packages
            </h2>
            <div className="mt-7 grid gap-6 sm:grid-cols-3">
              {others.map((p) => (
                <Link
                  key={p.slug}
                  href={`/photo-demo/${p.slug}`}
                  className="group overflow-hidden rounded-card border border-ink/10 bg-white shadow-[0_4px_18px_-6px_rgba(10,46,54,0.08)] transition hover:-translate-y-1 hover:shadow-[0_24px_50px_-18px_rgba(10,46,54,0.25)]"
                >
                  <div className="aspect-[16/10] overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={p.image}
                      alt={p.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                    />
                  </div>
                  <div className="p-5">
                    <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-teal-dark">
                      {p.category}
                    </p>
                    <h3 className="mt-1.5 text-lg font-extrabold tracking-tight">{p.title}</h3>
                    <p className="mt-2 text-[12.5px] text-ink-muted">
                      From{' '}
                      <b className="text-base font-extrabold text-ink">
                        <Price eur={p.priceEur} />
                      </b>
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
