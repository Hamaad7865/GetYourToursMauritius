'use client';

import { useBooking } from './BookingProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { Price } from '@/components/site/Price';
import { activityFromPriceEur } from '@/lib/catalogue/options';

/**
 * Mobile-only sticky bottom bar (phones/tablets) carrying the "From" price + a "Check availability"
 * CTA that scrolls up to the booking widget. Desktop keeps the sticky sidebar, so this is lg:hidden.
 */
export function MobileBookBar() {
  const t = useT();
  const b = useBooking();
  const price = activityFromPriceEur(b.activity);
  const unitLabelText =
    b.groupSize != null ? t('per group up to {n}', { n: b.groupSize }) : t(b.unitLabel);

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t border-ink/10 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-10px_30px_-16px_rgba(10,46,54,0.45)] lg:hidden">
      <div className="min-w-0">
        <div className="text-[11px] font-medium text-ink-muted">{t('From')}</div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-[19px] font-extrabold tracking-tight text-ink">
            {price != null ? <Price eur={price} /> : t('On request')}
          </span>
          <span className="truncate text-[11px] text-ink-muted">{unitLabelText}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={() =>
          document.getElementById('book')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        }
        className="gyt-press shrink-0 rounded-full bg-teal px-6 py-3 text-sm font-bold text-white shadow-[0_10px_22px_-12px_rgba(14,140,146,0.8)] hover:bg-teal-dark"
      >
        {t('Check availability')}
      </button>
    </div>
  );
}
