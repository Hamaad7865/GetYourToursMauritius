import Link from 'next/link';
import type { TourSummary } from '@/lib/validation/tours';
import type { Locale } from '@/lib/i18n/config';
import { durationLabel } from '@/lib/catalogue/detail';
import { localePath } from '@/lib/i18n/routing';
import { Price } from '@/components/site/Price';

/**
 * The /mauritius-catamaran-cruise comparison table and the price facts above its FAQ — both built
 * from the live catalogue rows, never typed-in prices, so the page can't advertise a rate the
 * checkout won't charge. Labels are inline French rather than t() keys (a handful of table words).
 */

/** A from-price that buys the whole boat rather than one seat. */
function isPrivateBoat(a: TourSummary): boolean {
  return a.fromPriceIncluded != null || a.pricingMode === 'per_group';
}

/** Guests a private from-price covers, when the catalogue says. */
function privateGuests(a: TourSummary): number | null {
  return a.fromPriceIncluded ?? a.fromPriceMaxGuests ?? null;
}

const COAST_FR: Record<string, string> = {
  East: 'Est',
  North: 'Nord',
  West: 'Ouest',
  South: 'Sud',
  Central: 'Centre',
};

function coast(a: TourSummary, locale: Locale): string | null {
  if (!a.region) return null;
  return locale === 'fr' ? (COAST_FR[a.region] ?? a.region) : a.region;
}

function basis(a: TourSummary, locale: Locale): string {
  const fr = locale === 'fr';
  if (!isPrivateBoat(a)) return fr ? 'Partagée, par personne' : 'Shared, per person';
  const n = privateGuests(a);
  if (fr) return n ? `Bateau privé, jusqu’à ${n} pers.` : 'Bateau privé';
  return n ? `Private boat, up to ${n} guests` : 'Private boat';
}

export function CatamaranComparison({
  activities,
  locale,
}: {
  activities: TourSummary[];
  locale: Locale;
}) {
  const fr = locale === 'fr';
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border border-ink/10">
      <table className="w-full border-collapse text-left text-[14.5px] leading-snug">
        <thead className="bg-teal-tint/40 text-[12.5px] font-bold uppercase tracking-wide text-ink/70">
          <tr>
            <th scope="col" className="px-4 py-3">
              {fr ? 'Croisière' : 'Cruise'}
            </th>
            <th scope="col" className="hidden px-4 py-3 sm:table-cell">
              {fr ? 'Côte' : 'Coast'}
            </th>
            <th scope="col" className="hidden px-4 py-3 sm:table-cell">
              {fr ? 'Durée' : 'Duration'}
            </th>
            <th scope="col" className="hidden px-4 py-3 md:table-cell">
              {fr ? 'Formule' : 'Basis'}
            </th>
            <th scope="col" className="px-4 py-3 text-right">
              {fr ? 'Dès' : 'From'}
            </th>
          </tr>
        </thead>
        <tbody>
          {activities.map((a) => {
            const where = coast(a, locale);
            const length = durationLabel(a.durationMinutes);
            const how = basis(a, locale);
            return (
              <tr key={a.id} className="border-t border-ink/10 align-top">
                <th scope="row" className="px-4 py-3 font-semibold">
                  <Link
                    href={localePath(locale, `/activities/${a.slug}`)}
                    className="text-teal-dark hover:underline"
                  >
                    {a.title}
                  </Link>
                  {/* Narrow screens drop the middle columns, so their facts ride under the name. */}
                  <span className="mt-1 block text-[13px] font-normal text-ink/60 sm:hidden">
                    {[where, length, how].filter(Boolean).join(' · ')}
                  </span>
                  <span className="mt-1 hidden text-[13px] font-normal text-ink/60 sm:block md:hidden">
                    {how}
                  </span>
                </th>
                <td className="hidden px-4 py-3 text-ink/80 sm:table-cell">{where ?? '—'}</td>
                <td className="hidden whitespace-nowrap px-4 py-3 text-ink/80 sm:table-cell">
                  {length ?? '—'}
                </td>
                <td className="hidden px-4 py-3 text-ink/80 md:table-cell">{how}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  {a.fromPriceEur != null ? (
                    <Price eur={a.fromPriceEur} className="font-bold text-ink" />
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Five hours or more counts as a full day: the full-day cruises run seven to eight, sunset two. */
const FULL_DAY_MINUTES = 300;

export interface CatamaranPriceFacts {
  sharedFullDay: { eur: number } | null;
  sharedShort: { eur: number; title: string } | null;
  privateBoat: { eur: number; guests: number | null } | null;
}

function cheapest(list: TourSummary[]): TourSummary | null {
  let best: TourSummary | null = null;
  for (const a of list) {
    if (a.fromPriceEur == null) continue;
    if (best === null || a.fromPriceEur < (best.fromPriceEur ?? Infinity)) best = a;
  }
  return best;
}

/** The cheapest shared full-day seat, shorter shared cruise and private boat in the catalogue. */
export function catamaranPriceFacts(activities: TourSummary[]): CatamaranPriceFacts {
  const shared = activities.filter((a) => !isPrivateBoat(a));
  const fullDay = cheapest(shared.filter((a) => (a.durationMinutes ?? 0) >= FULL_DAY_MINUTES));
  const short = cheapest(
    shared.filter((a) => a.durationMinutes != null && a.durationMinutes < FULL_DAY_MINUTES),
  );
  const privateBoat = cheapest(activities.filter(isPrivateBoat));
  return {
    sharedFullDay: fullDay?.fromPriceEur != null ? { eur: fullDay.fromPriceEur } : null,
    sharedShort:
      short?.fromPriceEur != null ? { eur: short.fromPriceEur, title: short.title } : null,
    privateBoat:
      privateBoat?.fromPriceEur != null
        ? { eur: privateBoat.fromPriceEur, guests: privateGuests(privateBoat) }
        : null,
  };
}
