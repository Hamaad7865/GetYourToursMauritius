'use client';

import { useRef } from 'react';
import { useBooking } from './BookingProvider';
import { useT, useMoney } from '@/components/site/PreferencesProvider';
import { optionCardSummary, privateConfig } from '@/lib/catalogue/options';
import { durationLabel } from '@/lib/catalogue/detail';
import { IconCheck, IconClock, IconUsers } from '@/components/ui/icons';

/**
 * GetYourGuide-style selectable option picker. Shown ONLY when the activity has 2+ options; a
 * single-option activity renders nothing (its price/availability are unchanged). Picking a card calls
 * setSelectedOption, which re-prices, re-fetches availability and clears the date in BookingProvider.
 *
 * Reuses the option-card's selected-state classes (border-teal / bg-teal/5 / text-teal-dark) so a
 * chosen option matches the Sedan/SUV toggle and other selected affordances on the page.
 */
export function OptionSelector() {
  const t = useT();
  const money = useMoney();
  const b = useBooking();
  const { activity, selectedOptionId, setSelectedOption } = b;
  // Roving-tabindex focus targets: arrow keys must move FOCUS with the selection (ARIA radio pattern).
  const radioRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Single-option activities are unchanged — no picker.
  if (activity.options.length <= 1) return null;

  return (
    <div className="mb-4">
      <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-ink-muted">
        {t('Choose your option')}
      </div>
      <div role="radiogroup" aria-label={t('Choose your option')} className="flex flex-col gap-2">
        {activity.options.map((option, idx) => {
          const summary = optionCardSummary(option, activity.pricingMode, activity.type);
          const priv = privateConfig(option);
          const selected = option.id === selectedOptionId;
          const move = (dir: 1 | -1) => {
            const opts = activity.options;
            const next = opts[(idx + dir + opts.length) % opts.length];
            if (next) {
              setSelectedOption(next.id);
              radioRefs.current[next.id]?.focus();
            }
          };
          // The unitNote stays English in the helper (mirrors the provider's unitLabel for cart/checkout);
          // translate it for display. The per-group form carries a number, so interpolate it.
          const unitNoteText =
            summary.maxGuests != null && summary.unitNote.startsWith('per group up to')
              ? t('per group up to {n}', { n: summary.maxGuests })
              : t(summary.unitNote);
          return (
            <button
              key={option.id}
              ref={(el) => {
                radioRefs.current[option.id] = el;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              // Roving tabindex (ARIA radio pattern): one tab stop for the whole group, arrows move.
              tabIndex={selected ? 0 : -1}
              onClick={() => setSelectedOption(option.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedOption(option.id);
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                  e.preventDefault();
                  move(1);
                } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                  e.preventDefault();
                  move(-1);
                }
              }}
              className={`w-full rounded-xl border px-3.5 py-3 text-left transition-colors ${
                selected
                  ? 'border-teal bg-teal/5 text-teal-dark'
                  : 'border-ink/15 text-ink hover:border-teal'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-[14px] font-bold text-ink">
                    {selected && <IconCheck width={15} height={15} className="shrink-0 text-teal" />}
                    {option.name}
                    {summary.isPrivate && (
                      <span className="shrink-0 rounded-full bg-teal/10 px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-teal-dark">
                        {t('Private')}
                      </span>
                    )}
                  </div>
                  {option.description && (
                    <div className="mt-0.5 line-clamp-2 text-[12px] text-ink-muted">{option.description}</div>
                  )}
                  {(option.durationMinutes != null || option.startWindow) && (
                    <div className="mt-1 flex items-center gap-1.5 text-[12px] text-ink/70">
                      <IconClock width={13} height={13} className="text-teal" />
                      {[durationLabel(option.durationMinutes ?? null), option.startWindow].filter(Boolean).join(' · ')}
                    </div>
                  )}
                  {summary.maxGuests != null && (
                    <div className="mt-1 flex items-center gap-1.5 text-[12px] text-ink/70">
                      <IconUsers width={13} height={13} className="text-teal" />
                      {t('fits up to {n}', { n: summary.maxGuests })}
                    </div>
                  )}
                </div>
                {summary.fromPriceEur != null && (
                  <div className="shrink-0 text-right">
                    <div className="text-[15px] font-extrabold tracking-tight text-ink">
                      {money(summary.fromPriceEur)}
                    </div>
                    {priv ? (
                      // Honest private pricing: the base covers `included` guests; extras cost per head.
                      <div className="text-[11px] text-ink-muted">
                        {t('for up to {n} guests', { n: priv.included })}
                        {priv.extraEur > 0 && (
                          <>
                            <br />
                            {t('+{price} per extra guest', { price: money(priv.extraEur) })}
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="text-[11px] text-ink-muted">{unitNoteText}</div>
                    )}
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
