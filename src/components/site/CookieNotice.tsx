'use client';

import { useEffect, useState } from 'react';
import { NOTICE_KEY, serializeAck, shouldShowNotice } from '@/lib/consent/notice';
import { useT } from '@/components/site/PreferencesProvider';

/**
 * Informational cookie-notice bottom bar. No gating, no toggles — the site sets no trackers; this
 * simply tells visitors cookies run the site + maps and links to the policy. Starts hidden so SSR and
 * the first client render agree (no hydration flash); a `useEffect` reads localStorage and shows the
 * bar only when it hasn't been acknowledged at the current NOTICE_VERSION.
 */
export function CookieNotice() {
  const t = useT();
  const [show, setShow] = useState(false);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(NOTICE_KEY);
    } catch {
      stored = null;
    }
    setShow(shouldShowNotice(stored));
  }, []);

  if (!show) return null;

  const accept = () => {
    try {
      localStorage.setItem(NOTICE_KEY, serializeAck(Date.now()));
    } catch {
      // localStorage may be unavailable (private mode / blocked) — dismiss for this session anyway.
    }
    setShow(false);
  };

  return (
    <div
      role="region"
      aria-label={t('Cookie notice')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-ink/10 bg-white shadow-[0_-12px_30px_-24px_rgba(10,46,54,0.45)]"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] leading-snug text-ink-muted">
          {t('We use cookies to run this site and show maps. No tracking or ads.')}{' '}
          <a href="/cookies" className="font-semibold text-teal underline-offset-2 hover:underline">
            {t('Cookie policy')}
          </a>
        </p>
        <button
          type="button"
          onClick={accept}
          className="shrink-0 self-start rounded-full bg-teal px-5 py-2 text-[13px] font-bold text-white outline-none transition hover:bg-teal/90 focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2 sm:self-auto"
        >
          {t('Accept')}
        </button>
      </div>
    </div>
  );
}
