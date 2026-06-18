import type { Metadata } from 'next';
import { InfoPage, InfoSection, FeatureList, EnquireRow } from '@/components/site/InfoPage';
import { SITE } from '@/lib/seo/site';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: `Taxi & Private Driver in Mauritius | ${SITE.operator}`,
  description:
    'Hire a trusted taxi or private driver in Mauritius by the trip or the day. Fixed prices, local knowledge, and a friendly driver who knows the island.',
  alternates: { canonical: '/taxi' },
};

export default async function TaxiPage() {
  const t = await getT();
  return (
    <InfoPage
      eyebrow={t('Taxi')}
      title={t('A trusted taxi and private driver, whenever you need one')}
      intro={t('Need to get somewhere, or want a driver for the day? Our local drivers know every corner of the island and quote a fair, fixed price before you set off — no meters, no surprises.')}
    >
      <InfoSection title={t('By the trip or by the day')}>
        <p>
          {t('Book a one-way ride to dinner, a shopping run to a mall, or a full day with a driver who doubles as a guide — stopping wherever you like along the way. Popular day routes include the north (Grand Baie, Cap Malheureux) and the south-west (Chamarel, Black River Gorges).')}
        </p>
        <FeatureList
          items={[
            'Fixed price agreed before the trip',
            'Friendly, English- and French-speaking local drivers',
            'Clean, air-conditioned vehicles',
            'Day hire with as many stops as you like',
            'Available across the whole island, day or night',
          ]}
        />
      </InfoSection>

      <EnquireRow message={t('Hi Belle Mare Tours! I’d like to book a taxi / private driver. Here’s what I need:')} />
    </InfoPage>
  );
}
