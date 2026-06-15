import type { Metadata } from 'next';
import { InfoPage, InfoSection, FeatureList, EnquireRow, BrowseLink } from '@/components/site/InfoPage';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: `About ${SITE.operator}`,
  description: `${SITE.operator} is a local, family-run tour operator on Mauritius' east coast — catamaran cruises, island days, transfers and rentals booked direct with no reseller markup.`,
  alternates: { canonical: '/about' },
};

export default function AboutPage() {
  return (
    <InfoPage
      eyebrow="About us"
      title={`Mauritius, shown to you by the people who live here`}
      intro={`${SITE.operator} is a local, family-run operator based in Belle Mare on Mauritius' east coast. We run our own boats and work with hand-picked drivers and guides — so when you book with us, you book direct, with no reseller in the middle.`}
    >
      <InfoSection title="Who we are">
        <p>
          We started {SITE.operator} to share the Mauritius we grew up with — the lagoons off
          Belle Mare, the catamaran runs to Île aux Cerfs, the quiet north coast and the markets of
          Port Louis. Every experience on this site is one we operate or personally trust.
        </p>
        <FeatureList
          items={[
            'Locally owned and operated — not a global reseller',
            'Direct prices in EUR, with instant e-voucher confirmation',
            'Experienced, English- and French-speaking guides and drivers',
            'Hotel, Airbnb and cruise-port pickup right across the island',
            'Free cancellation up to 24 hours before most activities',
          ]}
        />
        <BrowseLink />
      </InfoSection>

      <InfoSection title="Why book direct">
        <p>
          Booking direct means your money supports a local business and the guides who run your day
          — not a string of intermediaries. It also means we can be flexible: adjust an itinerary,
          arrange a private departure, or combine an island tour with a transfer or a rental car.
        </p>
      </InfoSection>

      <EnquireRow message="Hi Belle Mare Tours! I'd like to know more about your tours." />
    </InfoPage>
  );
}
