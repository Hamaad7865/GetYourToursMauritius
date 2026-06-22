import type { Metadata } from 'next';
import { InfoPage, InfoSection, FeatureList, EnquireRow, BrowseLink } from '@/components/site/InfoPage';
import { SITE } from '@/lib/seo/site';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: `About ${SITE.operator}`,
  description: `GetYourToursMauritius is the official booking site for ${SITE.operator} — a local, family-run operator on Mauritius' east coast founded by driver-guides Noorani and Satar. Book the same tours, transfers and rentals directly, with transparent fixed prices and no reseller commission.`,
  alternates: { canonical: '/about' },
};

export default async function AboutPage() {
  const t = await getT();
  return (
    <InfoPage
      eyebrow={t('About us')}
      title={t('Mauritius, shown to you by the people who live here')}
      heroImage="/hero/islands/aerial-lagoon.jpg"
      intro={t('GetYourToursMauritius is the home of {operator} — a local, family-run operator based on the Royal Road in Belle Mare, on Mauritius’ east coast. We run our own boats and driver-guides, so when you book here you book direct, with the people who actually show you the island and no reseller in between.', { operator: SITE.operator })}
    >
      <InfoSection title={t('Who we are')}>
        <p>
          {t('{operator} was started by Noorani and Satar, two of the island’s most experienced and best-known driver-guides. What began as a pair of trusted guides has grown into a family-run operator approved by the Mauritius Tourism Authority and recommended by travellers on TripAdvisor and the Routard forums for years.', { operator: SITE.operator })}
        </p>
        <p className="mt-3.5">
          {t('Our promise is simple: the same driver-guide looks after you from morning pickup to evening drop-off — you’re never handed between taxis or swapped to a stranger halfway through the day. We show you the Mauritius we grew up with — the lagoons off Belle Mare, the catamaran run to Île aux Cerfs, dolphin swims on the west coast, the hikes, and the markets of Port Louis — and we handle everything in between, from airport transfers to car rental.')}
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
        <FeatureList
          items={[
            'Family-run by Noorani and Satar, two of the island’s most experienced driver-guides',
            'The same driver-guide all day — never passed between taxis mid-trip',
            'Approved by the Mauritius Tourism Authority; trusted on TripAdvisor and Routard for years',
            'Direct fixed prices in euros, with instant e-voucher confirmation',
            'English- and French-speaking guides; hotel, Airbnb and cruise-port pickup island-wide',
            'Free cancellation up to 24 hours before most activities',
          ]}
        />
        <BrowseLink />
      </InfoSection>

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
  );
}
