import type { Metadata } from 'next';
import { InfoPage, InfoSection, FeatureList, EnquireRow } from '@/components/site/InfoPage';
import { SITE } from '@/lib/seo/site';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: `Airport Transfers in Mauritius | ${SITE.operator}`,
  description:
    'Private airport transfers between SSR International Airport and your Mauritius hotel. Meet & greet, fixed prices, child seats, and a driver tracking your flight.',
  alternates: { canonical: '/airport-transfer' },
};

export default async function AirportTransferPage() {
  const t = await getT();
  return (
    <InfoPage
      eyebrow={t('Airport transfer')}
      title={t('Private airport transfers, door to door')}
      intro={t('Start and end your holiday the easy way. Your driver meets you in the arrivals hall, helps with the bags, and takes you straight to your hotel — and back again when it’s time to fly home.')}
    >
      <InfoSection title={t('How it works')}>
        <p>
          {t('We cover SSR International Airport (MRU) to and from anywhere on the island, with a focus on the east coast — Belle Mare, Trou d’Eau Douce, Palmar and Poste Lafayette. Prices are fixed and agreed up front, with no surge pricing.')}
        </p>
        <FeatureList
          items={[
            'Meet & greet in arrivals with a name board',
            'Your driver tracks your flight — no penalty for delays',
            'Fixed, all-in price agreed before you travel',
            'Modern, air-conditioned vehicles; child seats on request',
            'Private — your party only, no sharing',
          ]}
        />
      </InfoSection>

      <EnquireRow message={t('Hi Belle Mare Tours! I’d like an airport transfer. Here are my flight details and hotel:')} />
    </InfoPage>
  );
}
