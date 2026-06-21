import type { Metadata } from 'next';
import { GygHeader } from '@/components/gyg/GygHeader';
import { SiteFooter } from '@/components/site/SiteFooter';
import { PlannerShell } from '@/components/planner/PlannerShell';

export const runtime = 'edge';

export const metadata: Metadata = {
  title: 'AI Road Trip Planner — Build & book your day in Mauritius',
  description:
    'Tell ZilAi, our local AI co-pilot, the day you want and watch it build a real Mauritius road trip on the map — grounded in actual places and drive times, priced instantly at one flat fare per vehicle, bookable in a tap.',
  alternates: { canonical: '/ai-road-trip-planner' },
  openGraph: {
    type: 'website',
    title: 'AI Road Trip Planner — Mauritius',
    description:
      'Build your own day across Mauritius with ZilAi, a grounded AI co-pilot. Real route, instant price, one tap to book.',
    locale: 'en_GB',
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
