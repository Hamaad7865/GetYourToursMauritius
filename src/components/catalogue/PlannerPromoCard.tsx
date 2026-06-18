'use client';

import Link from 'next/link';
import { useT } from '@/components/site/PreferencesProvider';

/**
 * Promo card for the AI Road Trip Planner, shown FIRST in the private sightseeing-tours listing
 * (and its home rail) to flag it as a new way to book. Matches the surrounding card shape so the
 * grid/rail stays even; a coral "NEW" badge marks it as the latest trend. The whole card links to
 * the planner. `rail` gives it the fixed width the home rail's cards use.
 */
export function PlannerPromoCard({
  rail = false,
  className = '',
  titleAs: TitleTag = 'h3',
}: {
  rail?: boolean;
  className?: string;
  titleAs?: 'h2' | 'h3' | 'h4';
}) {
  const t = useT();
  return (
    <div
      className={`group relative flex flex-col overflow-hidden rounded-2xl border-2 border-teal/40 bg-white shadow-sm transition-shadow duration-300 hover:shadow-[0_18px_38px_-16px_rgba(10,46,54,0.4)] ${
        rail ? 'w-[300px] shrink-0' : ''
      } ${className}`}
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-[linear-gradient(152deg,#13a0a6_0%,#0E8C92_46%,#0B5C63_100%)]">
        {/* Faint route motif — a dashed path through three pins, evoking a planned day. */}
        <svg viewBox="0 0 300 225" className="absolute inset-0 h-full w-full" fill="none" aria-hidden preserveAspectRatio="xMidYMid slice">
          <path
            d="M30 175 C 90 150, 70 95, 130 90 S 220 70, 268 40"
            stroke="#ffffff"
            strokeWidth={2.5}
            strokeDasharray="2 9"
            strokeLinecap="round"
            opacity={0.5}
          />
          <circle cx="30" cy="175" r="5" fill="#ffffff" opacity={0.85} />
          <circle cx="130" cy="90" r="5" fill="#ffffff" opacity={0.85} />
          <circle cx="268" cy="40" r="6" fill="#F76C5E" />
        </svg>

        <span className="absolute left-3 top-3 z-10 rounded-md bg-coral px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow">
          {t('New')}
        </span>

        <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-2 px-4 text-center">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 3l2.3 4.7L19.5 8l-3.7 3.6.9 5.1L12 14.5 7.3 16.7l.9-5.1L4.5 8l5.2-.3L12 3Z" fill="#fff" />
            </svg>
          </span>
          <span className="font-display text-[19px] font-semibold leading-tight text-white">{t('AI Trip Planner')}</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="mb-1.5 text-xs font-bold uppercase tracking-wide text-teal">{t('Build your own day')}</div>
        <TitleTag className="m-0 line-clamp-2 text-base font-bold leading-snug text-ink">
          {t('Design your own private sightseeing day')}
        </TitleTag>
        <div className="mt-2 text-[13px] text-ink-muted">{t('Pick your stops · live drive times · instant quote')}</div>

        <div className="mt-auto flex items-center justify-between border-t border-ink/[0.07] pt-3.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-teal px-3.5 py-1.5 text-[13px] font-bold text-white transition-transform group-hover:translate-x-0.5">
            {t('Plan my day')} →
          </span>
          <span className="text-[12.5px] text-ink-muted">{t('Free to try')}</span>
        </div>
      </div>

      <Link
        href="/ai-road-trip-planner"
        aria-label={t('Open the AI Trip Planner')}
        className="absolute inset-0 z-0"
      />
    </div>
  );
}
