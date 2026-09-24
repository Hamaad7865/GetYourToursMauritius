import type { Metadata } from 'next';
import { PhotographyPricingPage } from '@/components/photography/PhotographyPricingPage';
import { overrideMetadata } from '@/lib/seo/override';
import { SITE, OG_IMAGE } from '@/lib/seo/site';

export const runtime = 'edge';

const DEFAULT_METADATA: Metadata = {
  title: { absolute: 'Mauritius Photographer & Videographer | Belle Mare Tours' },
  description:
    'Local photographer in Mauritius for weddings, honeymoons, proposals and family holidays — photos, films and drone. See prices, pick a date and book online.',
  alternates: { canonical: '/photography' },
  openGraph: {
    type: 'website',
    url: `${SITE.url}/photography`,
    title: 'Mauritius Photographer & Videographer | Belle Mare Tours',
    description:
      'Compare photography packages in Mauritius, browse photos and films, and book your shoot online.',
    images: [OG_IMAGE],
  },
};

export default function PhotographyPage() {
  return <PhotographyPricingPage path="/photography" />;
}

export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/photography', DEFAULT_METADATA);
}
