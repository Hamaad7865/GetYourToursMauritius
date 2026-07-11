import type { ReactNode } from 'react';
import type { TourSummary } from '@/lib/validation/tours';
import { getT } from '@/lib/i18n/server';
import { ActivityCard } from './ActivityCard';
import { RevealGroup } from '@/components/site/RevealGroup';

export async function ActivityGrid({
  activities,
  leadingCard,
}: {
  activities: TourSummary[];
  /** An optional card rendered as the first grid cell (e.g. the AI planner promo on the
   *  sightseeing listing). The grid still renders when it's the only card. */
  leadingCard?: ReactNode;
}) {
  const t = await getT();
  if (activities.length === 0 && !leadingCard) {
    return (
      <div className="rounded-card border border-teal/20 bg-white/60 p-10 text-center text-sm text-ink-muted">
        {t(
          'No activities to show yet. Once the catalogue is connected, Belle Mare Tours’ experiences appear here.',
        )}
      </div>
    );
  }
  return (
    <RevealGroup className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {leadingCard}
      {activities.map((activity) => (
        <ActivityCard key={activity.id} activity={activity} />
      ))}
    </RevealGroup>
  );
}
