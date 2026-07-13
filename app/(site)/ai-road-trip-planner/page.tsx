import type { Metadata } from 'next';
import { overrideMetadata } from '@/lib/seo/override';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { PlannerShell } from '@/components/planner/PlannerShell';
import { OG_IMAGE } from '@/lib/seo/site';

export const runtime = 'edge';

const DEFAULT_METADATA: Metadata = {
  title: 'AI Road Trip Planner — Build & book your day in Mauritius',
  description:
    'Tell ZilAi, our local AI trip planner, the day you want and watch it build a real Mauritius road trip on the map — grounded in actual places and drive times, priced instantly at one flat fare per vehicle, bookable in a tap.',
  alternates: { canonical: '/ai-road-trip-planner' },
  openGraph: {
    type: 'website',
    title: 'AI Road Trip Planner — Mauritius',
    description:
      'Build your own day across Mauritius with ZilAi, a grounded AI trip planner. Real route, instant price, one tap to book.',
    locale: 'en_GB',
    images: [OG_IMAGE],
  },
};

export default function AiRoadTripPlannerPage() {
  return (
    <>
      <GygHeader />
      <PlannerShell />
      <SiteFooter />
    </>
  );
}

/** Built-in metadata merged with the /admin/seo override for this path (see src/lib/seo/override.ts). */
export async function generateMetadata(): Promise<Metadata> {
  return overrideMetadata('/ai-road-trip-planner', DEFAULT_METADATA);
}
