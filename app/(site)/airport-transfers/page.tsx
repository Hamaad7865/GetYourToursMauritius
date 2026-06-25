import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Bricolage_Grotesque, Hanken_Grotesk } from 'next/font/google';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbListJsonLd, faqPageJsonLd, serviceJsonLd, transferServiceJsonLd } from '@/lib/seo/jsonld';
import { SITE, whatsappUrl } from '@/lib/seo/site';
import { RevealOnScroll } from '@/components/about/RevealOnScroll';
import { HeroWaves } from '@/components/about/HeroWaves';
import { TransferSearch } from '@/components/transfers/TransferSearch';
import { HotelMap } from '@/components/transfers/HotelMap';
import { TransferModeSwitch } from '@/components/transfers/TransferModeSwitch';
import { TransferReviews } from '@/components/transfers/TransferReviews';
import {
  AIRPORT_FARE_DEFAULT,
  AIRPORT_RETURN_DISCOUNT_PCT_DEFAULT,
  centsToEur,
  type AirportFare,
} from '@/lib/services/pricing';

export const runtime = 'edge';

/* The design's two signature faces — shared with the About page so the two read as one brand. Bricolage
   Grotesque carries every heading; Hanken Grotesk is the body face. Exposed as CSS vars, scoped to this page. */
const display = Bricolage_Grotesque({
  subsets: ['latin'],
  weight: ['500', '600', '700', '800'],
  variable: '--font-at-display',
  display: 'swap',
});
const bodyFont = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-at-body',
  display: 'swap',
});

// Exact brand hexes from the handoff, kept literal for pixel fidelity (matches the About page).
const TEAL = '#0E8C92';
const TEAL_DARK = '#0B5C63';
const CORAL = '#F76C5E';
const GOLD = '#E9B949';
const CREAM = '#FBF7EF';
const INK = '#11201F';

// Body-copy greys derived from INK (matches About's alpha scale — no ad-hoc greys).
const INK_BODY = 'rgba(17,32,31,0.72)';
const INK_SOFT = 'rgba(17,32,31,0.62)';
const INK_FAINT = 'rgba(17,32,31,0.52)';

const displayFont = { fontFamily: 'var(--font-at-display), sans-serif' } as const;

const TITLE = 'Mauritius Airport Transfers — Fixed-Price Private Taxi Service (SSR / MRU)';
const DESCRIPTION =
  'Private airport transfers in Mauritius at a fixed EUR price — up to 40% less than metered airport & hotel taxis. Door-to-door between SSR International Airport (MRU) and every hotel, Airbnb and cruise port. Meet & greet, flight tracking, free waiting time and a free child seat. Booked direct with licensed local operator Belle Mare Tours — no reseller markup.';

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  keywords: [
    'Mauritius airport transfer',
    'taxi service Mauritius',
    'Mauritius taxi',
    'private taxi Mauritius',
    'airport taxi Mauritius',
    'SSR airport taxi',
    'MRU airport transfer',
    'airport transfer Mauritius fixed price',
    'private transfer Mauritius',
    'hotel to hotel taxi Mauritius',
    'Belle Mare Tours',
  ],
  alternates: { canonical: '/airport-transfers' },
  openGraph: {
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    url: `${SITE.url}/airport-transfers`,
    locale: 'en_GB',
    images: [{ url: `${SITE.url}/hero/islands/aerial-lagoon.jpg` }],
  },
};

/* ── small primitives ──────────────────────────────────────────────────────── */

function Eyebrow({ children, color = TEAL }: { children: ReactNode; color?: string }) {
  return (
    <div className="mb-3.5 text-[13px] font-bold uppercase tracking-[0.2em]" style={{ color }}>
      {children}
    </div>
  );
}

function Check({ color = CORAL, size = 16 }: { color?: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 13 4 4L19 7" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </svg>
  );
}

const eur = (cents: number) => `€${centsToEur(cents)}`;

export default function AirportTransfersPage() {
  const faqs = [
    {
      q: 'How do I find my driver at the airport?',
      a: 'Your driver-guide waits in the arrivals hall holding a name board with your name on it. You’ll also have his direct WhatsApp number before you fly, so you can reach each other the moment you land.',
    },
    {
      q: 'What if my flight is delayed?',
      a: 'We track your flight in real time and adjust your pickup automatically. Waiting time is free — there is never an extra charge if your flight runs late.',
    },
    {
      q: 'Can I cancel?',
      a: 'Yes. Cancellation is free up to 24 hours before your transfer, with a full refund — no questions, no fees.',
    },
    {
      q: 'How do I pay?',
      a: 'Pay securely by card when you book. You’ll get an instant e-voucher by email to show your driver — no cash needed on arrival.',
    },
    {
      q: 'Are prices really fixed — any hidden fees?',
      a: 'Completely fixed and shown in EUR up front. No meters, no night surcharge, no luggage fee. The price you see when you book is the price you pay.',
    },
    {
      q: 'Do you cover my hotel?',
      a: 'Almost certainly — we provide door-to-door pickup from every hotel, Airbnb and cruise port across Mauritius, island-wide. Search your hotel above, or just enter your address when you book.',
    },
    {
      q: 'Is this a taxi service? Can I book a taxi between two hotels?',
      a: 'Yes. As well as airport transfers, we run a fixed-price private taxi service between any two points in Mauritius — hotel to hotel, hotel to a restaurant or marina, port to resort. Switch to “Location ↔ Location” in the price tool above to get an instant fare for any route.',
    },
    {
      q: 'How is this better than a metered street taxi?',
      a: 'Your price is fixed and agreed before you travel — no meter, no night surcharge, no negotiation and no language barrier. It’s the same licensed, English- and French-speaking driver-guide door to door, booked direct so there’s no reseller markup.',
    },
  ];

  // ── REAL fare table: Zone × vehicle, one-way / return, sourced from the same fares object the
  // calculator + server use. Return cells already include the configured round-trip discount. ──
  const returnPct = AIRPORT_RETURN_DISCOUNT_PCT_DEFAULT;
  const ret = (oneWayMinor: number) => Math.round((oneWayMinor * 2 * (100 - returnPct)) / 100);
  const vehicleCols: { key: 'sedanMinor' | 'familyMinor' | 'vanMinor' | 'coasterMinor'; label: string }[] = [
    { key: 'sedanMinor', label: 'Standard · ≤4' },
    { key: 'familyMinor', label: 'Family · 5–6' },
    { key: 'vanMinor', label: 'Minibus · 7–14' },
    { key: 'coasterMinor', label: 'Coaster · 15–25' },
  ];
  // Belt-and-braces: the seed always has both zones, but Record<string, …> is loosely typed.
  const EMPTY_FARE: AirportFare = { sedanMinor: 0, suvMinor: 0, familyMinor: 0, vanMinor: 0, coasterMinor: 0 };
  const zone2Fare: AirportFare = AIRPORT_FARE_DEFAULT.zone2 ?? EMPTY_FARE;
  const zone1Fare: AirportFare = AIRPORT_FARE_DEFAULT.zone1 ?? EMPTY_FARE;
  const fareRows: { zone: string; hint: string; fare: AirportFare }[] = [
    {
      zone: 'Zone 2 — near the airport',
      hint: 'Mahébourg · Blue Bay · Pointe d’Esny · Grand Port · Ferney',
      fare: zone2Fare,
    },
    {
      zone: 'Zone 1 — elsewhere in Mauritius',
      hint: 'North · East · West · Central · South · Le Morne',
      fare: zone1Fare,
    },
  ];

  const why = [
    {
      title: 'Fixed, transparent EUR price',
      body: 'No meters, no surprises. You agree the fare before you fly — metered airport taxis can’t promise that.',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      ),
    },
    {
      title: 'The same licensed driver, door-to-door',
      body: 'One trusted local driver-guide for your whole journey — English- and French-speaking, from your door to your destination.',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        </svg>
      ),
    },
    {
      title: 'Book direct, no OTA commission',
      body: 'You book straight with Belle Mare Tours — no reseller in the middle taking a cut, so the price stays lower for you.',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.73 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.75z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      ),
    },
    {
      title: 'Meet & greet + flight tracking',
      body: 'Name board in arrivals, real-time flight monitoring and free waiting time — so a late landing never leaves you stranded.',
      icon: (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M17.8 19.2 16 11l3.5-3.5a2 2 0 1 0-2.8-2.8L13.2 8 5 6.2 3.5 7.7l5.5 3-2.5 2.5-2.5-.5L2.5 14l3.8 1.7L8 19.5z" />
        </svg>
      ),
    },
  ];

  const steps = [
    { n: '1', title: 'Find your hotel & price', body: 'Search your hotel, or pick your area and vehicle. Your fixed EUR fare appears instantly — no waiting for a quote.' },
    { n: '2', title: 'Book & get your e-voucher', body: 'Pay securely by card and your confirmation e-voucher lands in your inbox right away.' },
    { n: '3', title: 'We meet you in arrivals', body: 'We track your flight and your driver-guide is waiting with a name board the moment you walk out.' },
  ];

  const fleet = [
    {
      name: 'Standard Car',
      tagline: 'Couples & solo travellers.',
      pax: '1–4 seats',
      bags: '2–3 bags',
      premium: false,
      feats: ['Air-conditioned saloon car', 'Free meet & greet + name board', 'Free first child seat'],
    },
    {
      name: 'Family Car',
      tagline: 'Small families.',
      pax: '5–6 seats',
      bags: '5–6 bags',
      premium: false,
      feats: ['Spacious A/C estate / MPV', 'Room for surfboards & buggies', 'Free first child seat'],
    },
    {
      name: 'Minibus',
      tagline: 'Bigger groups.',
      pax: '7–14 seats',
      bags: '14+ bags',
      premium: false,
      feats: ['Air-conditioned minibus', 'Plenty of luggage space', 'One driver for the whole group'],
    },
    {
      name: 'Coaster',
      tagline: 'Large groups & events.',
      pax: '15–25 seats',
      bags: '25+ bags',
      premium: true,
      feats: ['Air-conditioned coaster', 'Group travel in one vehicle', 'Ideal for weddings & events'],
    },
  ];

  const included = [
    { title: 'Meet & greet', body: 'Your driver waits in arrivals with a name board.' },
    { title: 'Real-time flight monitoring', body: 'We watch your flight and adjust the pickup.' },
    { title: 'Free waiting time', body: 'No charge if your flight runs late.' },
    { title: 'Free first child seat', body: 'Just tell us your child’s age.' },
    { title: 'Free cancellation 24h', body: 'Full refund up to 24 hours before.' },
    { title: '24/7 service', body: 'Any flight, any hour, day or night.' },
    { title: 'WhatsApp coordination', body: 'Message your driver directly, anytime.' },
  ];

  const coverageChips = ['North', 'East', 'South', 'West', 'Central', 'Le Morne', 'Grand Baie', 'Belle Mare', 'Flic en Flac', 'Blue Bay'];

  const breadcrumb = breadcrumbListJsonLd([
    { name: 'Home', path: '/' },
    { name: 'Airport transfers', path: '/airport-transfers' },
  ]);
  const service = transferServiceJsonLd({
    name: 'Mauritius Airport Transfers (SSR / MRU)',
    description: DESCRIPTION,
    path: '/airport-transfers',
    area: 'Mauritius',
    fromPriceEur: centsToEur(zone2Fare.sedanMinor),
  });
  const faqJson = faqPageJsonLd(faqs);
  // Second Service entity broadening the page's semantic coverage to the point-to-point taxi product
  // (the "Location ↔ Location" mode), so it can also surface for taxi-service queries.
  const taxiService = serviceJsonLd({
    serviceType: 'Taxi service',
    name: 'Mauritius private taxi & point-to-point transfers',
    description:
      'Fixed-price private taxi service across Mauritius — hotel to hotel, hotel to restaurant or marina, port to resort. Licensed driver-guide, booked direct with no reseller markup.',
    path: '/airport-transfers',
    areaServed: 'Mauritius',
  });

  // Section rhythm — aligned to the About page (generous vertical, 72px max horizontal inset).
  const sectionPad = 'clamp(72px,10vw,128px) clamp(18px,5vw,72px)';
  const padX = 'clamp(18px,5vw,72px)';

  return (
    <div
      className={`${display.variable} ${bodyFont.variable} overflow-x-hidden`}
      style={{ fontFamily: 'var(--font-at-body), system-ui, sans-serif', color: INK, background: CREAM }}
    >
      <JsonLd data={breadcrumb} />
      <JsonLd data={service} />
      <JsonLd data={taxiService} />
      <JsonLd data={faqJson} />
      <RevealOnScroll />

      <GygHeader />

      <main>
        {/* ============ HERO (animated ocean + hotel search) ============ */}
        {/* No overflow-hidden here: HeroWaves clips itself, and the search dropdown must be free to
            overflow the hero. z-20 keeps that dropdown painting above the section below. */}
        <section id="top" className="relative z-30 flex scroll-mt-24 items-center text-white" style={{ minHeight: 'clamp(480px,76vh,680px)' }}>
          <HeroWaves />
          {/* Localized left scrim — lifts the white + gold hero text over WCAG AA against the lighter
              upper teal, while the waves and the gold sun-glow stay visible on the right. */}
          <div
            aria-hidden="true"
            className="absolute inset-0 z-[1]"
            style={{ background: 'linear-gradient(101deg, rgba(3,22,26,0.74) 0%, rgba(3,22,26,0.58) 44%, rgba(3,22,26,0.26) 66%, rgba(3,22,26,0) 86%)' }}
          />
          <div className="relative z-[2] mx-auto w-full max-w-shell" style={{ padding: 'clamp(32px,5vw,64px) ' + padX }}>
            <div className="max-w-[680px]">
              <div
                className="mb-4 inline-flex items-center gap-2.5 rounded-full border px-3.5 py-[7px] text-[13px] font-semibold"
                style={{ background: 'rgba(4,28,32,0.5)', borderColor: 'rgba(233,185,73,0.5)', color: GOLD }}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5z" />
                  <path d="m9 12 2 2 4-4" />
                </svg>
                Licensed by the Mauritius Tourism Authority
              </div>
              <h1
                className="m-0 mb-4 font-extrabold"
                style={{ ...displayFont, fontSize: 'clamp(30px,4.6vw,54px)', lineHeight: 1.04, letterSpacing: '-0.025em', textWrap: 'balance' }}
              >
                Land in Mauritius to a driver who’s already waiting — at a <span style={{ color: GOLD }}>fixed price.</span>
              </h1>
              <p className="m-0 mb-5 max-w-[560px]" style={{ fontSize: 'clamp(15px,1.5vw,18px)', lineHeight: 1.5, color: 'rgba(251,247,239,0.92)' }}>
                Private door-to-door transfers between SSR Airport (MRU) and any hotel, Airbnb or cruise port — up to 40% less than metered
                airport taxis. <strong className="font-bold text-white">Booked direct with the operator, no reseller markup.</strong>
              </p>
              <div className="mb-[clamp(16px,3vw,26px)] flex flex-wrap items-center gap-x-[26px] gap-y-[14px] text-[15px] font-semibold">
                <span className="inline-flex items-center gap-2">
                  <span className="text-[17px] tracking-[1px]" style={{ color: GOLD }}>★★★★★</span> 4.8 · 1,000+ reviews
                </span>
                <span className="inline-flex items-center gap-2" style={{ color: 'rgba(251,247,239,0.92)' }}>
                  <Check color={CORAL} size={17} /> Same driver-guide all day
                </span>
                <span className="inline-flex items-center gap-2" style={{ color: 'rgba(251,247,239,0.92)' }}>
                  <Check color={CORAL} size={17} /> English &amp; French
                </span>
              </div>
            </div>

            {/* The journey starts here: search your hotel → see your fixed price. No data-reveal here —
                the primary CTA must never be momentarily hidden. */}
            <div className="max-w-[760px]">
              <div className="mb-2.5 text-[13px] font-bold uppercase tracking-[0.16em]" style={{ color: 'rgba(255,255,255,0.9)' }}>
                Where are you staying?
              </div>
              <TransferSearch />
              <p className="mt-3.5 text-[14px] font-semibold" style={{ color: 'rgba(255,255,255,0.92)' }}>
                Not sure of the exact hotel?{' '}
                <a href="#quote" className="font-bold text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">
                  Price by area
                </a>{' '}
                or{' '}
                <a href="#map" className="font-bold text-white underline decoration-white/40 underline-offset-4 hover:decoration-white">
                  browse the map
                </a>
                .
              </p>
            </div>
          </div>
        </section>

        {/* ============ INSTANT PRICE QUOTE ============ */}
        <section id="quote" className="scroll-mt-24" style={{ background: CREAM, borderTop: '1px solid rgba(17,32,31,0.06)' }}>
          <div className="mx-auto max-w-[1040px]" style={{ padding: 'clamp(64px,9vw,112px) ' + padX }}>
            <div data-reveal className="mx-auto mb-[clamp(28px,4vw,42px)] max-w-[600px] text-center">
              <Eyebrow>Instant price</Eyebrow>
              <h2 className="m-0 mb-3.5 font-bold" style={{ ...displayFont, fontSize: 'clamp(30px,4.4vw,52px)', lineHeight: 1.06, letterSpacing: '-0.02em', textWrap: 'balance' }}>
                Get your fixed fare in seconds.
              </h2>
              <p className="m-0" style={{ fontSize: 'clamp(16px,1.5vw,18px)', lineHeight: 1.55, color: INK_BODY }}>
                Pick your route and vehicle — airport-to-hotel or hotel-to-hotel — and your transparent EUR price appears instantly, no waiting around for a quote.
              </p>
            </div>
            <div data-reveal>
              <TransferModeSwitch />
            </div>
          </div>
        </section>

        {/* ============ ISLAND-WIDE TAXI SERVICE ============ */}
        <section id="taxi" className="mx-auto max-w-shell scroll-mt-24" style={{ padding: sectionPad }}>
          <div data-reveal className="mx-auto max-w-[780px] text-center">
            <Eyebrow>Island-wide taxi service</Eyebrow>
            <h2 className="m-0 mb-4 font-bold" style={{ ...displayFont, fontSize: 'clamp(30px,4.4vw,52px)', lineHeight: 1.06, letterSpacing: '-0.02em', textWrap: 'balance' }}>
              A fixed-price taxi anywhere in Mauritius — not just the airport.
            </h2>
            <p className="m-0" style={{ fontSize: 'clamp(16px,1.5vw,18px)', lineHeight: 1.6, color: INK_BODY }}>
              Need a taxi between two hotels, from your villa to a restaurant, or from the cruise port to your
              resort? Our private taxi service runs island-wide on the same fixed-price, book-direct basis as our
              airport transfers. Pick <strong style={{ color: INK }}>Location&nbsp;↔&nbsp;Location</strong> in the
              price tool above, choose your two points, and your transparent EUR fare appears in seconds — no
              meter, no haggling, the same trusted licensed driver-guide door to door.
            </p>
            <div className="mt-6">
              <a
                href="#quote"
                className="inline-flex items-center gap-2 rounded-full px-6 py-3 text-[15px] font-extrabold text-white no-underline"
                style={{ background: CORAL, boxShadow: '0 12px 26px -10px rgba(247,108,94,0.6)' }}
              >
                Get a fixed taxi fare
              </a>
            </div>
          </div>
        </section>

        {/* ============ TRUST BAR ============ */}
        <section aria-label="Why travellers trust us" style={{ background: TEAL_DARK, color: CREAM }}>
          <div className="mx-auto flex max-w-shell flex-wrap items-center justify-center gap-x-[38px] gap-y-3.5 text-center text-[14.5px] font-semibold" style={{ padding: '18px ' + padX }}>
            <span className="inline-flex items-center gap-2.5">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5z" />
              </svg>
              Licensed · Mauritius Tourism Authority
            </span>
            <span className="opacity-35">·</span>
            <span className="inline-flex items-center gap-2.5">
              <span style={{ color: GOLD }}>★</span> 4.8 from 1,000+ reviews
            </span>
            <span className="opacity-35">·</span>
            <span className="inline-flex items-center gap-2.5">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
              Fixed price, no hidden fees
            </span>
            <span className="opacity-35">·</span>
            <span className="inline-flex items-center gap-2.5">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={GOLD} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
              Free cancellation 24h
            </span>
          </div>
        </section>

        {/* ============ FIND YOUR HOTEL (interactive map) ============ */}
        <section id="map" className="mx-auto max-w-shell scroll-mt-24" style={{ padding: sectionPad }}>
          <div data-reveal className="mb-[clamp(28px,4vw,44px)] max-w-[680px]">
            <Eyebrow>Find your hotel</Eyebrow>
            <h2 className="m-0 mb-4 font-bold" style={{ ...displayFont, fontSize: 'clamp(30px,4.4vw,52px)', lineHeight: 1.06, letterSpacing: '-0.02em', textWrap: 'balance' }}>
              Every hotel we serve — pinned on the map.
            </h2>
            <p className="m-0 max-w-[560px]" style={{ fontSize: 'clamp(16px,1.5vw,18px)', lineHeight: 1.55, color: INK_BODY }}>
              Tap your resort to see the drive from SSR International Airport and your starting price — or search it by name up top. Door-to-door
              across the whole island, plus the Port Louis cruise terminal.
            </p>
          </div>
          <div data-reveal>
            <HotelMap />
          </div>
          <div data-reveal className="mt-[clamp(22px,3vw,30px)]">
            <div className="mb-3 text-[13px] font-bold uppercase tracking-[0.14em]" style={{ color: INK_SOFT }}>
              Island-wide coverage
            </div>
            <div className="flex flex-wrap gap-2.5">
              {coverageChips.map((c) => (
                <span key={c} className="rounded-full border bg-white px-4 py-2.5 text-[14px] font-semibold" style={{ borderColor: 'rgba(17,32,31,0.10)', color: TEAL_DARK }}>
                  {c}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ============ WHY BOOK WITH US ============ */}
        <section id="why" className="mx-auto max-w-shell" style={{ padding: sectionPad }}>
          <div data-reveal className="mb-[clamp(34px,5vw,52px)] max-w-[680px]">
            <Eyebrow>Beat the airport taxi</Eyebrow>
            <h2 className="m-0 mb-4 font-bold" style={{ ...displayFont, fontSize: 'clamp(30px,4.4vw,52px)', lineHeight: 1.06, letterSpacing: '-0.02em', textWrap: 'balance' }}>
              No meters. No surprises. Just the price you agreed.
            </h2>
            <p className="m-0" style={{ fontSize: 'clamp(16px,1.5vw,19px)', lineHeight: 1.55, color: INK_BODY }}>
              Belle Mare Tours has driven this island for years. You book straight with us — so the savings stay with you, not a booking site.
            </p>
          </div>
          <div className="grid gap-[clamp(16px,2vw,22px)]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))' }}>
            {why.map((c, i) => (
              <div
                key={c.title}
                data-reveal
                data-reveal-delay={i * 80}
                className="rounded-[20px] border bg-white p-[28px_24px] transition duration-300 hover:-translate-y-[5px]"
                style={{ borderColor: 'rgba(17,32,31,0.08)' }}
              >
                <div className="mb-[18px] flex h-12 w-12 items-center justify-center rounded-[13px]" style={{ background: 'rgba(14,140,146,0.10)' }}>
                  {c.icon}
                </div>
                <h3 className="m-0 mb-[9px] text-[19px] font-bold tracking-[-0.01em]" style={displayFont}>
                  {c.title}
                </h3>
                <p className="m-0 text-[15px] leading-[1.5]" style={{ color: INK_SOFT }}>
                  {c.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ============ HOW IT WORKS ============ */}
        <section style={{ background: INK, color: CREAM }}>
          <div className="mx-auto max-w-shell" style={{ padding: 'clamp(64px,9vw,112px) ' + padX }}>
            <div data-reveal className="mx-auto mb-[clamp(40px,5vw,60px)] max-w-[620px] text-center">
              <Eyebrow color={GOLD}>How it works</Eyebrow>
              <h2 className="m-0 font-bold" style={{ ...displayFont, fontSize: 'clamp(30px,4.4vw,52px)', lineHeight: 1.06, letterSpacing: '-0.02em' }}>
                From booking to name board in three steps.
              </h2>
            </div>
            <div className="grid gap-[clamp(20px,3vw,32px)]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))' }}>
              {steps.map((s, i) => (
                <div key={s.n} data-reveal data-reveal-delay={i * 90} className="relative pt-2">
                  <div className="mb-3.5 text-[58px] font-extrabold leading-none" style={{ ...displayFont, color: 'rgba(233,185,73,0.28)' }}>
                    {s.n}
                  </div>
                  <h3 className="m-0 mb-2.5 text-[21px] font-bold tracking-[-0.01em]" style={displayFont}>
                    {s.title}
                  </h3>
                  <p className="m-0 text-[15.5px] leading-[1.55]" style={{ color: 'rgba(251,247,239,0.78)' }}>
                    {s.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ FARE TABLE ============ */}
        <section id="fares" className="mx-auto max-w-shell scroll-mt-24" style={{ padding: sectionPad }}>
          <div data-reveal className="mb-[clamp(28px,4vw,40px)] max-w-[680px]">
            <Eyebrow>Fixed fares</Eyebrow>
            <h2 className="m-0 mb-3 font-bold" style={{ ...displayFont, fontSize: 'clamp(30px,4.4vw,52px)', lineHeight: 1.06, letterSpacing: '-0.02em' }}>
              Every fare, in EUR, up front.
            </h2>
            <p className="m-0" style={{ fontSize: '15.5px', lineHeight: 1.55, color: INK_BODY }}>
              All prices are fixed, per vehicle, and include meet &amp; greet, name board and free waiting time. Each cell shows{' '}
              <strong>one-way / return</strong>.
            </p>
          </div>
          <div data-reveal className="overflow-x-auto rounded-[20px] border bg-white" style={{ borderColor: 'rgba(17,32,31,0.08)' }}>
            <table className="w-full min-w-[640px] border-collapse text-[15px]">
              <thead>
                <tr style={{ background: TEAL_DARK, color: CREAM }}>
                  <th className="p-[16px_20px] text-left text-[14px] font-bold">Zone</th>
                  {vehicleCols.map((v) => (
                    <th key={v.key} className="p-[16px_16px] text-center text-[14px] font-bold">
                      {v.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fareRows.map((row) => (
                  <tr key={row.zone} style={{ borderTop: '1px solid rgba(17,32,31,0.08)' }}>
                    <td className="p-[15px_20px]">
                      <div className="font-bold" style={{ color: INK }}>
                        {row.zone}
                      </div>
                      <div className="mt-0.5 text-[12.5px]" style={{ color: INK_FAINT }}>
                        {row.hint}
                      </div>
                    </td>
                    {vehicleCols.map((v) => (
                      <td key={v.key} className="whitespace-nowrap p-[15px_16px] text-center">
                        <span className="font-bold" style={{ color: TEAL }}>
                          {eur(row.fare[v.key])}
                        </span>
                        <span style={{ color: 'rgba(17,32,31,0.30)' }}> / </span>
                        <span style={{ color: INK_BODY }}>{eur(ret(row.fare[v.key]))}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="m-[14px_2px_0] text-[13px]" style={{ color: INK_FAINT }}>
            Return fares already include the {returnPct}% round-trip discount. <strong>Zone 2</strong> is the near-airport south-east cluster —
            Mahébourg, Blue Bay, Pointe d’Esny, Grand Port, Ferney and resorts like Shandrani, Anantara IKO, Holiday Inn, Le Preskil, Astroea
            Beach and Le Peninsula Bay. Everywhere else on the island is <strong>Zone 1</strong>. Add an SUV upgrade (≤4 guests, more luggage
            space) when you book.
          </p>
        </section>

        {/* ============ FLEET ============ */}
        <section id="fleet" className="scroll-mt-24" style={{ background: CREAM }}>
          <div className="mx-auto max-w-shell" style={{ padding: 'clamp(48px,6vw,72px) ' + padX + ' clamp(72px,10vw,128px)' }}>
            <div data-reveal className="mb-[clamp(28px,4vw,44px)] max-w-[640px]">
              <Eyebrow>The fleet</Eyebrow>
              <h2 className="m-0 font-bold" style={{ ...displayFont, fontSize: 'clamp(30px,4.4vw,52px)', lineHeight: 1.06, letterSpacing: '-0.02em' }}>
                Clean, air-conditioned, the right size for your group.
              </h2>
            </div>
            <div className="grid gap-[clamp(16px,2vw,22px)]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(250px,1fr))' }}>
              {fleet.map((f, i) => (
                <div
                  key={f.name}
                  data-reveal
                  data-reveal-delay={i * 70}
                  className="flex flex-col overflow-hidden rounded-[22px] border bg-white transition duration-300 hover:-translate-y-[5px]"
                  style={{ borderColor: 'rgba(17,32,31,0.08)' }}
                >
                  {/* Branded card header (no owner fleet photos) — icon + capacity badge */}
                  <div className="relative flex items-center justify-center" style={{ aspectRatio: '16 / 10', background: 'linear-gradient(150deg, #0E8C92, #0B5C63)' }}>
                    {f.premium && (
                      <span className="absolute left-3 top-3 rounded-full px-2.5 py-[5px] text-[11px] font-extrabold uppercase tracking-[0.04em]" style={{ background: GOLD, color: INK }}>
                        Luxury tier
                      </span>
                    )}
                    <svg width="74" height="74" viewBox="0 0 24 24" fill="none" stroke="rgba(251,247,239,0.92)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M4 14l1.5-5A2 2 0 0 1 7.4 7.5h9.2A2 2 0 0 1 18.5 9L20 14" />
                      <path d="M3 14h18v4H3z" />
                      <circle cx="7" cy="18.5" r="1.4" />
                      <circle cx="17" cy="18.5" r="1.4" />
                    </svg>
                  </div>
                  <div className="flex flex-1 flex-col p-[22px_22px_24px]">
                    <h3 className="m-0 mb-1 text-[20px] font-bold tracking-[-0.01em]" style={displayFont}>
                      {f.name}
                    </h3>
                    <p className="m-0 mb-4 text-[14px] leading-[1.45]" style={{ color: INK_SOFT }}>
                      {f.tagline}
                    </p>
                    <div className="mb-4 flex gap-[18px] text-[14px] font-semibold" style={{ color: TEAL_DARK }}>
                      <span className="inline-flex items-center gap-1.5">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                          <circle cx="9" cy="7" r="4" />
                          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                        </svg>
                        {f.pax}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="5" y="7" width="14" height="13" rx="2" />
                          <path d="M9 7V5a3 3 0 0 1 6 0v2" />
                        </svg>
                        {f.bags}
                      </span>
                    </div>
                    <ul className="m-0 mb-auto flex list-none flex-col gap-2 p-0">
                      {f.feats.map((ft) => (
                        <li key={ft} className="flex items-start gap-2.5 text-[14px] leading-[1.4]" style={{ color: INK_BODY }}>
                          <span className="mt-0.5 flex-none">
                            <Check />
                          </span>
                          {ft}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
            <p className="m-[22px_2px_0] inline-flex items-center gap-2.5 text-[14px]" style={{ color: INK_BODY }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={TEAL} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
              </svg>
              Travelling with little ones? Your <strong>first child seat is free</strong> — just tell us their age when you book.
            </p>
          </div>
        </section>

        {/* ============ INCLUDED ============ */}
        <section style={{ background: TEAL, color: '#fff' }}>
          <div className="mx-auto max-w-shell" style={{ padding: 'clamp(64px,9vw,112px) ' + padX }}>
            <div data-reveal className="mb-[clamp(34px,5vw,52px)] max-w-[620px]">
              <Eyebrow color={GOLD}>Included with every transfer</Eyebrow>
              <h2 className="m-0 font-bold" style={{ ...displayFont, fontSize: 'clamp(30px,4.4vw,52px)', lineHeight: 1.06, letterSpacing: '-0.02em' }}>
                All of this. At no extra cost.
              </h2>
            </div>
            <div className="grid gap-[clamp(14px,2vw,20px)]" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))' }}>
              {included.map((it, i) => (
                <div
                  key={it.title}
                  data-reveal
                  data-reveal-delay={(i % 4) * 70}
                  className="rounded-[16px] border p-[22px_20px]"
                  style={{ background: 'rgba(255,255,255,0.10)', borderColor: 'rgba(255,255,255,0.18)' }}
                >
                  <div className="mb-3" style={{ color: GOLD }}>
                    <Check color={GOLD} size={22} />
                  </div>
                  <h3 className="m-0 mb-[5px] text-[16.5px] font-bold" style={displayFont}>
                    {it.title}
                  </h3>
                  <p className="m-0 text-[14px] leading-[1.45]" style={{ color: 'rgba(255,255,255,0.85)' }}>
                    {it.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ REVIEWS (real) ============ */}
        <section style={{ background: CREAM }}>
          <div className="mx-auto max-w-shell" style={{ padding: 'clamp(56px,8vw,104px) ' + padX }}>
            <div data-reveal>
              <TransferReviews count={3} />
            </div>
          </div>
        </section>

        {/* ============ FAQ ============ */}
        <section id="faq" className="mx-auto max-w-[880px] scroll-mt-24" style={{ padding: sectionPad }}>
          <div data-reveal className="mb-[clamp(30px,4vw,46px)] text-center">
            <Eyebrow>Good to know</Eyebrow>
            <h2 className="m-0 font-bold" style={{ ...displayFont, fontSize: 'clamp(30px,4.4vw,52px)', lineHeight: 1.06, letterSpacing: '-0.02em' }}>
              Your questions, answered up front.
            </h2>
          </div>
          <div className="flex flex-col gap-3">
            {faqs.map((f, i) => (
              <details
                key={f.q}
                data-reveal
                open={i === 0}
                className="group overflow-hidden rounded-[16px] border bg-white"
                style={{ borderColor: 'rgba(17,32,31,0.10)' }}
              >
                <summary
                  className="flex cursor-pointer list-none items-center justify-between gap-4 p-[20px_22px] font-bold marker:hidden [&::-webkit-details-marker]:hidden"
                  style={{ ...displayFont, fontSize: 'clamp(16px,1.7vw,18px)', color: INK }}
                >
                  <span>{f.q}</span>
                  <span className="flex-none transition-transform duration-200 group-open:rotate-45" style={{ color: TEAL }}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  </span>
                </summary>
                <p className="m-0 p-[0_22px_22px] text-[15.5px] leading-[1.6]" style={{ color: INK_BODY }}>
                  {f.a}
                </p>
              </details>
            ))}
          </div>
        </section>

        {/* ============ FINAL CTA ============ */}
        <section style={{ background: TEAL_DARK, color: CREAM }}>
          <div className="mx-auto max-w-shell text-center" style={{ padding: 'clamp(56px,8vw,100px) ' + padX }}>
            <h2 className="m-0 mb-4 font-bold" style={{ ...displayFont, fontSize: 'clamp(30px,4.6vw,52px)', lineHeight: 1.04, letterSpacing: '-0.02em', textWrap: 'balance' }}>
              Land, walk out, and there we are.
            </h2>
            <p className="mx-auto mb-[30px] max-w-[560px]" style={{ fontSize: 'clamp(16px,1.6vw,19px)', lineHeight: 1.5, color: 'rgba(251,247,239,0.85)' }}>
              Get your fixed price in seconds — booked direct with Noorani and the team in Belle Mare.
            </p>
            <div className="flex flex-wrap justify-center gap-3.5">
              <a
                href="#top"
                className="inline-flex items-center gap-2.5 rounded-full px-8 py-4 text-[17px] font-extrabold text-white no-underline"
                style={{ background: CORAL, boxShadow: '0 14px 30px -8px rgba(247,108,94,0.6)' }}
              >
                Find your hotel <Arrow />
              </a>
              <a
                href={whatsappUrl('Hi Belle Mare Tours! I’d like an airport transfer. Here are my flight details and party size:')}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 rounded-full border px-[26px] py-4 text-[16px] font-bold text-white no-underline"
                style={{ background: 'rgba(255,255,255,0.10)', borderColor: 'rgba(255,255,255,0.30)' }}
              >
                <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.4L3 21l2.2-5.6A8.4 8.4 0 1 1 21 11.5z" />
                </svg>
                Chat on WhatsApp
              </a>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />

      {/* ============ STICKY MOBILE CTA ============ */}
      <a
        href="#top"
        className="fixed bottom-4 left-4 right-4 z-[60] mx-auto flex max-w-[520px] items-center justify-center gap-2.5 rounded-[14px] p-[15px] text-[16px] font-extrabold text-white no-underline sm:hidden"
        style={{ background: CORAL, boxShadow: '0 14px 30px -6px rgba(247,108,94,0.6)' }}
      >
        Find your hotel <Arrow />
      </a>
    </div>
  );
}
