import type { Metadata } from 'next';
import Link from 'next/link';
import { InfoPage, InfoSection, FeatureList, EnquireRow } from '@/components/site/InfoPage';
import { JsonLd } from '@/components/seo/JsonLd';
import { organizationJsonLd, breadcrumbListJsonLd, faqPageJsonLd } from '@/lib/seo/jsonld';
import { SITE } from '@/lib/seo/site';
import { getT } from '@/lib/i18n/server';
import {
  IconShield,
  IconStar,
  IconUsers,
  IconWallet,
  IconPin,
  IconGlobe,
  IconHeart,
  IconBolt,
  IconCalendar,
  IconArrowRight,
} from '@/components/ui/icons';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'About Belle Mare Tours — Local Mauritius Tour Operator',
  description:
    'Belle Mare Tours is a local Mauritius tour operator on the east coast, founded by driver-guides Noorani and Satar. Private sightseeing tours, catamaran cruises to Île aux Cerfs, dolphin swims, airport transfers and car rental — book direct with transparent fixed prices, instant confirmation and no reseller commission.',
  alternates: { canonical: '/about' },
  openGraph: {
    type: 'website',
    title: 'About Belle Mare Tours — Local Mauritius Tour Operator',
    description:
      'Belle Mare Tours is a local Mauritius tour operator on the east coast, founded by driver-guides Noorani and Satar. Private sightseeing tours, catamaran cruises to Île aux Cerfs, dolphin swims, airport transfers and car rental — book direct with transparent fixed prices, instant confirmation and no reseller commission.',
    url: `${SITE.url}/about`,
    images: [{ url: `${SITE.url}/hero/islands/aerial-lagoon.jpg` }],
  },
};

export default async function AboutPage() {
  const t = await getT();

  const trust = [
    { icon: IconShield, label: t('Approved by the Mauritius Tourism Authority') },
    { icon: IconStar, label: t('4.8★ from 1,000+ TripAdvisor & Google reviews') },
    { icon: IconUsers, label: t('The same driver-guide all day') },
    { icon: IconWallet, label: t('Book direct — no reseller commission') },
  ];

  const offerings = [
    {
      href: '/activities',
      icon: IconPin,
      title: t('Private sightseeing tours'),
      blurb: t('Tailor-made island days with your own private driver-guide.'),
    },
    {
      href: '/activities',
      icon: IconGlobe,
      title: t('Catamaran cruises & Île aux Cerfs'),
      blurb: t('Sail the east-coast lagoon with snorkelling and a beach barbecue.'),
    },
    {
      href: '/activities',
      icon: IconHeart,
      title: t('Dolphin swims & sea trips'),
      blurb: t('Early-morning dolphin encounters off the west coast.'),
    },
    {
      href: '/airport-transfers',
      icon: IconCalendar,
      title: t('Airport transfers'),
      blurb: t('Fixed-price private transfers to and from SSR Airport.'),
    },
    {
      href: '/rent',
      icon: IconWallet,
      title: t('Car & scooter rental'),
      blurb: t('Self-drive the island, delivered to your hotel.'),
    },
    {
      href: '/ai-road-trip-planner',
      icon: IconBolt,
      title: t('Build a custom day with AI'),
      blurb: t('Design your own route and get an instant quote.'),
    },
  ];

  const faqs = [
    {
      q: t('Is Belle Mare Tours a licensed tour operator?'),
      a: t('Yes. Belle Mare Tours is a local operator approved by the Mauritius Tourism Authority, with licensed, insured driver-guides.'),
    },
    {
      q: t('Which areas of Mauritius do you cover?'),
      a: t('We’re based in Belle Mare on the east coast and cover the whole island — north, south, east, west and the central plateau — with door-to-door pickup.'),
    },
    {
      q: t('Do you offer hotel and airport pickup?'),
      a: t('Yes. We pick up from any hotel, Airbnb or cruise port in Mauritius, and run fixed-price private airport transfers to and from SSR Airport.'),
    },
    {
      q: t('Are your tours private?'),
      a: t('Yes — every tour is private by default. It’s just your group and your own driver-guide for the day.'),
    },
    {
      q: t('How do I pay, and what does it cost?'),
      a: t('You book online with transparent fixed prices in euros and pay securely by card. Booking direct means there’s no reseller commission on top.'),
    },
    {
      q: t('Can I change or cancel my booking?'),
      a: t('Most activities offer free cancellation up to 24 hours before, and you can tailor any itinerary — just ask.'),
    },
  ];

  return (
    <>
      <JsonLd data={organizationJsonLd()} />
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'About', path: '/about' },
        ])}
      />
      <JsonLd data={faqPageJsonLd(faqs)} />

      <InfoPage
        eyebrow={t('About Belle Mare Tours')}
        title={t('Mauritius tours, shown to you by the people who live here')}
        heroImage="/hero/islands/aerial-lagoon.jpg"
        intro={t('{operator} is a local operator on Mauritius’ east coast, run by driver-guides Noorani and Satar. We run our own boats and guides — book direct, with the people who actually show you the island and no reseller in between.', { operator: SITE.operator })}
      >
        {/* Section A — trust strip */}
        <ul className="m-0 grid list-none grid-cols-2 gap-3 p-0 lg:grid-cols-4">
          {trust.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className="flex min-h-[44px] items-center gap-3 rounded-2xl border border-ink/10 bg-cream/50 px-4 py-3.5"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal/10 text-teal">
                <Icon width={18} height={18} />
              </span>
              <span className="text-[13.5px] font-semibold leading-snug text-ink">{label}</span>
            </li>
          ))}
        </ul>

        {/* Section B — Who we are */}
        <InfoSection title={t('Who we are')}>
          <p>
            {t('{operator} was started by Noorani and Satar, two of the island’s most experienced and best-known driver-guides. What began as a pair of trusted guides has grown into an established local operator approved by the Mauritius Tourism Authority and recommended by travellers on TripAdvisor and the Routard forums for years.', { operator: SITE.operator })}
          </p>
          <p className="mt-3.5">
            {t('Our promise is simple: the same driver-guide looks after you from morning pickup to evening drop-off — you’re never handed between taxis or swapped to a stranger halfway through the day. We show you the Mauritius we grew up with — the lagoons off Belle Mare, the catamaran run to Île aux Cerfs, dolphin swims on the west coast, the hikes, and the markets of Port Louis.')}
          </p>
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <figure className="overflow-hidden rounded-2xl border border-ink/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/hero/islands/speedboat.jpg"
                alt={t('A speedboat crossing a turquoise Mauritius lagoon')}
                loading="lazy"
                className="aspect-[4/3] w-full object-cover"
              />
            </figure>
            <figure className="overflow-hidden rounded-2xl border border-ink/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/activities/pereybere-beach.jpg"
                alt={t('Pereybère beach on the north coast of Mauritius')}
                loading="lazy"
                className="aspect-[4/3] w-full object-cover"
              />
            </figure>
          </div>
        </InfoSection>

        {/* Section C — What we offer */}
        <InfoSection title={t('What we offer')}>
          <p>{t('Everything for your trip, run or hand-picked by us:')}</p>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {offerings.map(({ href, icon: Icon, title, blurb }) => (
              <Link
                key={title}
                href={href}
                className="group flex flex-col gap-3 rounded-2xl border border-ink/10 bg-white p-5 transition hover:-translate-y-0.5 hover:border-teal/40 hover:shadow-lg hover:shadow-teal/5"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal/10 text-teal">
                  <Icon width={20} height={20} />
                </span>
                <span className="flex items-center gap-1.5 text-[15px] font-extrabold tracking-tight text-ink">
                  {title}
                  <IconArrowRight
                    width={15}
                    height={15}
                    className="text-teal opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100"
                  />
                </span>
                <span className="text-[13.5px] leading-relaxed text-ink/70">{blurb}</span>
              </Link>
            ))}
          </div>
        </InfoSection>

        {/* Section D — Why we built GetYourToursMauritius */}
        <InfoSection title={t('Why we built GetYourToursMauritius')}>
          <p>
            {t('For years, travellers found us by word of mouth, on forums, or through big international booking sites. Those platforms are useful, but they take a heavy commission — which either pushes up the price you pay or comes out of what reaches the local family and guides running your day.')}
          </p>
          <p className="mt-3.5">
            {t('We wanted something better, for our guests and for our team: a place to book the very same tours, with the very same guides, directly. So we built GetYourToursMauritius — transparent fixed prices in euros, instant e-voucher confirmation, secure online payment, free cancellation, and door-to-door pickup, with no middleman taking a cut.')}
          </p>
          <p className="mt-3.5">
            {t('Booking direct keeps more of what you pay with the people who show you the island — and it lets us stay flexible: tailor an itinerary, arrange a private departure, or combine a tour with a transfer and a rental car in one trip.')}
          </p>
          <FeatureList
            items={[
              'Run by Noorani and Satar, two of the island’s most experienced driver-guides',
              'The same driver-guide all day — never passed between taxis mid-trip',
              'Approved by the Mauritius Tourism Authority; trusted on TripAdvisor and Routard for years',
              'Direct fixed prices in euros, with instant e-voucher confirmation',
              'English- and French-speaking guides; hotel, Airbnb and cruise-port pickup island-wide',
              'Free cancellation up to 24 hours before most activities',
            ]}
          />
        </InfoSection>

        {/* Section E — Across the whole island */}
        <InfoSection title={t('Across the whole island')}>
          <p>
            {t('Based in Belle Mare on the east coast, we run tours and transfers right across Mauritius — the North (Grand Baie, Cap Malheureux, Pamplemousses), the East (Belle Mare, Île aux Cerfs, Trou d’Eau Douce), the South (Chamarel, Le Morne, Gris Gris), the West (Flic-en-Flac, Tamarin, Casela) and the cooler Central plateau (Trou aux Cerfs, Curepipe).')}
          </p>
          <Link
            href="/attractions"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-bold text-teal hover:text-teal-dark"
          >
            {t('Explore things to do across Mauritius')} <IconArrowRight width={16} height={16} />
          </Link>
        </InfoSection>

        {/* Section F — Frequently asked questions */}
        <InfoSection title={t('Frequently asked questions')}>
          <div className="flex flex-col gap-2.5">
            {faqs.map((f) => (
              <details
                key={f.q}
                className="group rounded-xl border border-ink/10 bg-white px-4 py-3 open:bg-cream/40"
              >
                <summary className="cursor-pointer list-none text-[15px] font-bold text-ink marker:hidden">
                  {f.q}
                </summary>
                <p className="mt-2 text-[14.5px] leading-relaxed text-ink/75">{f.a}</p>
              </details>
            ))}
          </div>
        </InfoSection>

        <figure className="mt-9 overflow-hidden rounded-2xl border border-ink/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/hero/islands/blue-lagoon.jpg"
            alt={t('A boat anchored over a clear blue Mauritius lagoon')}
            loading="lazy"
            className="aspect-[16/7] w-full object-cover"
          />
        </figure>

        <EnquireRow message={t('Hi Belle Mare Tours! I’d like to know more about your tours.')} />
      </InfoPage>
    </>
  );
}
