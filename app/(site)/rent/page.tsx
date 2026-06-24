import type { Metadata } from 'next';
import { InfoPage, InfoSection, FeatureList, EnquireRow } from '@/components/site/InfoPage';
import { SITE } from '@/lib/seo/site';
import { getT } from '@/lib/i18n/server';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: `Car & Scooter Rental in Mauritius | ${SITE.operator}`,
  description:
    'Rent a car or scooter on Mauritius with Belle Mare Tours. Free delivery to your hotel on the east coast, full insurance, and local support throughout your stay.',
  alternates: { canonical: '/rent' },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/rent`,
    title: `Car & Scooter Rental in Mauritius | ${SITE.operator}`,
    description:
      'Rent a car or scooter on Mauritius with Belle Mare Tours — free hotel delivery, full insurance and local support throughout your stay.',
    locale: 'en_GB',
  },
};

export default async function RentPage() {
  const t = await getT();
  return (
    <InfoPage
      eyebrow={t('Rent')}
      title={t('Rent a car or scooter and explore at your own pace')}
      intro={t('Self-drive is the best way to see Mauritius beyond the resort. We deliver to your hotel or Airbnb on the east coast, hand over a clean, insured vehicle, and stay one message away the whole trip.')}
    >
      <InfoSection id="car" title={t('Rent a car')}>
        <p>
          {t('From compact hatchbacks for two to family SUVs, our cars are well-maintained, air-conditioned and fully insured. We drive on the left in Mauritius; an international or home licence is fine.')}
        </p>
        <FeatureList
          items={[
            'Free delivery & collection at your east-coast hotel or Airbnb',
            'Full insurance and 24/7 roadside support included',
            'Unlimited mileage — the whole island is yours',
            'Baby seats and extra drivers available on request',
          ]}
        />
      </InfoSection>

      <InfoSection id="scooter" title={t('Rent a scooter')}>
        <p>
          {t('Perfect for short hops along the coast and into Belle Mare village. Scooters come with two helmets and a quick handover so you’re on the road in minutes.')}
        </p>
        <FeatureList
          items={[
            'Two helmets and a lock included',
            'Delivered to your door, fuelled and ready',
            'Ideal for the Belle Mare / Trou d’Eau Douce coast',
            'Daily and weekly rates — ask for a quote',
          ]}
        />
      </InfoSection>

      <EnquireRow message={t('Hi Belle Mare Tours! I’d like to rent a car / scooter. Could you send rates and availability?')} />
    </InfoPage>
  );
}
