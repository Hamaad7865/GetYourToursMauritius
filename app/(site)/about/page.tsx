import type { Metadata } from 'next';
import { overrideMetadata } from '@/lib/seo/override';
import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { Bricolage_Grotesque, Hanken_Grotesk } from 'next/font/google';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbListJsonLd, faqPageJsonLd } from '@/lib/seo/jsonld';
import { SITE, whatsappUrl } from '@/lib/seo/site';
import { getLocale, getT } from '@/lib/i18n/server';
import { RevealOnScroll } from '@/components/about/RevealOnScroll';
import { HeroWaves } from '@/components/about/HeroWaves';
import { BAND_PHOTO, STORY_PHOTOS, PHOTO_CREDITS } from '@/lib/content/about-photos';
import { reviewStats } from '@/lib/content/reviews';

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

/** The brand as the About copy writes it — the domain, lower-case, exactly as in the source deck. */
const BRAND = 'bellemaretours.com';

/** Heading helper: applies the Bricolage display face inline. */
const displayFont = { fontFamily: 'var(--font-about-display), sans-serif' } as const;

const metaTitle = `About ${SITE.name} — the smart way to experience Mauritius`;
const metaDescription = `${BRAND} is your trusted gateway to the beauty, culture and experiences of Mauritius. Curated excursions and private experiences, seamless airport and island transfers, car and scooter hire, and bespoke holiday planning — booked securely in one place.`;

const DEFAULT_METADATA: Metadata = {
  // absolute: metaTitle already names the brand — stop the root template appending a second one.
  title: { absolute: metaTitle },
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
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M3 8h10M9 4l4 4-4 4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

/**
 * Every other icon on the page, drawn from a shared 24×24 stroke grid. Each entry is just its
 * path data, so a card only ever carries `icon: ICON.leaf` — that keeps ~20 icons from burying
 * the copy they belong to, which is what this page is actually about.
 */
const ICON = {
  // trust strip
  verified: ['M12 3a9 9 0 100 18 9 9 0 000-18', 'M8.2 12.2l2.6 2.6 5-5.4'],
  compass: ['M12 3a9 9 0 100 18 9 9 0 000-18', 'M15.4 8.6l-2 4.8-4.8 2 2-4.8 4.8-2z'],
  shieldLock: [
    'M12 2.6l7.4 3v6.1c0 4.5-3 8.2-7.4 10.7-4.4-2.5-7.4-6.2-7.4-10.7V5.6l7.4-3z',
    'M9.6 11.7h4.8v4.1H9.6z',
    'M10.7 11.7v-1.3a1.3 1.3 0 012.6 0v1.3',
  ],
  bolt: ['M13 3L4.6 13.6H10l-1 7.4 8.4-10.6H12l1-7.4z'],
  // credentials bar
  shieldCheck: [
    'M12 2.6l7.4 3v6.1c0 4.5-3 8.2-7.4 10.7-4.4-2.5-7.4-6.2-7.4-10.7V5.6l7.4-3z',
    'M8.6 11.9l2.3 2.3 4.6-4.9',
  ],
  // services
  van: [
    'M3 16.6V9.9a1.5 1.5 0 011.5-1.5h8.6v8.2',
    'M13.1 10.9h3.4l3.5 3.6v2.1h-3.5',
    'M6.4 16.6h3.4',
    'M5.4 16.6a1.6 1.6 0 103.2 0 1.6 1.6 0 00-3.2 0',
    'M15 16.6a1.6 1.6 0 103.2 0 1.6 1.6 0 00-3.2 0',
  ],
  car: [
    'M3.4 14.9h17.2v3.4H3.4z',
    'M5.4 14.9l1.9-4.6a1.8 1.8 0 011.7-1.1h6.2a1.8 1.8 0 011.7 1.1l1.9 4.6',
    'M6.6 18.3v1.4M17.4 18.3v1.4',
  ],
  scooter: [
    'M5.6 14.8a3 3 0 100 6 3 3 0 000-6',
    'M18.4 14.8a3 3 0 100 6 3 3 0 000-6',
    'M8.6 17.8h6.8l-2.6-6.6h-2.4',
    'M12.8 11.2l1.6-3.6h2.6',
  ],
  camera: [
    'M3.4 8.9h3.9l1.4-2.2h6.6l1.4 2.2h3.9v10.3H3.4z',
    'M12 10.7a3.4 3.4 0 100 6.8 3.4 3.4 0 000-6.8',
  ],
  mountain: [
    'M3 18.6l5.6-9.2 3.4 5.6 2.3-3.4 6.7 7z',
    'M16.6 6.5a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6',
  ],
  sail: [
    'M12 3v9M12 5l6 2-6 3-6-3 6-2z',
    'M3 16c1.5 1.5 3 1.5 4.5 0S10.5 14.5 12 16s3 1.5 4.5 0S19.5 14.5 21 16',
    'M4 20c1.3 1.3 2.7 1.3 4 0s2.7-1.3 4 0 2.7 1.3 4 0',
  ],
  personHeart: [
    'M11.4 11.4a3.3 3.3 0 100-6.6 3.3 3.3 0 000 6.6',
    'M5 20.4c0-3.5 2.9-5.8 6.4-5.8',
    'M17.2 20.8s-3.1-1.9-3.1-4a1.8 1.8 0 013.1-1.2 1.8 1.8 0 013.1 1.2c0 2.1-3.1 4-3.1 4z',
  ],
  // "why choose" — the dark band
  tag: [
    'M20.2 3.8v7.2a1.6 1.6 0 01-.5 1.2l-7.3 7.3a1.2 1.2 0 01-1.7 0l-6.2-6.2a1.2 1.2 0 010-1.7l7.3-7.3a1.6 1.6 0 011.2-.5h7.2z',
    'M16.3 7.7a.9.9 0 100 1.8.9.9 0 000-1.8',
  ],
  receipt: ['M6 3.4h12v17.2l-2-1.4-2 1.4-2-1.4-2 1.4-2-1.4-2 1.4z', 'M9.2 8.6h5.6M9.2 12.4h5.6'],
  calendarCheck: [
    'M4.2 6.6h15.6v13.8H4.2z',
    'M8.2 3.6v4M15.8 3.6v4M4.2 10.6h15.6',
    'M9.4 15.4l2 2 3.4-3.6',
  ],
  pin: [
    'M12 2.4c-4.1 0-7.4 3.3-7.4 7.4 0 5.4 7.4 12 7.4 12s7.4-6.6 7.4-12c0-4.1-3.3-7.4-7.4-7.4z',
    'M12 12.4a2.6 2.6 0 100-5.2 2.6 2.6 0 000 5.2',
  ],
  headset: [
    'M4.4 14.4v-2.2a7.6 7.6 0 0115.2 0v2.2',
    'M4.4 13.4h2.4v5.2H5.6a1.2 1.2 0 01-1.2-1.2z',
    'M19.6 13.4h-2.4v5.2h1.2a1.2 1.2 0 001.2-1.2z',
    'M17.2 18.6a3 3 0 01-3 2.6H12',
  ],
  // values
  heart: ['M12 20.6S4.2 15.9 4.2 10.4a4 4 0 017.8-1.6 4 4 0 017.8 1.6c0 5.5-7.8 10.2-7.8 10.2z'],
  star: ['M12 3l2.6 5.6 6.2.7-4.6 4.2 1.3 6.1L12 16.5l-5.5 3.1 1.3-6.1L3.2 9.3l6.2-.7L12 3z'],
  sliders: ['M4.4 7.4h15.2M4.4 12h15.2M4.4 16.6h15.2', 'M9.2 5.6v3.6M15.4 10.2v3.6M7.6 14.8v3.6'],
  leaf: [
    'M20 4.4c0 9.2-4.6 14.4-11.4 14.4a4.6 4.6 0 01-4.6-4.6C4 7.6 10 4.4 20 4.4z',
    'M5.2 19.6C7.4 13.4 11.4 9.6 16.4 7.6',
  ],
  cup: [
    'M4.6 8.6h11.2v6.2a4.4 4.4 0 01-4.4 4.4H9a4.4 4.4 0 01-4.4-4.4z',
    'M15.8 10.2h1.6a2.4 2.4 0 010 4.8h-1.6',
    'M8 3.4v2.2M12 3.4v2.2',
  ],
} as const;

/** Renders any `ICON.*` entry at `color`. Stroke-only, decorative, never in the a11y tree. */
function Icon({
  paths,
  color,
  size = 24,
}: {
  paths: readonly string[];
  color: string;
  size?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {paths.map((d) => (
        <path
          key={d}
          d={d}
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

/* ── reusable bits ────────────────────────────────────────────────────────────── */

function Eyebrow({ children, color = TEAL }: { children: ReactNode; color?: string }) {
  return (
    <span className="text-[13px] font-bold uppercase tracking-[0.2em]" style={{ color }}>
      {children}
    </span>
  );
}

function ChevronDown() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M5 8l5 5 5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default async function AboutPage() {
  const t = await getT();
  const locale = await getLocale();
  /* Grouped in the reader's own locale — 1,076 in English, 1 076 in French. Both numbers come
     from the scraped TripAdvisor/Google pool, so the claim can never drift from the data. */
  const reviewCount = reviewStats.total.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB');
  const reviewAverage = reviewStats.average.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB', {
    minimumFractionDigits: 1,
  });

  /* The four headline reasons, lifted out of "Why choose {brand}" so they can sit in the strip
     that overlaps the hero. The remaining five carry the section's own heading further down. */
  const trust = [
    {
      tintBg: 'rgba(14,140,146,0.12)',
      icon: <Icon paths={ICON.verified} color={TEAL} />,
      title: t('Curated Experiences'),
      blurb: t(
        'Every experience is carefully selected to ensure exceptional quality, safety and outstanding customer satisfaction.',
      ),
      delay: 0,
    },
    {
      tintBg: 'rgba(233,185,73,0.18)',
      icon: <Icon paths={ICON.compass} color={GOLD} />,
      title: t('Trusted Destination Experts'),
      blurb: t(
        'Benefit from extensive tourism expertise and insider knowledge to discover Mauritius with confidence.',
      ),
      delay: 80,
    },
    {
      tintBg: 'rgba(14,140,146,0.12)',
      icon: <Icon paths={ICON.shieldLock} color={TEAL} />,
      title: t('Secure Online Payments'),
      blurb: t(
        'Book with complete peace of mind through our encrypted and secure payment gateway.',
      ),
      delay: 160,
    },
    {
      tintBg: 'rgba(247,108,94,0.14)',
      icon: <Icon paths={ICON.bolt} color={CORAL} />,
      title: t('Instant Booking Confirmation'),
      blurb: t(
        'Receive immediate confirmation and all the information you need before your experience begins.',
      ),
      delay: 240,
    },
  ];

  /* "Discover experiences" — the six collections. Deliberately NOT links: these are curated
     groupings we describe here but do not yet filter on, so every one of them would land on the
     same unfiltered catalogue. One honest CTA under the grid does that job instead. */
  const collections = [
    {
      accent: CORAL,
      title: t('Best Sellers'),
      blurb: t('Explore our most popular experiences loved by visitors from around the world.'),
      delay: 0,
    },
    {
      accent: GOLD,
      title: t('Luxury Collection'),
      blurb: t(
        'Exclusive experiences designed for travellers seeking comfort, privacy and exceptional service.',
      ),
      delay: 60,
    },
    {
      accent: TEAL,
      title: t('Family Adventures'),
      blurb: t('Fun-filled activities and excursions suitable for families of every age.'),
      delay: 120,
    },
    {
      accent: CORAL,
      title: t('Romantic Escapes'),
      blurb: t(
        'Create unforgettable moments with experiences designed for couples, honeymooners and special celebrations.',
      ),
      delay: 180,
    },
    {
      accent: TEAL,
      title: t('Nature & Adventure'),
      blurb: t(
        'From mountains and waterfalls to marine parks and nature reserves, discover the adventurous side of Mauritius.',
      ),
      delay: 240,
    },
    {
      accent: TEAL,
      title: t('Sea Experiences'),
      blurb: t(
        'Sail, snorkel, dive, fish or simply unwind on the spectacular turquoise waters surrounding the island.',
      ),
      delay: 300,
    },
  ];

  // "Discover our services" — seven services, each pointed at the page that actually sells it.
  const offers = [
    {
      href: '/airport-transfers',
      tintBg: 'rgba(247,108,94,0.14)',
      icon: <Icon paths={ICON.van} color={CORAL} size={26} />,
      title: t('Airport & Island Transfers'),
      blurb: t(
        'Reliable and comfortable transportation throughout Mauritius, ensuring every journey begins and ends with complete peace of mind.',
      ),
      cta: t('Book a transfer'),
      ctaColor: CORAL,
      delay: 0,
    },
    {
      href: '/rent',
      tintBg: 'rgba(233,185,73,0.2)',
      icon: <Icon paths={ICON.car} color={INK} size={26} />,
      title: t('Car Hire'),
      blurb: t(
        'Choose from a wide range of well-maintained vehicles, from compact city cars to spacious family SUVs, giving you the freedom to explore Mauritius at your own pace.',
      ),
      cta: t('View vehicles'),
      ctaColor: TEAL,
      delay: 70,
    },
    {
      href: '/rent',
      tintBg: 'rgba(233,185,73,0.2)',
      icon: <Icon paths={ICON.scooter} color={INK} size={26} />,
      title: t('Scooter Rentals'),
      blurb: t(
        'Discover the island with flexibility and convenience through our modern scooter rental solutions — perfect for couples and independent travellers seeking a more adventurous way to explore.',
      ),
      cta: t('View scooters'),
      ctaColor: TEAL,
      delay: 140,
    },
    {
      href: '/mauritius-tours',
      tintBg: 'rgba(14,140,146,0.12)',
      icon: <Icon paths={ICON.camera} color={TEAL} size={26} />,
      title: t('Sightseeing Experiences'),
      blurb: t(
        'Discover Mauritius through carefully curated island tours that reveal breathtaking landscapes, cultural landmarks, botanical gardens, heritage sites, scenic viewpoints, and hidden gems.',
      ),
      cta: t('Explore tours'),
      ctaColor: TEAL,
      delay: 0,
    },
    {
      href: '/activities',
      tintBg: 'rgba(14,140,146,0.12)',
      icon: <Icon paths={ICON.mountain} color={TEAL} size={26} />,
      title: t('Land Adventures'),
      blurb: t(
        'Experience unforgettable activities including hiking, quad biking, ziplining, wildlife parks, rum distilleries, tea plantations, shopping tours, food discoveries, and eco-tourism experiences.',
      ),
      cta: t('See what’s on'),
      ctaColor: TEAL,
      delay: 70,
    },
    {
      href: '/activities',
      tintBg: 'rgba(14,140,146,0.12)',
      icon: <Icon paths={ICON.sail} color={TEAL} size={26} />,
      title: t('Sea Experiences'),
      blurb: t(
        'Enjoy catamaran cruises, dolphin and whale watching, snorkelling, scuba diving, speedboat excursions, private island escapes, sunset cruises, deep-sea fishing, and unforgettable moments on the Indian Ocean.',
      ),
      cta: t('Head to the water'),
      ctaColor: TEAL,
      delay: 140,
    },
    {
      href: '/contact',
      tintBg: 'rgba(247,108,94,0.14)',
      icon: <Icon paths={ICON.personHeart} color={CORAL} size={26} />,
      title: t('Personalised Experiences'),
      blurb: t(
        'Our travel specialists create bespoke itineraries designed around your interests, schedule, and budget — whether you’re celebrating a honeymoon, anniversary, family holiday, corporate retreat, or simply creating unforgettable memories.',
      ),
      cta: t('Talk to a specialist'),
      ctaColor: CORAL,
      delay: 0,
    },
  ];

  // The five remaining reasons from "Why choose {brand}", carried in the dark band.
  const reasons = [
    {
      tintBg: 'rgba(233,185,73,0.22)',
      icon: <Icon paths={ICON.tag} color={GOLD} size={22} />,
      title: t('Best Value'),
      blurb: t('Competitive pricing with transparent rates and no hidden costs.'),
    },
    {
      tintBg: 'rgba(255,255,255,0.14)',
      icon: <Icon paths={ICON.receipt} color="#fff" size={22} />,
      title: t('Transparent Pricing'),
      blurb: t('Clear pricing with no hidden surprises, allowing you to book with confidence.'),
    },
    {
      tintBg: 'rgba(247,108,94,0.22)',
      icon: <Icon paths={ICON.calendarCheck} color={CORAL} size={22} />,
      title: t('Flexible Booking Options'),
      blurb: t(
        'Enjoy greater flexibility with selected experiences offering convenient cancellation and rescheduling policies.',
      ),
    },
    {
      tintBg: 'rgba(233,185,73,0.22)',
      icon: <Icon paths={ICON.pin} color={GOLD} size={22} />,
      title: t('Island-Wide Service'),
      blurb: t(
        'Whether you’re staying in the north, south, east, west or central region, our services are available across Mauritius.',
      ),
    },
    {
      tintBg: 'rgba(255,255,255,0.14)',
      icon: <Icon paths={ICON.headset} color="#fff" size={22} />,
      title: t('Dedicated Customer Support'),
      blurb: t(
        'Our friendly travel specialists are available before, during and after your holiday to ensure everything runs perfectly.',
      ),
    },
  ];

  const regions = [
    {
      tag: t('North'),
      title: t('Beaches, nightlife & coastal villages'),
      blurb: t(
        'Beautiful beaches, vibrant nightlife, shopping, restaurants and lively coastal villages.',
      ),
      delay: 0,
    },
    {
      tag: t('South'),
      title: t('Cliffs, waterfalls & wild scenery'),
      blurb: t('Untouched nature, dramatic cliffs, waterfalls and breathtaking scenery.'),
      delay: 60,
    },
    {
      tag: t('East'),
      title: t('Lagoons & island excursions'),
      blurb: t('Crystal-clear lagoons, white sandy beaches and world-renowned island excursions.'),
      delay: 120,
      highlight: true,
    },
    {
      tag: t('West'),
      title: t('Dolphins, mountains & sunsets'),
      blurb: t(
        'Dolphin encounters, mountain landscapes, spectacular sunsets and outdoor adventures.',
      ),
      delay: 180,
    },
    {
      tag: t('Central Plateau'),
      title: t('Gardens, museums & markets'),
      blurb: t(
        'Discover the cultural heart of Mauritius with gardens, museums, markets and charming towns.',
      ),
      delay: 240,
    },
  ];

  const values = [
    {
      tintBg: 'rgba(247,108,94,0.14)',
      icon: <Icon paths={ICON.heart} color={CORAL} />,
      title: t('Passion'),
      blurb: t('We love sharing the beauty and diversity of Mauritius.'),
      delay: 0,
    },
    {
      tintBg: 'rgba(233,185,73,0.2)',
      icon: <Icon paths={ICON.star} color={GOLD} />,
      title: t('Excellence'),
      blurb: t('We continuously strive for exceptional quality in everything we do.'),
      delay: 60,
    },
    {
      tintBg: 'rgba(14,140,146,0.12)',
      icon: <Icon paths={ICON.shieldLock} color={TEAL} />,
      title: t('Integrity'),
      blurb: t('Honesty, transparency and trust guide every relationship we build.'),
      delay: 120,
    },
    {
      tintBg: 'rgba(14,140,146,0.12)',
      icon: <Icon paths={ICON.sliders} color={TEAL} />,
      title: t('Personalisation'),
      blurb: t('Every traveller deserves an experience tailored to their individual expectations.'),
      delay: 180,
    },
    {
      tintBg: 'rgba(14,140,146,0.12)',
      icon: <Icon paths={ICON.leaf} color={TEAL} />,
      title: t('Sustainability'),
      blurb: t('We encourage responsible tourism that protects Mauritius for future generations.'),
      delay: 240,
    },
    {
      tintBg: 'rgba(233,185,73,0.2)',
      icon: <Icon paths={ICON.cup} color={GOLD} />,
      title: t('Hospitality'),
      blurb: t(
        'Welcoming guests with warmth, professionalism and genuine care is at the heart of everything we do.',
      ),
      delay: 300,
    },
  ];

  const faqs = [
    {
      q: t('How do I book?'),
      a: t('Booking is quick and secure through our online platform.'),
    },
    {
      q: t('Can I customise my itinerary?'),
      a: t(
        'Yes. Our travel specialists can create personalised itineraries tailored to your preferences.',
      ),
    },
    {
      q: t('Is online payment secure?'),
      a: t('Absolutely. All payments are processed through secure encrypted payment systems.'),
    },
    {
      q: t('Do you provide airport transfers?'),
      a: t('Yes. We provide island-wide airport arrival and departure services.'),
    },
    {
      q: t('Can I book private experiences?'),
      a: t('Yes. Many of our tours and activities are available as exclusive private experiences.'),
    },
    {
      q: t('What happens in case of bad weather?'),
      a: t(
        'Where required, experiences may be rescheduled or refunded in accordance with the applicable booking conditions.',
      ),
    },
    {
      q: t('Can you organise honeymoon or special occasions?'),
      a: t(
        'Yes. We create personalised experiences for honeymoons, anniversaries, birthdays, proposals and corporate events.',
      ),
    },
  ];

  const cardBase = `group flex flex-col gap-3.5 rounded-[22px] border p-[28px_26px] no-underline transition duration-300 hover:-translate-y-[7px]`;

  return (
    <div
      className={`${display.variable} ${bodyFont.variable} overflow-x-hidden`}
      style={{
        fontFamily: 'var(--font-about-body), system-ui, sans-serif',
        color: INK,
        background: CREAM,
      }}
    >
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
          style={{ minHeight: 'clamp(500px, 82vh, 760px)' }}
        >
          <HeroWaves />
          <div
            className="relative z-[2] mx-auto w-full max-w-shell"
            style={{ padding: 'clamp(20px,3vw,40px) clamp(18px,5vw,72px) clamp(96px,9vw,116px)' }}
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
                {t('The Smart Way to Experience Mauritius')}
              </span>
              <h1
                className="m-0 mt-[12px] font-extrabold text-white"
                style={{
                  ...displayFont,
                  fontSize: 'clamp(33px,5.2vw,60px)',
                  lineHeight: 1.04,
                  letterSpacing: '-0.02em',
                  textWrap: 'balance',
                }}
              >
                {t('Your Journey Begins Here')}
              </h1>
              <p
                className="mt-[16px] max-w-[620px] text-white/90"
                style={{ fontSize: 'clamp(17px,2vw,21px)', lineHeight: 1.6, textWrap: 'pretty' }}
              >
                {t(
                  'Welcome to {brand}, your trusted gateway to discovering the extraordinary beauty, vibrant culture, and unforgettable experiences that make Mauritius one of the world’s most captivating island destinations.',
                  { brand: BRAND },
                )}
              </p>
              <p className="mt-3.5 max-w-[620px] font-semibold" style={{ color: GOLD }}>
                {t('Discover more. Experience more. Create memories that last a lifetime.')}
              </p>
              <div className="mt-[24px] flex flex-wrap gap-3">
                <Link
                  href="/activities"
                  className="inline-flex items-center gap-[9px] rounded-full px-7 py-[15px] text-base font-bold text-white no-underline transition hover:-translate-y-0.5"
                  style={{ background: CORAL, boxShadow: '0 12px 30px rgba(247,108,94,0.4)' }}
                >
                  {t('Discover Experiences')}
                  <ArrowIcon />
                </Link>
                <Link
                  href="#story"
                  className="inline-flex items-center gap-[9px] rounded-full border px-[26px] py-[15px] text-base font-semibold text-white no-underline backdrop-blur-[6px] transition"
                  style={{
                    background: 'rgba(255,255,255,0.12)',
                    borderColor: 'rgba(255,255,255,0.35)',
                  }}
                >
                  {t('Read our story')}
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* ============ TRUST STRIP ============ */}
        <section
          aria-labelledby="trust-heading"
          className="relative z-[5] mx-auto max-w-shell"
          style={{ marginTop: 'clamp(-90px,-9vw,-110px)', padding: '0 clamp(18px,5vw,72px)' }}
        >
          {/* The cards are h3s, so without an h2 here the outline jumped h1 → h3. The design has no
              visible heading for this strip, so it is carried for assistive tech only — and it
              doubles as the section's accessible name. The five remaining reasons live under the
              visible "Why choose" heading further down, so this wording stays distinct. */}
          <h2 id="trust-heading" className="sr-only">
            {t('Why choose {brand} — at a glance', { brand: BRAND })}
          </h2>
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
                <h3
                  className="m-0 mb-[5px] text-[18px] font-bold tracking-[-0.01em]"
                  style={displayFont}
                >
                  {item.title}
                </h3>
                <p
                  className="m-0 text-[14.5px] leading-[1.5]"
                  style={{ color: 'rgba(17,32,31,0.66)' }}
                >
                  {item.blurb}
                </p>
              </div>
            ))}
          </div>

          {/* Credentials, kept apart from the four benefit cards above on purpose: a licence and an
              aggregate rating are verifiable facts about the company, not selling points, and they
              carry more weight when they read that way. Both are sourced — the registration number
              next to the licence, the platforms and a link to the reviews next to the score. */}
          <div
            data-reveal
            data-reveal-delay={320}
            className="mt-[clamp(12px,1.5vw,18px)] flex flex-wrap items-center gap-x-[clamp(22px,4vw,56px)] gap-y-4 rounded-[20px] border px-[22px] py-[18px]"
            style={{ background: 'rgba(14,140,146,0.07)', borderColor: 'rgba(14,140,146,0.2)' }}
          >
            <div className="flex items-center gap-3">
              <Icon paths={ICON.shieldCheck} color={TEAL} size={26} />
              <span>
                <span className="block text-[14.5px] font-bold leading-tight">
                  {t('Approved & licensed by the Mauritius Tourism Authority.')}
                </span>
                <span
                  className="block text-[12.5px] leading-tight"
                  style={{ color: 'rgba(17,32,31,0.62)' }}
                >
                  {SITE.legalName} · BRN {SITE.brn}
                </span>
              </span>
            </div>

            <Link
              href="/reviews"
              className="flex items-center gap-3 no-underline transition hover:opacity-80"
              style={{ color: 'inherit' }}
            >
              <Icon paths={ICON.star} color={GOLD} size={26} />
              <span>
                <span className="block text-[14.5px] font-bold leading-tight">
                  {t('{avg}/5 from {count} reviews', {
                    avg: reviewAverage,
                    count: reviewCount,
                  })}
                </span>
                <span
                  className="block text-[12.5px] leading-tight"
                  style={{ color: 'rgba(17,32,31,0.62)' }}
                >
                  {t('Rated across TripAdvisor & Google by real travellers.')}
                </span>
              </span>
            </Link>
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
                style={{
                  ...displayFont,
                  fontSize: 'clamp(30px,4.4vw,52px)',
                  lineHeight: 1.06,
                  letterSpacing: '-0.02em',
                  textWrap: 'balance',
                }}
              >
                {t('Mauritius is more than our destination — it is our passion')}
              </h2>
              <p
                className="mt-[22px]"
                style={{
                  fontSize: 'clamp(16px,1.7vw,18.5px)',
                  lineHeight: 1.65,
                  color: 'rgba(17,32,31,0.78)',
                  textWrap: 'pretty',
                }}
              >
                {t(
                  '{brand} was created to help travellers experience the island beyond the ordinary.',
                  { brand: BRAND },
                )}
              </p>
              <p
                className="mt-4"
                style={{
                  fontSize: 'clamp(16px,1.7vw,18.5px)',
                  lineHeight: 1.65,
                  color: 'rgba(17,32,31,0.78)',
                  textWrap: 'pretty',
                }}
              >
                {t(
                  'We believe every visitor deserves more than simply booking activities. They deserve carefully crafted experiences, genuine hospitality and personalised service that transform holidays into lifelong memories.',
                )}
              </p>
              <p
                className="mt-4"
                style={{
                  fontSize: 'clamp(16px,1.7vw,18.5px)',
                  lineHeight: 1.65,
                  color: 'rgba(17,32,31,0.78)',
                  textWrap: 'pretty',
                }}
              >
                {t(
                  'Through our expertise, commitment to excellence and passion for showcasing Mauritius, we have created a platform where visitors can confidently discover, compare and book the island’s finest travel experiences.',
                )}
              </p>
            </div>

            {/* photo collage — three layered plates, deepest first. Each carries an explicit
                aspect-ratio so the layout never shifts as they decode (CLS). */}
            <div data-reveal className="relative">
              {/* small accent plate, furthest back, peeking from behind the lead */}
              <div
                className="absolute hidden overflow-hidden rounded-[16px] sm:block"
                style={{
                  top: '8%',
                  right: '-34px',
                  width: '34%',
                  aspectRatio: '3 / 4',
                  border: `5px solid ${CREAM}`,
                  boxShadow: '0 18px 38px rgba(17,32,31,0.18)',
                  transform: 'rotate(4deg)',
                  zIndex: 0,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={STORY_PHOTOS[2]!.src}
                  alt={t(STORY_PHOTOS[2]!.alt)}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>
              <div
                className="relative overflow-hidden rounded-[24px]"
                style={{
                  boxShadow: '0 30px 60px rgba(11,92,99,0.22)',
                  aspectRatio: '4 / 5',
                  zIndex: 1,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={STORY_PHOTOS[0]!.src}
                  alt={t(STORY_PHOTOS[0]!.alt)}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
                {/* a whisper of teal so the photography sits inside the brand, not beside it */}
                <div
                  aria-hidden="true"
                  className="absolute inset-0"
                  style={{
                    background:
                      'linear-gradient(200deg, rgba(14,140,146,0) 45%, rgba(11,92,99,0.34) 100%)',
                  }}
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
                  zIndex: 2,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={STORY_PHOTOS[1]!.src}
                  alt={t(STORY_PHOTOS[1]!.alt)}
                  loading="lazy"
                  decoding="async"
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
                  // Above all three photo plates (they claim 0/1/2), or the lead photo covers it.
                  zIndex: 3,
                }}
              >
                <div className="text-[24px] font-extrabold leading-none" style={displayFont}>
                  {t('Island-wide')}
                </div>
                <div className="mt-0.5 text-[12.5px] font-semibold opacity-80">
                  {t('North · South · East · West · Central')}
                </div>
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

        {/* ============ DISCOVER EXPERIENCES ============ */}
        <section
          id="experiences"
          className="mx-auto max-w-shell scroll-mt-24"
          style={{ padding: 'clamp(24px,4vw,48px) clamp(18px,5vw,72px) clamp(56px,8vw,88px)' }}
        >
          <div data-reveal className="max-w-[760px]">
            <Eyebrow>{t('Discover experiences')}</Eyebrow>
            <h2
              className="m-0 mt-3.5 font-bold"
              style={{
                ...displayFont,
                fontSize: 'clamp(30px,4.4vw,52px)',
                lineHeight: 1.06,
                letterSpacing: '-0.02em',
                textWrap: 'balance',
              }}
            >
              {t('Every traveller is unique, and so is every journey')}
            </h2>
            <p
              className="mt-4"
              style={{
                fontSize: 'clamp(16px,1.7vw,18.5px)',
                lineHeight: 1.6,
                color: 'rgba(17,32,31,0.7)',
                textWrap: 'pretty',
              }}
            >
              {t(
                'Whether you dream of sailing across crystal-clear lagoons, exploring lush forests and waterfalls, discovering charming villages, enjoying authentic Mauritian cuisine, or simply relaxing in paradise, we make every journey effortless, memorable, and uniquely yours.',
              )}
            </p>
            <p
              className="mt-4"
              style={{
                fontSize: 'clamp(16px,1.7vw,18.5px)',
                lineHeight: 1.6,
                color: 'rgba(17,32,31,0.7)',
                textWrap: 'pretty',
              }}
            >
              {t(
                'From carefully curated excursions and private experiences to seamless transfers and bespoke holiday planning, we bring together the very best of Mauritius in one trusted platform.',
              )}
            </p>
          </div>

          <div
            className="grid gap-[clamp(12px,1.6vw,18px)]"
            style={{
              gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`,
              marginTop: 'clamp(34px,4vw,52px)',
            }}
          >
            {collections.map((item) => (
              <div
                key={item.title}
                data-reveal
                data-reveal-delay={item.delay}
                className="rounded-[20px] bg-white p-[24px_22px] transition duration-300 hover:-translate-y-[6px] motion-reduce:transform-none motion-reduce:transition-none"
                style={{
                  border: '1px solid rgba(17,32,31,0.08)',
                  borderTop: `3px solid ${item.accent}`,
                  boxShadow: '0 10px 26px rgba(17,32,31,0.05)',
                }}
              >
                <h3
                  className="m-0 mb-2 text-[19px] font-bold tracking-[-0.01em]"
                  style={displayFont}
                >
                  {item.title}
                </h3>
                <p
                  className="m-0 text-[14.5px] leading-[1.55]"
                  style={{ color: 'rgba(17,32,31,0.66)' }}
                >
                  {item.blurb}
                </p>
              </div>
            ))}
          </div>

          <div data-reveal style={{ marginTop: 'clamp(26px,3vw,36px)' }}>
            <Link
              href="/activities"
              className="inline-flex items-center gap-[9px] rounded-full px-7 py-[15px] text-base font-bold text-white no-underline transition hover:-translate-y-0.5"
              style={{ background: TEAL, boxShadow: '0 12px 30px rgba(14,140,146,0.32)' }}
            >
              {t('Browse all experiences')}
              <ArrowIcon />
            </Link>
          </div>
        </section>

        {/* ============ DISCOVER OUR SERVICES ============ */}
        <section
          id="services"
          className="scroll-mt-24"
          style={{ background: '#fff', borderTop: '1px solid rgba(17,32,31,0.06)' }}
        >
          <div
            className="mx-auto max-w-shell"
            style={{ padding: 'clamp(72px,10vw,128px) clamp(18px,5vw,72px)' }}
          >
            <div data-reveal className="max-w-[680px]">
              <Eyebrow>{t('Discover our services')}</Eyebrow>
              <h2
                className="m-0 mt-3.5 font-bold"
                style={{
                  ...displayFont,
                  fontSize: 'clamp(30px,4.4vw,52px)',
                  lineHeight: 1.06,
                  letterSpacing: '-0.02em',
                  textWrap: 'balance',
                }}
              >
                {t('Everything your Mauritius holiday needs, in one place')}
              </h2>
              <p
                className="mt-4"
                style={{
                  fontSize: 'clamp(16px,1.7vw,18.5px)',
                  lineHeight: 1.6,
                  color: 'rgba(17,32,31,0.7)',
                }}
              >
                {t(
                  'From the moment you land to the day you fly home — transfers, wheels, tours and the sea, all booked through one trusted platform.',
                )}
              </p>
            </div>

            <div
              id="tours"
              className="grid scroll-mt-24 gap-[clamp(14px,1.8vw,22px)]"
              style={{
                gridTemplateColumns: `repeat(auto-fit, minmax(270px, 1fr))`,
                marginTop: 'clamp(34px,4vw,52px)',
              }}
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
                    background: CREAM,
                    borderColor: 'rgba(17,32,31,0.08)',
                  }}
                >
                  <span
                    className="flex h-[50px] w-[50px] items-center justify-center rounded-[14px]"
                    style={{ background: card.tintBg }}
                  >
                    {card.icon}
                  </span>
                  <h3 className="m-0 text-[20px] font-bold tracking-[-0.01em]" style={displayFont}>
                    {card.title}
                  </h3>
                  <p
                    className="m-0 flex-1 text-[14.5px] leading-[1.55]"
                    style={{ color: 'rgba(17,32,31,0.66)' }}
                  >
                    {card.blurb}
                  </p>
                  <span
                    className="inline-flex items-center gap-[7px] text-[14.5px] font-bold"
                    style={{ color: card.ctaColor }}
                  >
                    {card.cta} <ArrowIcon size={14} />
                  </span>
                </Link>
              ))}

              {/* 8th card — the AI planner, our own take on "bespoke holiday planning" */}
              <Link
                href="/ai-road-trip-planner"
                data-reveal
                data-reveal-delay={70}
                className={cardBase}
                style={{
                  background: 'linear-gradient(150deg, #0E8C92, #0B5C63)',
                  color: '#fff',
                  borderColor: 'rgba(255,255,255,0.12)',
                }}
              >
                <span
                  className="flex h-[50px] w-[50px] items-center justify-center rounded-[14px]"
                  style={{ background: 'rgba(255,255,255,0.16)' }}
                >
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3z"
                      fill={GOLD}
                    />
                    <path
                      d="M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14z"
                      fill="#fff"
                    />
                  </svg>
                </span>
                <h3 className="m-0 text-[20px] font-bold tracking-[-0.01em]" style={displayFont}>
                  {t('Plan Your Trip with AI')}
                </h3>
                <p
                  className="m-0 flex-1 text-[14.5px] leading-[1.55]"
                  style={{ color: 'rgba(255,255,255,0.82)' }}
                >
                  {t(
                    'Tell us your dates, interests and pace — and get a tailored island itinerary in seconds.',
                  )}
                </p>
                <span
                  className="inline-flex items-center gap-[7px] text-[14.5px] font-bold"
                  style={{ color: GOLD }}
                >
                  {t('Plan my trip')} <ArrowIcon size={14} />
                </span>
              </Link>
            </div>
          </div>
        </section>

        {/* ============ FULL-BLEED PULL-QUOTE BAND ============
            The page's one photographic statement. It sits directly above the dark "why" section and
            its scrim resolves to the same TEAL_DARK, so the two read as a single dark passage
            rather than two stacked blocks — that continuity is why it lives here and not earlier.
            The photo is atmospheric on purpose: it claims no location (see about-photos.ts). */}
        <section
          // Labelled by the short eyebrow, not the quote — pointing at the blockquote would make
          // the region's accessible name the whole sentence.
          aria-labelledby="band-eyebrow"
          className="relative flex items-center overflow-hidden"
          style={{ minHeight: 'clamp(420px, 62vh, 620px)' }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={BAND_PHOTO.src}
            alt={t(BAND_PHOTO.alt)}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
          />
          {/* Three scrims, each doing one job — a flat overlay dark enough for AA would have
              smothered the photograph:
              1. a light teal wash, so the image reads as ours rather than as stock;
              2. a DIRECTIONAL ramp that darkens only the left, where the quote sits, leaving the
                 right side of the frame open;
              3. a bottom ramp to TEAL_DARK so this melts into the dark section beneath. */}
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, rgba(3,38,43,0.28) 0%, rgba(10,73,83,0.30) 45%, rgba(11,92,99,0.85) 100%)',
            }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              // Holds ≥0.72 alpha right across the quote's measure (it runs to ~860px) and only
              // opens up past it. A softer mid-stop tested under 3:1 against the bright sky.
              background:
                'linear-gradient(100deg, rgba(3,38,43,0.86) 0%, rgba(3,38,43,0.74) 46%, rgba(3,38,43,0.34) 74%, rgba(3,38,43,0) 96%)',
            }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 h-[34%]"
            style={{
              background: `linear-gradient(180deg, rgba(11,92,99,0) 0%, ${TEAL_DARK} 100%)`,
            }}
          />

          <div
            className="relative z-[2] mx-auto w-full max-w-shell text-white"
            style={{ padding: 'clamp(56px,8vw,96px) clamp(18px,5vw,72px)' }}
          >
            <div className="max-w-[860px]">
              <span id="band-eyebrow">
                <Eyebrow color={GOLD}>{t('Our purpose')}</Eyebrow>
              </span>
              <blockquote
                className="m-0 mt-5 font-bold"
                style={{
                  ...displayFont,
                  fontSize: 'clamp(27px,4.6vw,54px)',
                  lineHeight: 1.1,
                  letterSpacing: '-0.02em',
                  textWrap: 'balance',
                  textShadow: '0 2px 22px rgba(3,38,43,0.45)',
                }}
              >
                {t(
                  'Our purpose is simple: to help every traveller experience the true spirit of Mauritius.',
                )}
              </blockquote>
              <p
                className="mt-6 text-[15px] font-semibold"
                style={{ color: 'rgba(255,255,255,0.82)' }}
              >
                {t('Discover more. Experience more. Create memories that last a lifetime.')}
              </p>
            </div>
          </div>
        </section>

        {/* ============ WHY CHOOSE US ============ */}
        <section
          id="why"
          className="relative overflow-hidden text-white"
          style={{ background: TEAL_DARK }}
        >
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
                <Eyebrow color={GOLD}>{t('Why choose us')}</Eyebrow>
                <h2
                  className="m-0 mt-3.5 font-bold text-white"
                  style={{
                    ...displayFont,
                    fontSize: 'clamp(30px,4.4vw,50px)',
                    lineHeight: 1.07,
                    letterSpacing: '-0.02em',
                    textWrap: 'balance',
                  }}
                >
                  {t('Why Choose {brand}', { brand: BRAND })}
                </h2>
                <p
                  className="mt-[22px] text-white/85"
                  style={{
                    fontSize: 'clamp(16px,1.7vw,18.5px)',
                    lineHeight: 1.65,
                    textWrap: 'pretty',
                  }}
                >
                  {t(
                    'Curated experiences, destination expertise and secure payments are only the start. Here is what else you get every time you book with us.',
                  )}
                </p>
              </div>

              <div data-reveal className="flex flex-col gap-3.5">
                {reasons.map((row) => (
                  <div
                    key={row.title}
                    className="flex items-start gap-4 rounded-[18px] border p-[20px_22px]"
                    style={{
                      background: 'rgba(255,255,255,0.07)',
                      borderColor: 'rgba(255,255,255,0.12)',
                    }}
                  >
                    <span
                      className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px]"
                      style={{ background: row.tintBg }}
                    >
                      {row.icon}
                    </span>
                    <div>
                      <h3
                        className="m-0 mb-[3px] text-[17px] font-bold text-white"
                        style={displayFont}
                      >
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

        {/* ============ EXPLORE MAURITIUS ============ */}
        <section
          id="island"
          className="mx-auto max-w-shell"
          style={{ padding: 'clamp(72px,10vw,128px) clamp(18px,5vw,72px)' }}
        >
          <div data-reveal className="max-w-[680px]">
            <Eyebrow>{t('Explore Mauritius')}</Eyebrow>
            <h2
              className="m-0 mt-3.5 font-bold"
              style={{
                ...displayFont,
                fontSize: 'clamp(30px,4.4vw,52px)',
                lineHeight: 1.06,
                letterSpacing: '-0.02em',
                textWrap: 'balance',
              }}
            >
              {t('Every region tells a different story')}
            </h2>
            <p
              className="mt-4"
              style={{
                fontSize: 'clamp(16px,1.7vw,18.5px)',
                lineHeight: 1.6,
                color: 'rgba(17,32,31,0.7)',
              }}
            >
              {t('Every journey reveals something unforgettable.')}
            </p>
          </div>

          <div
            className="grid gap-[clamp(12px,1.6vw,18px)]"
            style={{
              gridTemplateColumns: `repeat(auto-fit, minmax(210px, 1fr))`,
              marginTop: 'clamp(34px,4vw,52px)',
            }}
          >
            {regions.map((region) => {
              const cardStyle: CSSProperties = region.highlight
                ? {
                    background: 'linear-gradient(150deg, #0E8C92, #0B5C63)',
                    color: '#fff',
                    boxShadow: '0 22px 48px rgba(11,92,99,0.3)',
                  }
                : {
                    background: '#fff',
                    border: '1px solid rgba(17,32,31,0.08)',
                    boxShadow: '0 10px 26px rgba(17,32,31,0.05)',
                  };
              return (
                <div
                  key={region.title}
                  data-reveal
                  data-reveal-delay={region.delay}
                  className="group relative overflow-hidden rounded-[20px] p-[24px_22px] transition-[transform,box-shadow] duration-300 hover:-translate-y-[6px] motion-reduce:transform-none motion-reduce:transition-none"
                  style={cardStyle}
                >
                  {/* A contour-line motif — the shape of a coast without claiming to BE one, which
                      is the honest way to illustrate these cards until we own location photos.
                      Decorative, so it never reaches the accessibility tree. */}
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 200 120"
                    preserveAspectRatio="none"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-[62%] w-full opacity-[0.13] transition-opacity duration-300 group-hover:opacity-25 motion-reduce:transition-none"
                  >
                    {[0, 14, 28, 42].map((offset) => (
                      <path
                        key={offset}
                        d={`M-10 ${86 - offset} C 30 ${70 - offset}, 62 ${104 - offset}, 104 ${84 - offset} S 172 ${62 - offset}, 210 ${80 - offset}`}
                        fill="none"
                        stroke={region.highlight ? GOLD : TEAL}
                        strokeWidth="2"
                        strokeLinecap="round"
                      />
                    ))}
                  </svg>

                  <div
                    className="relative flex items-center gap-[9px] text-[13px] font-bold uppercase tracking-[0.08em]"
                    style={{ color: region.highlight ? GOLD : TEAL }}
                  >
                    <PinIcon color={region.highlight ? GOLD : TEAL} />
                    {region.tag}
                  </div>
                  {/* `relative` on the text too: the motif is positioned, so without it the SVG
                      would paint over these static blocks. */}
                  <h3
                    className="relative mb-1.5 mt-3 text-[18px] font-bold tracking-[-0.01em]"
                    style={{ ...displayFont, color: region.highlight ? '#fff' : INK }}
                  >
                    {region.title}
                  </h3>
                  <p
                    className="relative m-0 text-[14px] leading-[1.5]"
                    style={{
                      color: region.highlight ? 'rgba(255,255,255,0.8)' : 'rgba(17,32,31,0.62)',
                    }}
                  >
                    {region.blurb}
                  </p>
                </div>
              );
            })}
          </div>
        </section>

        {/* ============ VISION · MISSION · VALUES ============ */}
        <section
          id="vision"
          className="scroll-mt-24"
          style={{ background: '#fff', borderTop: '1px solid rgba(17,32,31,0.06)' }}
        >
          <div
            className="mx-auto max-w-shell"
            style={{ padding: 'clamp(72px,10vw,128px) clamp(18px,5vw,72px)' }}
          >
            <div
              className="grid gap-[clamp(14px,1.8vw,22px)]"
              style={{ gridTemplateColumns: `repeat(auto-fit, minmax(300px, 1fr))` }}
            >
              <div
                data-reveal
                className="rounded-[22px] p-[32px_30px] text-white"
                style={{
                  background: 'linear-gradient(150deg, #0E8C92, #0B5C63)',
                  boxShadow: '0 22px 48px rgba(11,92,99,0.28)',
                }}
              >
                <Eyebrow color={GOLD}>{t('Our vision')}</Eyebrow>
                <p
                  className="m-0 mt-4 font-bold text-white"
                  style={{
                    ...displayFont,
                    fontSize: 'clamp(20px,2.4vw,27px)',
                    lineHeight: 1.28,
                    letterSpacing: '-0.01em',
                    textWrap: 'pretty',
                  }}
                >
                  {t(
                    'To become the leading digital travel platform for Mauritius by inspiring travellers through exceptional experiences, innovative services and world-class hospitality.',
                  )}
                </p>
              </div>
              <div
                data-reveal
                data-reveal-delay={80}
                className="rounded-[22px] border p-[32px_30px]"
                style={{ background: CREAM, borderColor: 'rgba(17,32,31,0.08)' }}
              >
                <Eyebrow>{t('Our mission')}</Eyebrow>
                <p
                  className="m-0 mt-4 font-bold"
                  style={{
                    ...displayFont,
                    fontSize: 'clamp(20px,2.4vw,27px)',
                    lineHeight: 1.28,
                    letterSpacing: '-0.01em',
                    textWrap: 'pretty',
                  }}
                >
                  {t(
                    'To connect travellers with the finest experiences Mauritius has to offer while delivering outstanding customer service, secure bookings and personalised travel solutions that exceed expectations.',
                  )}
                </p>
              </div>
            </div>

            <div data-reveal style={{ marginTop: 'clamp(48px,6vw,80px)' }}>
              <Eyebrow>{t('Our values')}</Eyebrow>
              <h2
                className="m-0 mt-3.5 max-w-[680px] font-bold"
                style={{
                  ...displayFont,
                  fontSize: 'clamp(30px,4.4vw,52px)',
                  lineHeight: 1.06,
                  letterSpacing: '-0.02em',
                  textWrap: 'balance',
                }}
              >
                {t('What we stand for')}
              </h2>
            </div>

            <div
              className="grid gap-[clamp(12px,1.6vw,18px)]"
              style={{
                gridTemplateColumns: `repeat(auto-fit, minmax(240px, 1fr))`,
                marginTop: 'clamp(28px,3.4vw,44px)',
              }}
            >
              {values.map((value) => (
                <div
                  key={value.title}
                  data-reveal
                  data-reveal-delay={value.delay}
                  className="rounded-[20px] border p-[24px_22px] transition duration-300 hover:-translate-y-[6px] motion-reduce:transform-none motion-reduce:transition-none"
                  style={{ background: CREAM, borderColor: 'rgba(17,32,31,0.08)' }}
                >
                  <div
                    className="mb-3.5 flex h-11 w-11 items-center justify-center rounded-xl"
                    style={{ background: value.tintBg }}
                  >
                    {value.icon}
                  </div>
                  <h3
                    className="m-0 mb-[5px] text-[18px] font-bold tracking-[-0.01em]"
                    style={displayFont}
                  >
                    {value.title}
                  </h3>
                  <p
                    className="m-0 text-[14.5px] leading-[1.5]"
                    style={{ color: 'rgba(17,32,31,0.66)' }}
                  >
                    {value.blurb}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ============ FAQ ============ */}
        <section id="faq">
          <div
            className="mx-auto max-w-[880px]"
            style={{ padding: 'clamp(72px,10vw,128px) clamp(18px,5vw,72px)' }}
          >
            <div
              data-reveal
              className="text-center"
              style={{ marginBottom: 'clamp(34px,4vw,52px)' }}
            >
              <Eyebrow>{t('Good to know')}</Eyebrow>
              <h2
                className="m-0 mt-3.5 font-bold"
                style={{
                  ...displayFont,
                  fontSize: 'clamp(30px,4.4vw,50px)',
                  lineHeight: 1.07,
                  letterSpacing: '-0.02em',
                  textWrap: 'balance',
                }}
              >
                {t('Frequently Asked Questions')}
              </h2>
            </div>
            <div className="flex flex-col gap-3">
              {faqs.map((faq, i) => (
                <details
                  key={faq.q}
                  data-reveal
                  open={i === 0}
                  className="group overflow-hidden rounded-[16px] border"
                  style={{ background: '#fff', borderColor: 'rgba(17,32,31,0.08)' }}
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
                    <span
                      className="flex-none transition-transform duration-300 group-open:rotate-180"
                      style={{ color: TEAL }}
                    >
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
        <section
          className="relative overflow-hidden text-white"
          style={{ background: 'linear-gradient(150deg, #11201F, #0B5C63)' }}
        >
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
            <Eyebrow color={GOLD}>{t('Start planning your adventure today')}</Eyebrow>
            <h2
              className="mx-auto mt-4 font-extrabold text-white"
              style={{
                ...displayFont,
                fontSize: 'clamp(32px,5vw,58px)',
                lineHeight: 1.04,
                letterSpacing: '-0.02em',
                maxWidth: '16ch',
                textWrap: 'balance',
              }}
            >
              {t('Let Your Mauritius Story Begin')}
            </h2>
            <p
              className="mx-auto mt-[18px] max-w-[600px] text-white/85"
              style={{ fontSize: 'clamp(16px,1.9vw,19px)', lineHeight: 1.6 }}
            >
              {t(
                'Whether you’re planning your first visit or returning to discover something new, {brand} is here to make every moment unforgettable.',
                { brand: BRAND },
              )}
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-3.5">
              <a
                href={whatsappUrl(t('Hi! I’d like to plan my trip to Mauritius.'))}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2.5 rounded-full px-[30px] py-4 text-[17px] font-bold no-underline transition hover:-translate-y-0.5"
                style={{
                  background: '#25D366',
                  color: '#0a2e16',
                  boxShadow: '0 14px 34px rgba(37,211,102,0.36)',
                }}
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38c1.45.79 3.08 1.21 4.79 1.21 5.46 0 9.91-4.45 9.91-9.92C21.95 6.45 17.5 2 12.04 2zm5.8 14.04c-.24.68-1.4 1.3-1.94 1.38-.5.07-1.13.1-1.82-.11-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.8-4.17-4.94-4.36-.15-.19-1.19-1.58-1.19-3.01 0-1.43.75-2.13 1.02-2.42.27-.29.59-.36.79-.36.2 0 .39.002.56.01.18.008.42-.07.66.5.24.59.82 2.04.89 2.18.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.17-.29.37-.42.5-.14.14-.28.29-.12.57.16.28.71 1.17 1.53 1.9 1.05.94 1.94 1.23 2.22 1.37.28.14.44.12.6-.07.16-.19.69-.81.88-1.09.18-.28.37-.23.61-.14.25.09 1.58.74 1.85.88.27.14.45.21.51.32.07.11.07.64-.17 1.32z" />
                </svg>
                {t('Talk to a travel specialist')}
              </a>
              <Link
                href="/activities"
                className="inline-flex items-center gap-[9px] rounded-full px-[30px] py-4 text-[17px] font-bold text-white no-underline transition hover:-translate-y-0.5"
                style={{ background: CORAL, boxShadow: '0 14px 34px rgba(247,108,94,0.4)' }}
              >
                {t('Discover Experiences')}
                <ArrowIcon />
              </Link>
            </div>
            <p className="mt-[26px] text-[13.5px] text-white/60">
              {t('Explore. Discover. Experience Mauritius Like Never Before.')}
            </p>
            {/* Pexels does not require attribution — we credit anyway, and keeping the line here
                makes it obvious at a glance which photography is still licensed stock rather than
                Belle Mare Tours' own. It disappears the moment about-photos.ts points at our own
                shoot. */}
            <p className="mt-4 text-[12px] text-white/40">
              {t('Photography')}: {PHOTO_CREDITS.join(' · ')} (Pexels)
            </p>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/about', DEFAULT_METADATA);
}
