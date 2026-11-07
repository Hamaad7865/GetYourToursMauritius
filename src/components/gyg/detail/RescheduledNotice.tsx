'use client';

import { useEffect, useRef } from 'react';
import { usePreferences, useT } from '@/components/site/PreferencesProvider';
import { formatTripDate } from '@/lib/i18n/format';
import type { RescheduleOutcome } from '@/lib/booking/reschedule-dates';

/**
 * What a guest sees once their trip is on its new date.
 *
 * - `moved`: the move they just made. Says the new date, the old one, and that the email is on its
 *   way. Takes focus, because the button they pressed has just disappeared with the banner it lived in.
 * - `same`: they picked the date the booking was already on (an idempotent replay). Nothing moved, so
 *   it does not say "moved".
 * - `earlier`: they come back later (a reload, the emailed link). The booking itself remembers it was
 *   rescheduled, so the page still says why the date differs from the one they first booked.
 */
export type RescheduledNoticeState = RescheduleOutcome | { kind: 'earlier'; to: string };

export function RescheduledNotice({
  state,
  email,
}: {
  state: RescheduledNoticeState;
  email?: string | null;
}) {
  const t = useT();
  const { language } = usePreferences();
  const ref = useRef<HTMLElement>(null);
  const fresh = state.kind !== 'earlier';

  useEffect(() => {
    if (fresh) ref.current?.focus();
  }, [fresh]);

  const to = formatTripDate(state.to, language);
  const from = state.kind === 'moved' && state.from ? formatTripDate(state.from, language) : null;

  if (state.kind === 'earlier') {
    return (
      <section className="mb-5 flex items-start gap-3 rounded-2xl border border-teal/20 bg-teal-tint px-4 py-3.5">
        <CheckBadge small />
        <div className="min-w-0 text-[13px] leading-relaxed text-ink/80">
          <p className="font-bold text-ink">
            {t('Your trip has a new date: {date}', { date: to })}
          </p>
          <p className="mt-0.5">
            {t('It was moved here after we called off the original departure.')}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      ref={ref}
      tabIndex={-1}
      role="status"
      aria-live="polite"
      className="mb-5 rounded-2xl border border-teal/30 bg-teal-tint p-4 outline-none sm:p-5"
    >
      <div className="flex items-start gap-3.5">
        <CheckBadge />
        <div className="min-w-0">
          {state.kind === 'moved' ? (
            <>
              <h2 className="font-display text-lg font-semibold text-ink">
                {t('You’re all set — your trip has moved')}
              </h2>
              <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-ink-muted">{t('New date')}</dt>
                <dd className="font-bold text-teal-dark">{to}</dd>
                {from && (
                  <>
                    <dt className="text-ink-muted">{t('Was')}</dt>
                    <dd className="text-ink-muted line-through">{from}</dd>
                  </>
                )}
              </dl>
              <p className="mt-3 text-[13px] leading-relaxed text-ink/80">
                {email
                  ? t('We’re emailing the new details to {email}.', { email })
                  : t('We’re emailing you the new details.')}{' '}
                {t('Nothing else on your booking changes, and there is nothing to pay.')}
              </p>
            </>
          ) : (
            <>
              <h2 className="font-display text-lg font-semibold text-ink">
                {t('Your trip is already on {date}', { date: to })}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink/80">
                {t('Nothing has changed, so there is nothing more to do.')}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function CheckBadge({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full bg-teal text-white ${
        small ? 'h-7 w-7' : 'animate-pop h-10 w-10'
      }`}
    >
      <svg width={small ? 15 : 20} height={small ? 15 : 20} viewBox="0 0 24 24" fill="none">
        <path
          className={small ? undefined : 'animate-draw-check'}
          d="M5 12.8l4.2 4.2L19 7.2"
          stroke="currentColor"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
