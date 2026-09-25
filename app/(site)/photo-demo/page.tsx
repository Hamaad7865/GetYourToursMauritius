import type { Metadata } from 'next';
import Link from 'next/link';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { Price } from '@/components/site/Price';
import { DEMO_PACKAGES } from '@/components/photo-demo/data';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'Photo demo — package-first photography page',
  robots: { index: false },
};

const TEASER = [
  { src: '/photography/wedding-beach.jpg', caption: 'Belle Mare' },
  { src: '/photography/family-2.jpg', caption: 'Trou d’Eau Douce' },
  { src: '/photography/wedding-detail.jpg', caption: 'The details' },
  { src: '/photography/family.jpg', caption: 'Palmar' },
  { src: '/photography/film.jpg', caption: 'From the film' },
];

/** Demo of the package-first photography redesign (mockup v3) with static data. */
export default function PhotoDemoPage() {
  return (
    <>
      <GygHeader />
      <main className="bg-white text-ink">
        {/* Hero — compact, light, site-accented */}
        <section className="mx-auto grid max-w-shell items-center gap-10 px-6 py-12 sm:py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-teal-dark">
              Photography &amp; film · Mauritius
            </p>
            <h1 className="mt-4 text-balance text-[clamp(34px,4.6vw,58px)] font-extrabold leading-[1.04] tracking-tight">
              Photoshoots in Mauritius, <span className="text-teal">booked like a tour.</span>
            </h1>
            <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-ink-muted">
              A local photographer for weddings on the sand, honeymoons at golden hour and the
              whole family in one frame. Pick a package, pick a date — we take care of the photos.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href="#packages"
                className="inline-flex items-center gap-2 rounded-full bg-teal px-7 py-3.5 text-sm font-bold text-white transition hover:bg-teal-dark"
              >
                See the packages
              </a>
              <a
                href="#"
                className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink/10 bg-white px-7 py-3.5 text-sm font-bold text-ink transition hover:border-teal hover:text-teal-dark"
              >
                Ask us on WhatsApp
              </a>
            </div>
            <div className="mt-9 flex flex-wrap gap-x-11 gap-y-4 text-[12.5px] text-ink-muted">
              <div>
                <b className="block text-[17px] font-extrabold text-ink">250+</b> shoots
                photographed
              </div>
              <div>
                <b className="block text-[17px] font-extrabold text-ink">
                  <span className="text-gold-light">★</span> 4.9
                </b>
                from travelling couples
              </div>
              <div>
                <b className="block text-[17px] font-extrabold text-ink">48 h</b> sneak-peek
                delivery
              </div>
            </div>
          </div>
          <div className="relative overflow-hidden rounded-[26px] shadow-[0_30px_70px_-30px_rgba(10,46,54,0.4)]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/photography/wedding-sunset.jpg"
              alt="Bride and groom walking along a Belle Mare beach at sunset"
              className="aspect-[4/3.4] h-full w-full object-cover"
            />
            <div className="absolute bottom-4 left-4 flex max-w-[85%] items-center gap-3 rounded-2xl bg-white/95 p-3.5 shadow-lg backdrop-blur">
              <span aria-hidden className="text-xl">📷</span>
              <p className="text-xs leading-snug text-ink-muted">
                <b className="block text-[13.5px] text-ink">Your photographer lives here.</b>
                We know where the light lands, every month of the year.
              </p>
            </div>
          </div>
        </section>

        {/* Packages — the dominant section */}
        <section id="packages" className="mx-auto max-w-shell scroll-mt-24 px-6 pb-16 sm:pb-20">
          <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-[clamp(26px,3.2vw,38px)] font-extrabold tracking-tight">
                Photography packages
              </h2>
              <p className="mt-1.5 text-sm text-ink-muted">
                {DEMO_PACKAGES.length} experiences · 50% deposit holds your date
              </p>
            </div>
            <Link
              href="/photography/gallery"
              className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink/10 px-5 py-2.5 text-[13.5px] font-bold transition hover:border-teal hover:bg-teal-tint hover:text-teal-dark"
            >
              See the gallery →
            </Link>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {DEMO_PACKAGES.map((pkg) => (
              <Link
                key={pkg.slug}
                href={`/photo-demo/${pkg.slug}`}
                className="group flex flex-col overflow-hidden rounded-card border border-ink/10 bg-white shadow-[0_4px_18px_-6px_rgba(10,46,54,0.08)] transition hover:-translate-y-1 hover:shadow-[0_24px_50px_-18px_rgba(10,46,54,0.25)]"
              >
                <div className="relative aspect-[4/3] overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={pkg.image}
                    alt={pkg.title}
                    className="h-full w-full object-cover transition duration-700 group-hover:scale-105"
                  />
                  <span className="absolute left-3.5 top-3.5 rounded-full bg-white/95 px-3.5 py-1.5 text-xs font-bold text-ink shadow">
                    {pkg.category}
                  </span>
                  {pkg.bestSeller && (
                    <span className="absolute left-3.5 top-[52px] rounded-full bg-coral px-3 py-1.5 text-[10.5px] font-extrabold uppercase tracking-widest text-white">
                      Best seller
                    </span>
                  )}
                  {pkg.isNew && (
                    <span className="absolute left-3.5 top-[52px] rounded-full bg-ink/85 px-3 py-1.5 text-[10.5px] font-extrabold uppercase tracking-widest text-white">
                      New
                    </span>
                  )}
                  <span className="absolute right-3.5 top-3.5 grid h-9 w-9 place-items-center rounded-full bg-white/95 text-ink shadow">
                    ♡
                  </span>
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <p className="text-[10.5px] font-extrabold uppercase tracking-[0.18em] text-teal-dark">
                    {pkg.category}
                  </p>
                  <h3 className="mt-1.5 text-[19px] font-extrabold leading-tight tracking-tight">
                    {pkg.title}
                  </h3>
                  <p className="mt-1 text-[12.5px] italic text-ink-muted">“{pkg.mood}”</p>
                  <p className="mt-2 text-xs text-ink-muted">{pkg.meta}</p>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {pkg.features.map((f) => (
                      <li
                        key={f}
                        className="rounded-full bg-teal-tint px-2.5 py-1 text-[11px] font-semibold text-teal-dark"
                      >
                        {f}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-4 flex items-center justify-between gap-3 pt-3">
                    <p className="text-xs font-bold">
                      <span className="text-gold-light">★</span> {pkg.rating.toFixed(1)}{' '}
                      <span className="font-medium text-ink-muted">({pkg.reviews})</span>
                    </p>
                    <p className="text-xs text-ink-muted">
                      From{' '}
                      <b className="text-lg font-extrabold tracking-tight text-ink">
                        <Price eur={pkg.priceEur} />
                      </b>
                    </p>
                  </div>
                  <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-ink/10 pt-3.5">
                    <span className="rounded-full bg-teal px-4 py-2 text-xs font-bold text-white transition group-hover:bg-teal-dark">
                      See this package →
                    </span>
                    <span className="text-[11px] text-ink-muted">50% today · rest on delivery</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Gallery teaser — links to the real gallery page */}
        <section className="border-t border-ink/10 py-14 sm:py-16">
          <div className="mx-auto max-w-shell px-6">
            <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-[clamp(26px,3.2vw,38px)] font-extrabold tracking-tight">
                  The look
                </h2>
                <p className="mt-1.5 text-sm text-ink-muted">
                  A few frames — the full gallery lives on its own page
                </p>
              </div>
              <Link
                href="/photography/gallery"
                className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-ink/10 px-5 py-2.5 text-[13.5px] font-bold transition hover:border-teal hover:bg-teal-tint hover:text-teal-dark"
              >
                See all →
              </Link>
            </div>
            <div className="grid auto-cols-[minmax(190px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-3">
              {TEASER.map((photo) => (
                <figure
                  key={photo.src}
                  className="relative aspect-[3/3.6] overflow-hidden rounded-card border border-ink/10"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photo.src}
                    alt={photo.caption}
                    loading="lazy"
                    className="h-full w-full object-cover transition duration-700 hover:scale-105"
                  />
                  <figcaption className="absolute bottom-2.5 left-3 rounded-full bg-white/90 px-3 py-1 text-[10.5px] font-bold uppercase tracking-wider text-ink">
                    {photo.caption}
                  </figcaption>
                </figure>
              ))}
              <Link
                href="/photography/gallery"
                className="flex flex-col items-center justify-center gap-3 rounded-card border-2 border-dashed border-ink/10 p-5 text-center transition hover:border-teal hover:bg-teal-tint"
              >
                <span className="text-[19px] font-extrabold leading-snug tracking-tight text-teal-dark">
                  See the
                  <br />
                  full gallery
                </span>
                <span className="text-xl text-teal">⟶</span>
              </Link>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="bg-teal-tint py-14 sm:py-16">
          <div className="mx-auto max-w-shell px-6">
            <h2 className="text-[clamp(26px,3.2vw,38px)] font-extrabold tracking-tight">
              Booked in three moves
            </h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              Just like booking a tour — no email ping-pong
            </p>
            <div className="mt-9 grid gap-6 md:grid-cols-3">
              {[
                ['Choose your package', 'Pick one above — or message us and we’ll shape one around your plans.'],
                ['Pick a date, pay 50%', 'Your deposit reserves the day. Sunrise and sunset slots go first, so don’t sit on it.'],
                ['Balance on delivery', 'You pay the rest only when your gallery lands. Sneak peek within 48 hours, full set in 5 days.'],
              ].map(([title, body], i) => (
                <div key={title} className="rounded-card border border-ink/10 bg-white p-6">
                  <p className="grid h-10 w-10 place-items-center rounded-full bg-teal text-[15px] font-extrabold text-white">
                    {i + 1}
                  </p>
                  <h3 className="mt-4 text-[16.5px] font-extrabold tracking-tight">{title}</h3>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-ink-muted">{body}</p>
                </div>
              ))}
            </div>
            <div className="mt-8 max-w-[660px] rounded-2xl border border-ink/10 border-l-4 border-l-coral bg-white p-5 text-[13.5px] text-ink-muted">
              <b className="text-ink">50% today, 50% when the photos arrive.</b> No full
              prepayments, no fine print — the deposit simply holds your date.
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-16 text-center sm:py-24">
          <div className="mx-auto max-w-shell px-6">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-teal-dark">
              Dates for this season are open
            </p>
            <h2 className="mt-3.5 text-balance text-[clamp(30px,4.4vw,52px)] font-extrabold leading-[1.06] tracking-tight">
              Bring home more
              <br />
              than a <span className="text-teal">tan.</span>
            </h2>
            <p className="mx-auto mt-4 max-w-[46ch] text-sm leading-relaxed text-ink-muted">
              Tell us your dates and which package caught your eye — we’ll confirm availability
              and hold your slot the same day.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <a
                href="#packages"
                className="inline-flex items-center rounded-full bg-teal px-7 py-3.5 text-sm font-bold text-white transition hover:bg-teal-dark"
              >
                Check your date
              </a>
              <a
                href="#"
                className="inline-flex items-center rounded-full border-[1.5px] border-ink/10 bg-white px-7 py-3.5 text-sm font-bold text-ink transition hover:border-teal hover:text-teal-dark"
              >
                WhatsApp us instead
              </a>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
