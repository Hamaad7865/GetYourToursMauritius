import Link from 'next/link';
import type { TourSummary } from '@/lib/validation/tours';
import { WishHeart } from './WishHeart';
import { IconStar } from '@/components/ui/icons';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

function gygDuration(minutes: number | null): string | null {
  if (minutes == null) return null;
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  const rounded = Number.isInteger(h) ? h : Math.round(h * 10) / 10;
  return `${rounded} hour${rounded === 1 ? '' : 's'}`;
}

export interface GygCardProps {
  activity: TourSummary;
  /** Render the wider card used inside horizontal rails. */
  rail?: boolean;
}

/** GetYourGuide-style product card, recoloured to the Belle Mare brand. */
export function GygCard({ activity, rail = false }: GygCardProps) {
  const duration = gygDuration(activity.durationMinutes);
  const meta = [duration, activity.type === 'transport' ? 'Private transfer' : 'Pickup available']
    .filter(Boolean)
    .join(' · ');
  const topRated = activity.ratingAvg != null && activity.ratingAvg >= 4.7;
  const unit = activity.type === 'transport' ? 'per vehicle' : 'per person';

  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border border-ink/[0.08] bg-white shadow-[0_1px_3px_rgba(10,46,54,0.06)] transition hover:shadow-[0_22px_38px_-20px_rgba(10,46,54,0.4)] ${
        rail ? 'w-[300px] shrink-0' : ''
      }`}
    >
      <div className="relative aspect-[4/3] overflow-hidden">
        {activity.heroImage ? (
          <img
            src={activity.heroImage.url}
            alt={activity.heroImage.alt ?? activity.title}
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[linear-gradient(152deg,#13a0a6_0%,#0E8C92_46%,#0B5C63_100%)] transition duration-500 group-hover:scale-[1.04]">
            <span className="font-display text-3xl font-semibold text-cream/90">
              {activity.title.slice(0, 1)}
            </span>
          </div>
        )}
        {topRated && (
          <span className="absolute left-3 top-3 z-[2] rounded-md bg-ink px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-cream">
            Top rated
          </span>
        )}
        <WishHeart slug={activity.slug} className="absolute right-3 top-3 z-[2] h-9 w-9 shadow-sm" />
      </div>

      <div className="flex flex-1 flex-col px-4 pb-4 pt-3">
        {activity.location && (
          <div className="text-[12px] font-bold uppercase tracking-wide text-teal">
            {activity.location}
          </div>
        )}
        <h3 className="mt-1 line-clamp-2 min-h-[44px] text-[15px] font-bold leading-snug text-ink">
          {/* Stretched link: makes the whole card clickable without nesting the heart button. */}
          <Link href={`/activities/${activity.slug}`} className="after:absolute after:inset-0">
            {activity.title}
          </Link>
        </h3>
        {meta && <div className="mt-2 text-[12.5px] text-ink-muted">{meta}</div>}

        <div className="mt-auto flex items-end justify-between pt-3">
          {activity.ratingCount > 0 ? (
            <span className="flex items-center gap-1 text-[13px] text-ink">
              <IconStar width={14} height={14} className="text-gold-light" />
              <b>{activity.ratingAvg?.toFixed(1)}</b>
              <span className="font-medium text-ink-muted">({activity.ratingCount})</span>
            </span>
          ) : (
            <span className="rounded bg-teal/10 px-1.5 py-0.5 text-[11px] font-bold text-teal">
              New activity
            </span>
          )}
          <span className="text-right text-[12.5px] text-ink-muted">
            {activity.fromPriceEur != null ? (
              <>
                From <b className="text-[18px] text-ink">€{activity.fromPriceEur}</b>
                <span className="block text-[11px] leading-tight">{unit}</span>
              </>
            ) : (
              <b className="text-ink">On request</b>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
