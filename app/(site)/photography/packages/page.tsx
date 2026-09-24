import type { Metadata } from 'next';
import { PhotographyPricingPage } from '@/components/photography/PhotographyPricingPage';
import { overrideMetadata } from '@/lib/seo/override';
import { SITE, OG_IMAGE } from '@/lib/seo/site';

export const runtime = 'edge';

const DEFAULT_METADATA: Metadata = {
  title: { absolute: 'Mauritius Photographer Prices & Packages | Belle Mare Tours' },
  description:
    'Mauritius photographer prices: wedding, couples, holiday and family photo packages. Compare prices, add drone or extra hours and book your date online.',
  alternates: { canonical: '/photography/packages' },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/photography/packages`,
    title: 'Mauritius Photographer Prices & Packages | Belle Mare Tours',
    description:
      'Wedding, couples, holiday and family photography packages in Mauritius — compare and book online.',
    images: [OG_IMAGE],
  },
};

export default function PhotographyPackagesPage() {
  return <PhotographyPricingPage path="/photography/packages" />;
}

export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/photography/packages', DEFAULT_METADATA);
}
