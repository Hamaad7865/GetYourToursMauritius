import Link from 'next/link';
import { getT, getLocale } from '@/lib/i18n/server';
import { localePath } from '@/lib/i18n/routing';
import { reviewStats } from '@/lib/content/reviews';
import { IconStar } from '@/components/ui/icons';
import { SearchBar } from '../SearchBar';
import { MobileSearch } from '../MobileSearch';
import { LagoonLight } from './LagoonLight';
import { HERO_SEARCH_ID } from './anchors';

/**
 * Homepage hero, in GetYourGuide's structure: one line, one search field, nothing else competing.
 *
 * The ground is the colour of shallow lagoon water running out to white sand — a plain CSS gradient,
 * so the hero is complete before any script runs — with <LagoonLight/> drawing moving sunlight over
 * it. No photograph on purpose: the page's first image request is then a tour photo the visitor
 * can actually book, and the headline is the largest paint.
 *
 * The section is not clipped (only the backdrop is), so the search field's suggestion, date and
 * traveller panels can spill over whatever follows.
 */
export async function HomeHero() {
  const t = await getT();
  const locale = await getLocale();
  return (
    <section className="relative">
      <div
        aria-hidden
        className="absolute inset-0 overflow-hidden bg-[linear-gradient(180deg,#C9EDE8_0%,#DDF4F0_34%,#F4FBFA_72%,#FFFFFF_100%)]"
      >
        <LagoonLight />
      </div>

      <div className="relative mx-auto max-w-shell px-6 pb-12 pt-[124px] text-center sm:pb-16 sm:pt-[168px] md:pt-[212px]">
        <h1 className="mx-auto max-w-[18ch] text-[clamp(2.125rem,5.2vw,3.5rem)] font-extrabold leading-[1.04] tracking-[-0.03em] text-ink [text-wrap:balance]">
          {t('Mauritius tours, booked direct.')}
        </h1>
        <p className="mx-auto mt-4 max-w-[46ch] text-[16px] leading-relaxed text-ink/80 [text-wrap:pretty] sm:text-[17px]">
          {t(
            'Catamaran cruises, dolphin swims, island day tours and airport taxis from a licensed local operator in Belle Mare.',
          )}
        </p>

        <div id={HERO_SEARCH_ID} className="mt-8 sm:mt-9">
          <div className="hidden sm:block">
            <SearchBar variant="hero" />
          </div>
          <MobileSearch size="hero" />
        </div>

        <p className="mt-6 flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1 text-[13.5px] font-medium text-ink/80">
          <Link
            href={localePath(locale, '/reviews')}
            className="inline-flex items-center gap-1.5 rounded-md font-bold text-ink underline decoration-ink/25 underline-offset-4 hover:decoration-ink"
          >
            <IconStar
              width={15}
              height={15}
              className="text-gold-light"
              style={{ fill: 'currentColor' }}
            />
            {t('{avg} from {total} reviews', {
              avg: reviewStats.average.toFixed(1),
              total: reviewStats.total.toLocaleString(locale === 'fr' ? 'fr-FR' : 'en-GB'),
            })}
          </Link>
          {/* On a phone the two facts stack, so the dot between them would dangle at a line end. */}
          <span aria-hidden className="text-ink/30 max-sm:hidden">
            ·
          </span>
          <span className="max-sm:w-full">{t('Free cancellation up to 24h')}</span>
          <span aria-hidden className="text-ink/30 max-sm:hidden">
            ·
          </span>
          <span className="max-sm:hidden">{t('Instant confirmation')}</span>
        </p>
      </div>
    </section>
  );
}
