'use client';

import Link from 'next/link';
import { useBooking } from '@/components/gyg/detail/BookingProvider';
import { BookingWidget } from '@/components/gyg/detail/BookingWidget';
import { OptionSelector } from '@/components/gyg/detail/OptionSelector';
import { Price } from '@/components/site/Price';
import { useT } from '@/components/site/PreferencesProvider';

export function PhotographyBooking() {
  const b = useBooking();
  const t = useT();
  const ready =
    Boolean(b.checkoutParams.get('occ')) &&
    b.seatsLeft > 0 &&
    b.total != null &&
    !b.availabilityError &&
    !b.updating &&
    !b.busy;

  return (
    <section
      id="book"
      aria-label={t('Book your photoshoot')}
      className="min-w-0 scroll-mt-6 space-y-5"
    >
      <Link
        href={`/activities/${b.activity.slug}`}
        className="text-sm font-semibold text-teal-dark underline underline-offset-4"
      >
        {t('Back to package')}
      </Link>
      <ol
        aria-label={t('Booking steps')}
        className="flex flex-wrap gap-x-6 gap-y-2 border-b border-ink/10 py-4 text-sm"
      >
        {[t('Date & extras'), t('Meeting location'), t('Your details'), t('Payment')].map(
          (label, i) => (
            <li
              key={label}
              aria-current={i === 0 ? 'step' : undefined}
              className={i === 0 ? 'font-bold text-teal-dark' : 'text-ink-muted'}
            >
              {i + 1}. {label}
            </li>
          ),
        )}
      </ol>
      <h2 className="text-xl font-bold">{t('Choose your date')}</h2>
      <OptionSelector />
      <BookingWidget hideAction />
      {b.activity.supplements.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-bold text-ink">{t('Optional extras')}</legend>
          {b.activity.supplements.map((extra) => (
            <label
              key={extra.id}
              className="flex cursor-pointer items-center gap-3 border-b border-ink/10 py-3 text-sm"
            >
              <input
                type="checkbox"
                checked={(b.supplementSel[extra.id] ?? 0) > 0}
                onChange={(e) => b.setSupplementQty(extra.id, e.target.checked ? 1 : 0)}
                className="h-4 w-4 rounded border-ink/30 text-teal focus:ring-teal"
              />
              <span className="flex-1">{extra.name}</span>
              <span className="font-semibold">
                +<Price eur={extra.priceEur} />
              </span>
            </label>
          ))}
        </fieldset>
      )}
      {b.total != null && (
        <div className="flex justify-between border-t border-ink/10 pt-4 font-bold">
          <span>{t('Total')}</span>
          <Price eur={b.total} />
        </div>
      )}
      <button
        type="button"
        disabled={!ready}
        onClick={() => void b.continueToCheckout()}
        className="flex w-full items-center justify-center rounded-full bg-teal-dark px-7 py-3.5 text-sm font-bold text-white hover:bg-teal-dark/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {b.busy ? t('Loading') : t('Continue to details')}
      </button>
      {!b.date && (
        <p role="status" className="rounded-xl bg-teal/5 p-4 text-sm text-ink-muted">
          {t('Choose a date to continue.')}
        </p>
      )}
    </section>
  );
}
