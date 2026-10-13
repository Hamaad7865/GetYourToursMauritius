'use client';

import Link from '@/components/site/LocaleLink';
import { usePreferences } from '@/components/site/PreferencesProvider';
import { localePath } from '@/lib/i18n/routing';
import { useZilAiOptional } from './ZilAiProvider';
import { opensInPlace } from './open-in-place';

/**
 * "Plan with AI" — the header's way into ZilAi, top right on every page.
 *
 * Deliberately the loudest thing in the bar (a filled pill with a passing sheen, see `.zilai-cta` in
 * globals.css): it is the one control here that starts something rather than going somewhere.
 *
 * It is still an `<a href>` to the planner's landing page. A crawler, a middle-click and a browser
 * without JavaScript all get a working link; an ordinary click opens the assistant on the page the
 * visitor is already reading. Hover or focus starts fetching the assistant so that click is instant.
 */
export function PlanWithAiButton() {
  const { t, language } = usePreferences();
  const assistant = useZilAiOptional();
  const label = t('Plan with AI');
  return (
    <Link
      href={localePath(language, '/ai-road-trip-planner')}
      onClick={(e) => {
        if (!assistant?.available || !opensInPlace(e)) return;
        e.preventDefault();
        assistant.openAssistant();
      }}
      onPointerEnter={assistant?.preload}
      onFocus={assistant?.preload}
      aria-haspopup={assistant ? 'dialog' : undefined}
      // Below `lg` only the mark fits beside the cart and the menu; the name is still announced.
      aria-label={label}
      className="zilai-cta mr-1 inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-2.5 text-[14px] font-bold text-white lg:mr-2 lg:px-4"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="zilai-cta-spark shrink-0"
      >
        {/* A large spark with a small one beside it. */}
        <path
          d="M10 3.5l1.7 4.8 4.8 1.7-4.8 1.7L10 16.5l-1.7-4.8L3.5 10l4.8-1.7L10 3.5Z"
          fill="currentColor"
        />
        <path
          d="M18 13.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z"
          fill="currentColor"
          className="zilai-cta-spark-small"
        />
      </svg>
      <span className="hidden whitespace-nowrap lg:inline">{label}</span>
    </Link>
  );
}
