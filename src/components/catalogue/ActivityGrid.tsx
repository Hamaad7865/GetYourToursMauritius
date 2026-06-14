import type { TourSummary } from '@/lib/validation/tours';
import { ActivityCard } from './ActivityCard';

export function ActivityGrid({ activities }: { activities: TourSummary[] }) {
  if (activities.length === 0) {
    return (
      <div className="rounded-card border border-teal/20 bg-white/60 p-10 text-center text-sm text-ink-muted">
        No activities to show yet. Once the catalogue is connected, Belle Mare Tours&apos;
        experiences appear here.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {activities.map((activity) => (
        <ActivityCard key={activity.id} activity={activity} />
      ))}
    </div>
  );
}
