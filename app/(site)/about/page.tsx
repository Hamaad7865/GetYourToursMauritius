import type { Metadata } from 'next';
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { Bricolage_Grotesque, Hanken_Grotesk } from 'next/font/google';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbListJsonLd, faqPageJsonLd } from '@/lib/seo/jsonld';
import { SITE, whatsappUrl } from '@/lib/seo/site';
import { getT } from '@/lib/i18n/server';
import { RevealOnScroll } from '@/components/about/RevealOnScroll';
import { HeroWaves } from '@/components/about/HeroWaves';

export const runtime = 'edge';

/* The design's two signature faces. Bricolage Grotesque carries every heading; Hanken
   Grotesk is the body face. Both exposed as CSS vars and scoped to this page only. */
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-about-display',
  display: 'swap',
});

const bodyFont = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-about-body',
  display: 'swap',
});

// Brand hexes, kept literal so the page is pixel-faithful to the handoff (a couple of the
// app’s shared tokens — cream/ink/gold — drift from the design, so we avoid them here).
const TEAL = '#0E8C92';
const TEAL_DARK = '#0B5C63';
const CORAL = '#F76C5E';
const GOLD = '#E9B949';
const CREAM = '#FBF7EF';
const INK = '#11201F';

/** Heading helper: applies the Bricolage display face inline. */
const displayFont = { fontFamily: 'var(--font-about-display), sans-serif' } as const;

const metaTitle = `About Belle Mare Tours — your local Mauritius tour operator | GetYourToursMauritius`;
const metaDescription = `Belle Mare Tours Ltd is a licensed Mauritian tour & airport-transfer operator on the east coast, run by veteran driver-guides Noorani and Satar. Book direct for transparent fixed EUR prices, the same guide all day, and door-to-door pickup island-wide.`;

export const metadata: Metadata = {
  title: metaTitle,
  description: metaDescription,
  alternates: { canonical: '/about' },
  openGraph: {
    type: 'website',
    title: metaTitle,
    description: metaDescription,
    url: `${SITE.url}/about`,
    images: [{ url: `${SITE.url}/hero/islands/aerial-lagoon.jpg` }],
  },
};

/* ── small inline icon primitives (matching the prototype's SVGs) ─────────────── */

function ArrowIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PinIcon({ color }: { color: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5C5.2 1.5 3 3.7 3 6.4 3 10 8 14.5 8 14.5S13 10 13 6.4C13 3.7 10.8 1.5 8 1.5z"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="6.3" r="1.7" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

/* ── reusable bits ────────────────────────────────────────────────────────────── */

function Eyebrow({ children, color = TEAL }: { children: ReactNode; color?: string }) {
  return (
    <span
      className="text-[13px] font-bold uppercase tracking-[0.2em]"
      style={{ color }}
    >
      {children}
    </span>
  );
}

function ChevronDown() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 8l5 5 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default async function AboutPage() {
  const t = await getT();

  const trust = [
    {
      tintBg: 'rgba(14,140,146,0.12)',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2l7 3v6c0 4.5-3 8-7 11-4-3-7-6.5-7-11V5l7-3z" stroke={TEAL} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M8.5 12l2.2 2.2L15.5 9.5" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: t('Tourism Authority licensed'),
      blurb: t('Approved & licensed by the Mauritius Tourism Authority.'),
      delay: 0,
    },
    {
      tintBg: 'rgba(233,185,73,0.18)',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 2.5l2.7 6 6.6.6-5 4.3 1.5 6.4L12 16.9 6.2 19.8l1.5-6.4-5-4.3 6.6-.6L12 2.5z" fill={GOLD} />
        </svg>
      ),
      title: t('4.8★ from 1,000+ reviews'),
      blurb: t('Rated across TripAdvisor & Google by real travellers.'),
      delay: 80,
    },
    {
      tintBg: 'rgba(14,140,146,0.12)',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="8" r="3.4" stroke={TEAL} strokeWidth="1.8" />
          <path d="M5.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      ),
      title: t('The same guide all day'),
      blurb: t('One driver-guide, door to door — never passed between taxis.'),
      delay: 160,
    },
    {
      tintBg: 'rgba(247,108,94,0.14)',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M3 11l9-7 9 7" stroke={CORAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 10v9h14v-9" stroke={CORAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10 19v-5h4v5" stroke={CORAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: t('Book direct, no commission'),
      blurb: t('No reseller mark-up — so your price stays lower.'),
      delay: 240,
    },
  ];

  // The six "What we offer" cards. Five neutral, the sixth a teal gradient.
  const offers = [
    {
      href: '/activities',
      tintBg: 'rgba(14,140,146,0.12)',
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M5 19l3-6 5-2 6-9" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="5" cy="19" r="2" stroke={TEAL} strokeWidth="1.8" />
          <circle cx="19" cy="4" r="2" stroke={TEAL} strokeWidth="1.8" />
        </svg>
      ),
      title: t('Private Sightseeing Tours of Mauritius'),
      blurb: t('Your own driver-guide and vehicle, north to south, at your pace.'),
      cta: t('Explore tours'),
      ctaColor: TEAL,
      delay: 0,
    },
    {
      href: '/activities',
      tintBg: 'rgba(14,140,146,0.12)',
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3v9M12 5l6 2-6 3-6-3 6-2z" stroke={TEAL} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M3 16c1.5 1.5 3 1.5 4.5 0S10.5 14.5 12 16s3 1.5 4.5 0S19.5 14.5 21 16" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 20c1.3 1.3 2.7 1.3 4 0s2.7-1.3 4 0 2.7 1.3 4 0" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: t('Catamaran Cruises & Île aux Cerfs'),
      blurb: t('Sail the east-coast lagoon to the island’s most loved beach.'),
      cta: t('View cruises'),
      ctaColor: TEAL,
      delay: 70,
    },
    {
      href: '/activities',
      tintBg: 'rgba(14,140,146,0.12)',
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 14c4 0 5-3 8-3s4 3 8 3c-1 4-4 6-8 6s-7-2-8-6z" stroke={TEAL} strokeWidth="1.8" strokeLinejoin="round" />
          <path d="M12 11c0-3 1-5 4-6-1 2-1 3 0 4" stroke={TEAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: t('Dolphin Swims in Tamarin Bay'),
      blurb: t('An early west-coast start to meet wild dolphins offshore.'),
      cta: t('See the trip'),
      ctaColor: TEAL,
      delay: 140,
    },
    {
      href: '/airport-transfers',
      tintBg: 'rgba(247,108,94,0.14)',
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M4 14l1.5-5A2 2 0 017.4 7.5h9.2A2 2 0 0118.5 9L20 14" stroke={CORAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 14h18v4H3z" stroke={CORAL} strokeWidth="1.8" strokeLinejoin="round" />
          <circle cx="7" cy="18.5" r="1.4" fill={CORAL} />
          <circle cx="17" cy="18.5" r="1.4" fill={CORAL} />
        </svg>
      ),
      title: t('Airport Transfers & Door-to-Door Pickup'),
      blurb: t('Clean, modern minivans meeting you at arrivals — fixed fares.'),
      cta: t('Get a transfer'),
      ctaColor: CORAL,
      delay: 0,
    },
    {
      href: '/rent',
      tintBg: 'rgba(233,185,73,0.2)',
      icon: (
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="6" cy="17" r="3" stroke={INK} strokeWidth="1.8" />
          <circle cx="18" cy="17" r="3" stroke={INK} strokeWidth="1.8" />
          <path d="M9 17h6M6 17l4-7h4l2 4" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13 10l-1-3h-2" stroke={INK} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ),
      title: t('Car & Scooter Rental in Mauritius'),
      blurb: t('Want to explore solo? Pick up wheels through the same local team.'),
      cta: t('View rentals'),
      ctaColor: TEAL,
      delay: 70,
    },
  ];

  const regions = [
    {
      tag: t('North'),
      title: t('Grand Baie & Pamplemousses'),
      blurb: t('Cap Malheureux, the botanical garden & northern islets.'),
      delay: 0,
    },
    {
      tag: t('East · home'),
      title: t('Belle Mare & Île aux Cerfs'),
      blurb: t('Our home shore — Trou d’Eau Douce & the calm lagoons.'),
      delay: 60,
      highlight: true,
    },
    {
      tag: t('South'),
      title: t('Le Morne & Chamarel'),
      blurb: t('Seven Coloured Earths, Black River Gorges & Gris Gris.'),
      delay: 120,
    },
    {
      tag: t('West'),
      title: t('Tamarin & Flic en Flac'),
      blurb: t('Dolphin bay, the sunset coast & Casela nature park.'),
      delay: 180,
    },
    {
      tag: t('Central'),
      title: t('Port Louis & the highlands'),
      blurb: t('The capital’s markets, Trou aux Cerfs & Plaine Champagne.'),
      delay: 240,
    },
  ];

  const faqs = [
    {
      q: t('Is Belle Mare Tours licensed?'),
      a: t('Yes. Belle Mare Tours Ltd is approved and licensed by the Mauritius Tourism Authority, run by veteran local driver-guides Noorani and Satar, based in Belle Mare on the east coast.'),
    },
    {
      q: t('Which areas of Mauritius do you cover?'),
      a: t('We operate island-wide — North, East, South, West and Central — with door-to-door pickup from any hotel, Airbnb or cruise port.'),
    },
    {
      q: t('Do you pick up from my hotel and the airport?'),
      a: t('Yes. We offer door-to-door pickup from any hotel, Airbnb or cruise port island-wide, as well as airport arrivals and transfers.'),
    },
    {
      q: t('Are your tours private?'),
      a: t('Yes. The same English- and French-speaking driver-guide looks after you all day — you are never passed between taxis.'),
    },
    {
      q: t('How do I pay?'),
      a: t('Prices are transparent and fixed in EUR, shown up front. You pay securely by card and receive instant e-voucher confirmation.'),
    },
    {
      q: t('What is your cancellation policy?'),
      a: t('Free cancellation up to 24 hours before your booking.'),
    },
  ];

  const cardBase = `group flex flex-col gap-3.5 rounded-[22px] border p-[28px_26px] no-underline transition duration-300 hover:-translate-y-[7px]`;

  return (
    <div className={`${display.variable} ${bodyFont.variable} overflow-x-hidden`} style={{ fontFamily: 'var(--font-about-body), system-ui, sans-serif', color: INK, background: CREAM }}>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'About', path: '/about' },
        ])}
      />
      <JsonLd data={faqPageJsonLd(faqs)} />
      <RevealOnScroll />

      <GygHeader />

      <main>
        {/* ============ HERO ============ */}
        <section
          id="top"
          className="relative flex items-end overflow-hidden"
          style={{ minHeight: 'clamp(580px, 90vh, 840px)' }}
        >
          <HeroWaves />
          <div
            className="relative z-[2] mx-auto w-full max-w-shell"
            style={{ padding: 'clamp(40px,8vw,96px) clamp(18px,5vw,72px) clamp(120px,12vw,160px)' }}
          >
            <div className="max-w-[760px]">
              <span
                className="inline-flex items-center gap-[9px] font-bold uppercase tracking-[0.2em]"
                style={{ color: GOLD, fontSize: 'clamp(11px,1.4vw,13px)' }}
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M8 1l1.6 3.6L13.5 5l-2.8 2.9.7 4L8 9.9 4.6 12l.7-4L2.5 5l3.9-.4L8 1z"
                    stroke={GOLD}
                    strokeWidth="1.3"
                    strokeLinejoin="round"
                  />
                </svg>
                {t('About Belle Mare Tours')}
              </span>
              <h1
                className="m-0 mt-[18px] font-extrabold text-white"
                style={{
                  ...displayFont,
                  fontSize: 'clamp(38px,7.2vw,82px)',
                  lineHeight: 1.02,
                  letterSpacing: '-0.02em',
                  textWrap: 'balance',
                }}
              >
                {t('Mauritius, shown to you by the people who live here')}
              </h1>
              <p
                className="mt-[22px] max-w-[620px] text-white/90"
                style={{ fontSize: 'clamp(17px,2vw,21px)', lineHeight: 1.6, textWrap: 'pretty' }}
              >
                {t('We’re Belle Mare Tours — a licensed east-coast operator run by veteran driver-guides Noorani & Satar. Book direct with the team that actually drives the roads, for fixed prices and a guide who stays with you all day.')}
              </p>
              <div className="mt-[30px] flex flex-wrap gap-3">
                <Link
                  href="/activities"
                  className="inline-flex items-center gap-[9px] rounded-full px-7 py-[15px] text-base font-bold text-white no-underline transition hover:-translate-y-0.5"
                  style={{ background: CORAL, boxShadow: '0 12px 30px rgba(247,108,94,0.4)' }}
                >
                  {t('Browse tours')}
                  <ArrowIcon />
                </Link>
                <Link
                  href="#story"
                  className="inline-flex items-center gap-[9px] rounded-full border px-[26px] py-[15px] text-base font-semibold text-white no-underline backdrop-blur-[6px] transition"
                  style={{ background: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.35)' }}
                >
                  {t('Read our story')}
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ============ TRUST STRIP ============ */}
        <section
          aria-label={t('Why travellers trust us')}
          className="relative z-[5] mx-auto max-w-shell"
          style={{ marginTop: 'clamp(-90px,-9vw,-110px)', padding: '0 clamp(18px,5vw,72px)' }}
        >
          <div
            className="grid gap-[clamp(12px,1.5vw,18px)]"
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(220px, 1fr))` }}
          >
            {trust.map((item) => (
              <div
                key={item.title}
                data-reveal
                data-reveal-delay={item.delay}
                className="rounded-[20px] border bg-white p-[24px_22px] transition duration-300 hover:-translate-y-1.5"
                style={{
                  borderColor: 'rgba(17,32,31,0.07)',
                  boxShadow: '0 18px 44px rgba(11,92,99,0.12)',
                }}
              >
                <div
                  className="mb-3.5 flex h-11 w-11 items-center justify-center rounded-xl"
                  style={{ background: item.tintBg }}
                >
                  {item.icon}
                </div>
                <h3 className="m-0 mb-[5px] text-[18px] font-bold tracking-[-0.01em]" style={displayFont}>
                  {item.title}
                </h3>
                <p className="m-0 text-[14.5px] leading-[1.5]" style={{ color: 'rgba(17,32,31,0.66)' }}>
                  {item.blurb}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ============ OUR STORY ============ */}
        <section
          id="story"
          className="mx-auto max-w-shell scroll-mt-24"
          style={{ padding: 'clamp(72px,11vw,140px) clamp(18px,5vw,72px) clamp(40px,6vw,72px)' }}
        >
          <div
            className="grid items-center gap-[clamp(32px,5vw,72px)]"
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(300px, 1fr))` }}
          >
            <div data-reveal>
              <Eyebrow>{t('Our story')}</Eyebrow>
              <h2
                className="m-0 mt-3.5 font-bold"
                style={{ ...displayFont, fontSize: 'clamp(30px,4.4vw,52px)', lineHeight: 1.06, letterSpacing: '-0.02em', textWrap: 'balance' }}
              >
                {t('Two driver-guides, one island they know by heart')}
              </h2>
              <p className="mt-[22px]" style={{ fontSize: 'clamp(16px,1.7vw,18.5px)', lineHeight: 1.65, color: 'rgba(17,32,31,0.78)', textWrap: 'pretty' }}>
                {t('Noorani and Satar have spent their lives on Mauritian roads — two of the island’s most experienced driver-guides, based where the day begins, in Belle Mare on the east coast.')}
              </p>
              <p className="mt-4" style={{ fontSize: 'clamp(16px,1.7vw,18.5px)', lineHeight: 1.65, color: 'rgba(17,32,31,0.78)', textWrap: 'pretty' }}>
                {t('Over the years they grew a trusted local operation on one simple promise: the same driver-guide looks after you from morning pickup to evening drop-off. You’re never handed between taxis, never left waiting, never sold a detour you didn’t ask for.')}
              </p>
              <p className="mt-4" style={{ fontSize: 'clamp(16px,1.7vw,18.5px)', lineHeight: 1.65, color: 'rgba(17,32,31,0.78)', textWrap: 'pretty' }}>
                {t('The Mauritius they show you is the one they grew up with — the still lagoons off Belle Mare, a catamaran out to Île aux Cerfs, dolphins at first light in Tamarin Bay, and the colour of the Port Louis markets.')}
              </p>
            </div>

            {/* photo collage */}
            <div data-reveal className="relative">
              <div
                className="relative overflow-hidden rounded-[24px]"
                style={{ boxShadow: '0 30px 60px rgba(11,92,99,0.22)', aspectRatio: '4 / 5' }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/hero/islands/speedboat.jpg"
                  alt={t('A speedboat crossing calm turquoise water off the Mauritius coast')}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
              <div
                className="absolute overflow-hidden rounded-[18px]"
                style={{
                  bottom: '-26px',
                  left: '-22px',
                  width: '46%',
                  border: `5px solid ${CREAM}`,
                  boxShadow: '0 22px 44px rgba(17,32,31,0.22)',
                  aspectRatio: '1 / 1',
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/activities/pereybere-beach.jpg"
                  alt={t('Sunlit shallows breaking over pale sand on a Mauritius beach')}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
              <div
                className="absolute"
                style={{
                  top: '-18px',
                  right: '-10px',
                  background: GOLD,
                  color: INK,
                  borderRadius: '16px',
                  padding: `13px 18px`,
                  boxShadow: '0 14px 30px rgba(233,185,73,0.4)',
                  transform: 'rotate(3deg)',
                }}
              >
                <div className="text-[24px] font-extrabold leading-none" style={displayFont}>
                  {t('East coast')}
                </div>
                <div className="mt-0.5 text-[12.5px] font-semibold opacity-80">{t('Based in Belle Mare')}</div>
              </div>
            </div>
          </div>
        </section>

        {/* signature dotted route divider */}
        <div
          aria-hidden="true"
          className="mx-auto max-w-shell"
          style={{ margin: 'clamp(36px,5vw,64px) auto', padding: '0 clamp(18px,5vw,72px)' }}
        >
          <svg viewBox="0 0 1100 60" preserveAspectRatio="none" className="block h-[54px] w-full">
            <path
              d="M10 40 C 180 5, 320 5, 470 32 S 760 60, 920 22 1090 30 1090 30"
              fill="none"
              stroke={TEAL}
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeDasharray="2 12"
              style={{ opacity: 0.55 }}
            />
            <circle cx="10" cy="40" r="5" fill={TEAL} />
            <path d="M1086 24c0-6 8-6 8 0 0 4-4 9-4 9s-4-5-4-9z" fill={CORAL} />
          </svg>
        </div>

        {/* ============ WHAT WE OFFER ============ */}
        <section
          id="offer"
          className="mx-auto max-w-shell"
          style={{ padding: 'clamp(24px,4vw,48px) clamp(18px,5vw,72px) clamp(72px,10vw,120px)' }}
        >
          <div data-reveal className="max-w-[680px]">
            <Eyebrow>{t('What we offer')}</Eyebrow>
            <h2
              className="m-0 mt-3.5 font-bold"
              style={{ ...displayFont, fontSize: 'clamp(30px,4.4vw,52px)', lineHeight: 1.06, letterSpacing: '-0.02em', textWrap: 'balance' }}
            >
              {t('Every way to see Mauritius — booked direct')}
            </h2>
            <p className="mt-4" style={{ fontSize: 'clamp(16px,1.7vw,18.5px)', lineHeight: 1.6, color: 'rgba(17,32,31,0.7)' }}>
              {t('From a full day of private sightseeing to a quick airport run, it’s the same trusted team behind every trip.')}
            </p>
          </div>

          <div
            id="tours"
            className="grid scroll-mt-24 gap-[clamp(14px,1.8vw,22px)]"
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(270px, 1fr))`, marginTop: 'clamp(34px,4vw,52px)' }}
          >
            {offers.map((card) => (
              <Link
                key={card.title}
                href={card.href}
                data-reveal
                data-reveal-delay={card.delay}
                className={cardBase}
                style={{
                  color: 'inherit',
                  background: '#fff',
                  borderColor: 'rgba(17,32,31,0.08)',
                }}
              >
                <span className="flex h-[50px] w-[50px] items-center justify-center rounded-[14px]" style={{ background: card.tintBg }}>
                  {card.icon}
                </span>
                <h3 className="m-0 text-[20px] font-bold tracking-[-0.01em]" style={displayFont}>
                  {card.title}
                </h3>
                <p className="m-0 flex-1 text-[14.5px] leading-[1.55]" style={{ color: 'rgba(17,32,31,0.66)' }}>
                  {card.blurb}
                </p>
                <span className="inline-flex items-center gap-[7px] text-[14.5px] font-bold" style={{ color: card.ctaColor }}>
                  {card.cta} <ArrowIcon size={14} />
                </span>
              </Link>
            ))}

            {/* 6th card — AI gradient */}
            <Link
              href="/ai-road-trip-planner"
              data-reveal
              data-reveal-delay={140}
              className={cardBase}
              style={{
                background: 'linear-gradient(150deg, #0E8C92, #0B5C63)',
                color: '#fff',
                borderColor: 'rgba(255,255,255,0.12)',
              }}
            >
              <span className="flex h-[50px] w-[50px] items-center justify-center rounded-[14px]" style={{ background: 'rgba(255,255,255,0.16)' }}>
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z" fill={GOLD} />
                  <path d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14z" fill="#fff" />
                </svg>
              </span>
              <h3 className="m-0 text-[20px] font-bold tracking-[-0.01em]" style={displayFont}>
                {t('Build a Custom Day with AI')}
              </h3>
              <p className="m-0 flex-1 text-[14.5px] leading-[1.55]" style={{ color: 'rgba(255,255,255,0.82)' }}>
                {t('Tell us your dates and pace — get a tailored island day in seconds.')}
              </p>
              <span className="inline-flex items-center gap-[7px] text-[14.5px] font-bold" style={{ color: GOLD }}>
                {t('Plan my day')} <ArrowIcon size={14} />
              </span>
            </Link>
          </div>
        </section>

        {/* ============ WHY WE BUILT GETYOURTOURSMAURITIUS ============ */}
        <section id="why" className="relative overflow-hidden text-white" style={{ background: TEAL_DARK }}>
          <div
            aria-hidden="true"
            className="absolute"
            style={{
              top: '-120px',
              right: '-80px',
              width: '380px',
              height: '380px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(233,185,73,0.22), transparent 70%)',
            }}
          />
          <div
            aria-hidden="true"
            className="absolute"
            style={{
              bottom: '-140px',
              left: '-100px',
              width: '420px',
              height: '420px',
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(14,140,146,0.45), transparent 70%)',
            }}
          />
          <div
            className="relative mx-auto max-w-shell"
            style={{ padding: 'clamp(72px,10vw,128px) clamp(18px,5vw,72px)' }}
          >
            <div
              className="grid items-center gap-[clamp(32px,5vw,72px)]"
              style={{ gridTemplateColumns: `repeat(auto-fit, minmax(300px, 1fr))` }}
            >
              <div data-reveal>
                <Eyebrow color={GOLD}>{t('Why we built GetYourToursMauritius')}</Eyebrow>
                <h2
                  className="m-0 mt-3.5 font-bold text-white"
                  style={{ ...displayFont, fontSize: 'clamp(30px,4.4vw,50px)', lineHeight: 1.07, letterSpacing: '-0.02em', textWrap: 'balance' }}
                >
                  {t('Cut out the middleman, keep the price honest')}
                </h2>
                <p className="mt-[22px] text-white/85" style={{ fontSize: 'clamp(16px,1.7vw,18.5px)', lineHeight: 1.65, textWrap: 'pretty' }}>
                  {t('Big booking platforms take a heavy commission on every trip. That money either inflates the price you pay — or quietly shrinks what reaches the local team who actually drive you around the island.')}
                </p>
                <p className="mt-4 text-white/85" style={{ fontSize: 'clamp(16px,1.7vw,18.5px)', lineHeight: 1.65, textWrap: 'pretty' }}>
                  {t('So we built our own booking platform. Reserve direct with the operator and you get transparent fixed prices, instant confirmation, free cancellation — and more of what you pay stays with the people showing you Mauritius.')}
                </p>
              </div>

              <div data-reveal className="flex flex-col gap-3.5">
                {[
                  {
                    tintBg: 'rgba(233,185,73,0.22)',
                    icon: (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M12 4v16M8 8h6.5a2.5 2.5 0 010 5H8m0 0h7" stroke={GOLD} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ),
                    title: t('Transparent fixed EUR prices'),
                    blurb: t('What you see up front is what you pay. No reseller mark-up.'),
                  },
                  {
                    tintBg: 'rgba(255,255,255,0.14)',
                    icon: (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M13 3L4 14h6l-1 7 9-11h-6l1-7z" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
                      </svg>
                    ),
                    title: t('Instant e-voucher confirmation'),
                    blurb: t('Pay securely by card and your booking is confirmed at once.'),
                  },
                  {
                    tintBg: 'rgba(247,108,94,0.22)',
                    icon: (
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" stroke={CORAL} strokeWidth="1.8" />
                        <path d="M12 7v5l3 2" stroke={CORAL} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ),
                    title: t('Free cancellation up to 24h'),
                    blurb: t('Plans change. Cancel up to 24 hours before, free.'),
                  },
                ].map((row) => (
                  <div
                    key={row.title}
                    className="flex items-start gap-4 rounded-[18px] border p-[20px_22px]"
                    style={{ background: 'rgba(255,255,255,0.07)', borderColor: 'rgba(255,255,255,0.12)' }}
                  >
                    <span
                      className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px]"
                      style={{ background: row.tintBg }}
                    >
                      {row.icon}
                    </span>
                    <div>
                      <h3 className="m-0 mb-[3px] text-[17px] font-bold text-white" style={displayFont}>
                        {row.title}
                      </h3>
                      <p className="m-0 text-[14.5px] leading-[1.5] text-white/75">{row.blurb}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============ ACROSS THE WHOLE ISLAND ============ */}
        <section
          id="island"
          className="mx-auto max-w-shell"
          style={{ padding: 'clamp(72px,10vw,128px) clamp(18px,5vw,72px)' }}
        >
          <div data-reveal className="max-w-[680px]">
            <Eyebrow>{t('Across the whole island')}</Eyebrow>
            <h2
              className="m-0 mt-3.5 font-bold"
              style={{ ...displayFont, fontSize: 'clamp(30px,4.4vw,52px)', lineHeight: 1.06, letterSpacing: '-0.02em', textWrap: 'balance' }}
            >
              {t('One operator, every corner of Mauritius')}
            </h2>
            <p className="mt-4" style={{ fontSize: 'clamp(16px,1.7vw,18.5px)', lineHeight: 1.6, color: 'rgba(17,32,31,0.7)' }}>
              {t('Door-to-door pickup island-wide — wherever you’re staying, we reach you.')}
            </p>
          </div>

          <div
            className="grid gap-[clamp(12px,1.6vw,18px)]"
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(210px, 1fr))`, marginTop: 'clamp(34px,4vw,52px)' }}
          >
            {regions.map((region) => {
              const cardStyle: CSSProperties = region.highlight
                ? {
                    background: 'linear-gradient(150deg, #0E8C92, #0B5C63)',
                    color: '#fff',
                    boxShadow: '0 18px 40px rgba(11,92,99,0.25)',
                  }
                : { background: '#fff', border: '1px solid rgba(17,32,31,0.08)' };
              return (
                <div
                  key={region.title}
                  data-reveal
                  data-reveal-delay={region.delay}
                  className="rounded-[20px] p-[24px_22px] transition duration-300 hover:-translate-y-[5px]"
                  style={cardStyle}
                >
                  <div
                    className="flex items-center gap-[9px] text-[13px] font-bold uppercase tracking-[0.08em]"
                    style={{ color: region.highlight ? GOLD : TEAL }}
                  >
                    <PinIcon color={region.highlight ? GOLD : TEAL} />
                    {region.tag}
                  </div>
                  <h3
                    className="mb-1.5 mt-3 text-[18px] font-bold tracking-[-0.01em]"
                    style={{ ...displayFont, color: region.highlight ? '#fff' : INK }}
                  >
                    {region.title}
                  </h3>
                  <p
                    className="m-0 text-[14px] leading-[1.5]"
                    style={{ color: region.highlight ? 'rgba(255,255,255,0.8)' : 'rgba(17,32,31,0.62)' }}
                  >
                    {region.blurb}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ============ FAQ ============ */}
        <section id="faq" style={{ background: '#fff', borderTop: '1px solid rgba(17,32,31,0.06)' }}>
          <div
            className="mx-auto max-w-[880px]"
            style={{ padding: 'clamp(72px,10vw,128px) clamp(18px,5vw,72px)' }}
          >
            <div data-reveal className="text-center" style={{ marginBottom: 'clamp(34px,4vw,52px)' }}>
              <Eyebrow>{t('Good to know')}</Eyebrow>
              <h2
                className="m-0 mt-3.5 font-bold"
                style={{ ...displayFont, fontSize: 'clamp(30px,4.4vw,50px)', lineHeight: 1.07, letterSpacing: '-0.02em', textWrap: 'balance' }}
              >
                {t('Frequently asked questions')}
              </h2>
            </div>
            <div className="flex flex-col gap-3">
              {faqs.map((faq, i) => (
                <details
                  key={faq.q}
                  data-reveal
                  open={i === 0}
                  className="group overflow-hidden rounded-[16px] border"
                  style={{ background: CREAM, borderColor: 'rgba(17,32,31,0.08)' }}
                >
                  <summary
                    className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold tracking-[-0.01em] marker:hidden [&::-webkit-details-marker]:hidden"
                    style={{
                      ...displayFont,
                      padding: '20px clamp(18px,3vw,26px)',
                      fontSize: 'clamp(16px,2vw,19px)',
                      color: INK,
                    }}
                  >
                    <span>{faq.q}</span>
                    <span className="flex-none transition-transform duration-300 group-open:rotate-180" style={{ color: TEAL }}>
                      <ChevronDown />
                    </span>
                  </summary>
                  <p
                    className="m-0"
                    style={{
                      padding: '0 clamp(18px,3vw,26px) 22px',
                      fontSize: 'clamp(15px,1.7vw,16.5px)',
                      lineHeight: 1.6,
                      color: 'rgba(17,32,31,0.72)',
                    }}
                  >
                    {faq.a}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* ============ CTA BAND ============ */}
        <section className="relative overflow-hidden text-white" style={{ background: 'linear-gradient(150deg, #11201F, #0B5C63)' }}>
          <div
            aria-hidden="true"
            className="absolute left-1/2 -translate-x-1/2"
            style={{
              top: '-100px',
              width: '600px',
              height: '300px',
              background: 'radial-gradient(ellipse, rgba(233,185,73,0.18), transparent 70%)',
            }}
          />
          <div
            className="relative mx-auto max-w-[980px] text-center"
            style={{ padding: 'clamp(64px,9vw,112px) clamp(18px,5vw,72px)' }}
          >
            <Eyebrow color={GOLD}>{t('Ready when you are')}</Eyebrow>
            <h2
              className="mx-auto mt-4 font-extrabold text-white"
              style={{ ...displayFont, fontSize: 'clamp(32px,5vw,58px)', lineHeight: 1.04, letterSpacing: '-0.02em', maxWidth: '14ch', textWrap: 'balance' }}
            >
              {t('Let’s plan your Mauritius, together')}
            </h2>
            <p className="mx-auto mt-[18px] max-w-[560px] text-white/85" style={{ fontSize: 'clamp(16px,1.9vw,19px)', lineHeight: 1.6 }}>
              {t('Message Noorani & Satar directly, or browse fixed-price tours and book in minutes.')}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3.5">
              <a
                href={whatsappUrl(t('Hi Belle Mare Tours! I’d like to plan my trip to Mauritius.'))}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 rounded-full px-[30px] py-4 text-[17px] font-bold no-underline transition hover:-translate-y-0.5"
                style={{ background: '#25D366', color: '#0a2e16', boxShadow: '0 14px 34px rgba(37,211,102,0.36)' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.92C21.95 6.45 17.5 2 12.04 2zm5.8 14.04c-.24.68-1.4 1.3-1.94 1.38-.5.07-1.13.1-1.82-.11-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.8-4.17-4.94-4.36-.15-.19-1.19-1.58-1.19-3.01 0-1.43.75-2.13 1.02-2.42.27-.29.59-.36.79-.36.2 0 .39.002.56.01.18.008.42-.07.66.5.24.59.82 2.04.89 2.18.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.28.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.22 1.37.28.14.44.12.6-.07.16-.19.69-.81.88-1.09.18-.28.37-.23.61-.14.25.09 1.58.74 1.85.88.27.14.45.21.51.32.07.11.07.64-.17 1.32z" />
                </svg>
                {t('Message us on WhatsApp')}
              </a>
              <Link
                href="/activities"
                className="inline-flex items-center gap-[9px] rounded-full px-[30px] py-4 text-[17px] font-bold text-white no-underline transition hover:-translate-y-0.5"
                style={{ background: CORAL, boxShadow: '0 14px 34px rgba(247,108,94,0.4)' }}
              >
                {t('Browse tours')}
                <ArrowIcon />
              </Link>
            </div>
            <p className="mt-[26px] text-[13.5px] text-white/60">
              {t('English & French spoken · Door-to-door island-wide · Free cancellation up to 24h')}
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
