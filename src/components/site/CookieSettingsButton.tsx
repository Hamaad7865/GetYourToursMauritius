'use client';

import { openConsentSettings } from '@/lib/consent/gtag';
import { useT } from '@/components/site/PreferencesProvider';

/**
 * Reopens the consent bar from the policy page. GDPR requires withdrawing consent to be as easy as
 * giving it, so this exists as a first-class control rather than "clear your browser cookies".
 */
export function CookieSettingsButton() {
  const t = useT();
  return (
    <button
      type="button"
      onClick={openConsentSettings}
      className="rounded-full bg-teal-dark px-5 py-2.5 text-[13px] font-bold text-white outline-none transition hover:bg-teal-dark/90 focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
    >
      {t('Change your cookie settings')}
    </button>
  );
}
