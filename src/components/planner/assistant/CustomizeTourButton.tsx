'use client';

import Link from '@/components/site/LocaleLink';
import { usePreferences } from '@/components/site/PreferencesProvider';
import { localePath } from '@/lib/i18n/routing';
import { useZilAiOptional } from './ZilAiProvider';
import { opensInPlace } from './open-in-place';

/**
 * "Customize this tour with ZilAi" — on a private sightseeing tour's page.
 *
 * A fixed tour is a starting point for a lot of visitors: they want this day, minus the market, plus
 * a beach. This opens the assistant right on the tour's page with the tour's own stops already loaded
 * on the plan, so they can change them in a sentence and see the price of their version — without
 * leaving the tour they were reading.
 *
 * Still an `<a href>` to the planner page's `?fromTour=` form, which does the same thing after a page
 * load: that is what a new-tab click, a crawler and a browser without JavaScript get.
 */
export function CustomizeTourButton({
  slug,
  className = '',
}: {
  slug: string;
  className?: string;
}) {
  const { t, language } = usePreferences();
  const assistant = useZilAiOptional();
  return (
    <Link
      href={localePath(language, `/ai-road-trip-planner?fromTour=${encodeURIComponent(slug)}`)}
      onClick={(e) => {
        if (!assistant?.available || !opensInPlace(e)) return;
        e.preventDefault();
        assistant.openAssistant({ tourSlug: slug });
      }}
      onPointerEnter={assistant?.preload}
      onFocus={assistant?.preload}
      aria-haspopup={assistant ? 'dialog' : undefined}
      className={`group flex items-center gap-3.5 rounded-2xl border border-teal/30 bg-gradient-to-r from-teal/[0.08] to-transparent px-4 py-3.5 transition-colors hover:border-teal/60 hover:from-teal/[0.14] ${className}`}
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-teal-dark text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M10 3.5l1.7 4.8 4.8 1.7-4.8 1.7L10 16.5l-1.7-4.8L3.5 10l4.8-1.7L10 3.5Z"
            fill="currentColor"
          />
          <path
            d="M18 13.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z"
            fill="currentColor"
          />
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[15px] leading-snug text-ink">
          {t('Customize this tour with ZilAi')}
        </b>
        <span className="mt-0.5 block text-[13px] leading-snug text-ink/70">
          {t('Add, drop or swap stops with our AI assistant, and see the price of your version.')}
        </span>
      </span>
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="shrink-0 text-teal-dark transition-transform group-hover:translate-x-0.5"
      >
        <path
          d="M5 12h14M13 6l6 6-6 6"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Link>
  );
}
