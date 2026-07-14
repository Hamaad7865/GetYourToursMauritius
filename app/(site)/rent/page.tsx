import type { Metadata } from 'next';
import { overrideMetadata } from '@/lib/seo/override';
import { InfoPage, InfoSection, FeatureList, EnquireRow } from '@/components/site/InfoPage';
import {
  ContentSection,
  InlineLink,
  FaqAccordion,
  RelatedLinks,
} from '@/components/seo/LandingSections';
import { JsonLd } from '@/components/seo/JsonLd';
import { breadcrumbListJsonLd, faqPageJsonLd, serviceJsonLd } from '@/lib/seo/jsonld';
import { SITE, OG_IMAGE } from '@/lib/seo/site';
import { getT } from '@/lib/i18n/server';
import { listRentalVehicles } from '@/lib/services/rental';
import { publicServiceContext } from '@/lib/http/context';
import { RentalWidget } from '@/components/rental/RentalWidget';
import { CarHero } from '@/components/rental/CarHero';
import type { RentalVehicle } from '@/lib/validation/rental';

export const runtime = 'edge';

const DEFAULT_METADATA: Metadata = {
  // `absolute` so the root "%s | Belle Mare Tours" template doesn't double-brand the title.
  title: { absolute: 'Car & Scooter Rental in Belle Mare, Mauritius | Belle Mare Tours' },
  description:
    'Self-drive car and scooter rental for guests staying in the Belle Mare area, Mauritius. Free delivery to your hotel or Airbnb in the Belle Mare vicinity, full insurance, unlimited mileage and 24/7 local support — from compact cars to family SUVs and scooters.',
  alternates: { canonical: '/rent' },
  keywords: [
    'Belle Mare rental',
    'car rental Belle Mare',
    'car rental Mauritius',
    'scooter rental Mauritius',
    'self-drive Mauritius',
    'rent a car Mauritius east coast',
  ],
  openGraph: {
    type: 'website',
    url: `${SITE.url}/rent`,
    title: 'Car & Scooter Rental in Belle Mare, Mauritius | Belle Mare Tours',
    description:
      'Self-drive car & scooter rental for guests in the Belle Mare area — free local delivery, full insurance, unlimited mileage and 24/7 local support.',
    locale: 'en_GB',
    images: [OG_IMAGE],
  },
};

// Raw English so the visible answers match the FAQPage JSON-LD exactly (rich-result eligible).
const FAQS: { q: string; a: string }[] = [
  {
    q: 'Who can rent, and do you deliver to my hotel?',
    a: 'We rent to visitors staying in the Belle Mare area — Belle Mare, Trou d’Eau Douce, Palmar, Poste Lafayette and nearby — and delivery and collection there are free. We hand the vehicle over fuelled and ready, and meet you again at the end to collect it. If you’re staying elsewhere on the island, message us and we’ll let you know what we can do.',
  },
  {
    q: 'What’s included in the rental price?',
    a: 'Full insurance, unlimited mileage and 24/7 roadside support are included. Cars are air-conditioned and well-maintained; scooters come with two helmets and a lock. Baby seats and extra drivers are available on request.',
  },
  {
    q: 'Do I need an international driving licence?',
    a: 'No — your home country licence is fine for short stays. Mauritius drives on the left, and roads are paved and well signposted. We’ll point out the few things worth knowing at handover.',
  },
  {
    q: 'Can I rent for a single day or for the whole week?',
    a: 'Both. We offer daily and weekly rates — weekly is the better value if you’re exploring the island over several days. Message us with your dates for a fixed quote.',
  },
  {
    q: 'Why rent from Belle Mare Tours instead of an airport chain?',
    a: 'Free door-to-door delivery in the Belle Mare area, a fixed all-in price with no hidden airport surcharges, and a local team one WhatsApp message away the whole trip. You skip the airport rental desk queue entirely.',
  },
];

export default async function RentPage() {
  const t = await getT();
  let fleet: RentalVehicle[] = [];
  try {
    fleet = await listRentalVehicles(publicServiceContext());
  } catch {
    // The fleet picker is an enhancement — if the read fails, the SEO content + WhatsApp CTA still render.
    fleet = [];
  }
  return (
    <>
      <JsonLd
        data={breadcrumbListJsonLd([
          { name: 'Home', path: '/' },
          { name: 'Car & scooter rental', path: '/rent' },
        ])}
      />
      <JsonLd data={faqPageJsonLd(FAQS)} />
      <JsonLd
        data={serviceJsonLd({
          serviceType: 'Car rental',
          name: 'Car & scooter rental in Belle Mare, Mauritius',
          description:
            'Self-drive car and scooter rental for guests staying in the Belle Mare area, with free local delivery, full insurance, unlimited mileage and 24/7 local support.',
          path: '/rent',
          areaServed: 'Belle Mare and vicinity, Mauritius',
        })}
      />

      <InfoPage
        eyebrow={t('Car & scooter rental')}
        title={t('Rent a car or scooter in Belle Mare, Mauritius')}
        intro={t(
          'Self-drive is the best way to see Mauritius beyond the resort. We’re based in Belle Mare and rent to guests staying in the Belle Mare area — we deliver to your hotel or Airbnb nearby, hand over a clean, insured vehicle, and stay one message away the whole trip.',
        )}
        heroArt={<CarHero />}
      >
        {fleet.length > 0 && (
          <section id="fleet" className="scroll-mt-28 pb-9">
            <h2 className="text-[22px] font-extrabold tracking-tight text-ink">
              {t('Choose your car or scooter')}
            </h2>
            <p className="mt-2 mb-5 max-w-2xl text-[15px] leading-relaxed text-ink/80">
              {t(
                'Pick a vehicle and your dates for an instant price, then book in one tap on WhatsApp — no online payment, no airport-desk queue. We rent to guests staying in the Belle Mare area and deliver free to your hotel or Airbnb there.',
              )}
            </p>
            <RentalWidget vehicles={fleet} />
          </section>
        )}

        <ContentSection id="belle-mare" title="Why base your rental in Belle Mare">
          <p>
            Belle Mare sits on Mauritius’ quieter east coast, which makes it an ideal base for a
            self-drive trip. You’re minutes from the Trou d’Eau Douce jetty for{' '}
            <InlineLink href="/ile-aux-cerfs-tours">Île aux Cerfs</InlineLink>, an easy run up to
            the northern beaches and Grand Baie, and well placed for day trips to the south and the
            central tea country. Picking up your rental here means no airport-desk queue and no long
            transfer before your holiday actually starts.
          </p>
          <p>
            We rent to guests staying in the Belle Mare area and deliver there for free — then talk
            you through the route options for wherever you want to drive, from a lazy coastal loop
            to a full island day trip.
          </p>
        </ContentSection>

        <InfoSection id="car" title={t('Rent a car')}>
          <p>
            {t(
              'From compact hatchbacks for two to family SUVs, our cars are well-maintained, air-conditioned and fully insured. We drive on the left in Mauritius; an international or home licence is fine.',
            )}
          </p>
          <FeatureList
            items={[
              'Free delivery & collection at your hotel or Airbnb in the Belle Mare area',
              'Full insurance and 24/7 roadside support included',
              'Unlimited mileage — drive the whole island',
              'Baby seats and extra drivers available on request',
            ]}
          />
        </InfoSection>

        <InfoSection id="scooter" title={t('Rent a scooter')}>
          <p>
            {t(
              'Perfect for short hops along the coast and into Belle Mare village. Scooters come with two helmets and a quick handover so you’re on the road in minutes.',
            )}
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

        <ContentSection id="driving" title="Driving in Mauritius — what to know">
          <p>
            Mauritius drives on the <strong>left</strong>, the same as the UK. Roads are paved and
            well signposted, with a motorway running north–south through the middle of the island.
            Outside the towns the pace is relaxed; in Port Louis and around Grand Baie it’s busier,
            so allow extra time. Fuel stations are easy to find, and parking at beaches and
            attractions is usually free.
          </p>
          <p>
            Your home licence is accepted for short stays. We point out the handful of local quirks
            — roundabout priority, speed limits, and a couple of spots worth avoiding at rush hour —
            when we hand the vehicle over.
          </p>
        </ContentSection>

        <ContentSection id="vs-airport" title="Belle Mare rental vs an airport chain">
          <p>
            Airport rental desks add surcharges, queues and a long drive before you’ve even reached
            your hotel. Renting locally from Belle Mare Tours means a{' '}
            <strong>fixed, all-in price</strong>, free delivery to your door, and a local team you
            can reach on WhatsApp the whole trip — not a call centre. If you’re also arriving or
            leaving, we can sort your{' '}
            <InlineLink href="/airport-transfers">airport transfer</InlineLink> at the same time.
          </p>
        </ContentSection>

        <ContentSection id="faq" title="Car & scooter rental — frequently asked questions">
          <FaqAccordion items={FAQS} />
        </ContentSection>

        <ContentSection id="more" title="Plan the rest of your trip">
          <RelatedLinks
            links={[
              { label: 'Airport transfers', href: '/airport-transfers' },
              { label: 'Things to do in Mauritius', href: '/attractions' },
              { label: 'Mauritius destinations', href: '/destinations' },
              { label: 'Mauritius travel guide', href: '/mauritius-travel-guide' },
              { label: 'Tours & activities', href: '/activities' },
            ]}
          />
        </ContentSection>

        <EnquireRow
          message={t(
            'Hi Belle Mare Tours! I’d like to rent a car / scooter. Could you send rates and availability?',
          )}
        />
      </InfoPage>
    </>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/rent', DEFAULT_METADATA);
}
