'use client';

import type { TripProposal } from '@/lib/planner/chat';
import { useT } from '@/components/site/PreferencesProvider';

/** "Mon 17 Aug" for a day key. */
function dayLabel(dayKey: string): string {
  const d = new Date(`${dayKey}T00:00:00`);
  return Number.isNaN(d.getTime())
    ? dayKey
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

/**
 * ZilAi's offer to spread the tours over separate days.
 *
 * The agent only ever PROPOSES this — accepting is what turns the visitor's single day into a real
 * multi-day trip, so the plan they built can never be reshaped without a deliberate tap.
 */
export function TripProposalCard({
  proposal,
  onAccept,
  onDismiss,
  applied,
}: {
  proposal: TripProposal;
  onAccept: (proposal: TripProposal) => void;
  onDismiss: () => void;
  /** Already accepted — the card stays in the thread as a record, without a live button. */
  applied: boolean;
}) {
  const t = useT();
  return (
    <div
      className="max-w-[88%] animate-pop self-start rounded-[4px_16px_16px_16px] border border-[#D8ECEA] p-3.5 shadow-[0_10px_26px_rgba(14,140,146,.12)]"
      style={{ background: 'linear-gradient(160deg,#fff,#EAF7F5)' }}
    >
      <div className="mb-2.5 flex items-center gap-2">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-lg bg-teal">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M7 3v3m10-3v3M4 9h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z"
              stroke="#fff"
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <span className="font-display text-[15px] font-semibold text-ink">
          {t('{n} days, one at a time', { n: proposal.days.length })}
        </span>
      </div>

      <ol className="m-0 mb-3 flex list-none flex-col gap-1.5 p-0">
        {proposal.days.map((day, i) => (
          <li key={day.date} className="flex items-start gap-[9px] text-[13px]">
            <span className="mt-px grid h-5 w-5 shrink-0 place-items-center rounded-md bg-teal-tint text-[11px] font-extrabold text-teal-dark">
              {i + 1}
            </span>
            <span className="min-w-0">
              <span className="font-semibold text-ink">{dayLabel(day.date)}</span>
              {day.activityTitle ? (
                <>
                  {' — '}
                  <span className="font-bold text-coral">{day.activityTitle}</span>
                </>
              ) : null}
              {day.note ? (
                <span className="block text-[12px] leading-[1.4] text-ink-muted">{day.note}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>

      {applied ? (
        <p className="m-0 text-xs font-bold text-teal">{t('✓ Added to your trip')}</p>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onAccept(proposal)}
            className="flex-1 cursor-pointer rounded-[11px] py-[10px] text-[13px] font-bold text-white shadow-[0_8px_18px_rgba(14,140,146,.28)]"
            style={{ background: 'linear-gradient(135deg,#13A0A6,#0B5C63)' }}
          >
            {t('Split my plan into these days')}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            className="cursor-pointer rounded-[11px] border border-[#D8ECEA] bg-white px-3.5 py-[10px] text-[13px] font-bold text-ink-muted"
          >
            {t('Not now')}
          </button>
        </div>
      )}
    </div>
  );
}
