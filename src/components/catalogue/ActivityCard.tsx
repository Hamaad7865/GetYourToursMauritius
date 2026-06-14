import Link from 'next/link';
import type { TourSummary } from '@/lib/validation/tours';
import { IconPin, IconStar } from '@/components/ui/icons';

function durationLabel(minutes: number | null): string | null {
  if (minutes == null) return null;
  if (minutes >= 60) {
    const h = Math.round((minutes / 60) * 10) / 10;
    return `${h % 1 === 0 ? h : h.toFixed(1)} h`;
  }
  return `${minutes} min`;
}

export function ActivityCard({ activity }: { activity: TourSummary }) {
  const duration = durationLabel(activity.durationMinutes);
  return (
    <Link
      href={`/activities/${activity.slug}`}
      className="group flex flex-col overflow-hidden rounded-card border border-ink/[0.08] bg-white shadow-sm transition hover:-translate-y-1.5 hover:shadow-xl"
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        {activity.heroImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={activity.heroImage.url}
            alt={activity.heroImage.alt ?? activity.title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(152deg,#13a0a6_0%,#0E8C92_46%,#0B5C63_100%)] transition duration-500 group-hover:scale-105">
            <span className="font-display text-2xl font-medium text-cream/90">
              {activity.title.slice(0, 1)}
            </span>
          </div>
        )}
        <span className="absolute left-3 top-3 rounded-full bg-cream/95 px-2.5 py-1 text-[11px] font-bold text-teal-dark">
          {activity.category}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-4">
        {activity.location && (
          <div className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-teal">
            <IconPin width={13} height={13} />
            {activity.location}
          </div>
        )}
        <h3 className="m-0 line-clamp-2 text-base font-bold leading-snug text-ink">
          {activity.title}
        </h3>
        {duration && <div className="mt-2 text-[13px] text-ink-muted">{duration}</div>}

        <div className="mt-auto flex items-center justify-between border-t border-ink/[0.07] pt-3.5">
          <span className="flex items-center gap-1.5 text-sm text-ink">
            <IconStar width={15} height={15} className="text-gold-light" />
            <b>{activity.ratingAvg?.toFixed(1) ?? '—'}</b>
            <span className="font-medium text-ink-muted">({activity.ratingCount})</span>
          </span>
          <span className="text-[13px] text-ink-muted">
            {activity.fromPriceEur != null ? (
              <>
                from <b className="text-[19px] text-ink">€{activity.fromPriceEur}</b>
              </>
            ) : (
              <b className="text-ink">On request</b>
            )}
          </span>
        </div>
      </div>
    </Link>
  );
}
