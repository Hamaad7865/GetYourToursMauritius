'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  CONSENT_DENIED,
  CONSENT_GRANTED,
  NOTICE_KEY,
  type ConsentChoice,
  type ConsentSource,
  readConsent,
  scrollGrantsConsent,
  serializeConsent,
  shouldShowNotice,
} from '@/lib/consent/notice';
import { OPEN_CONSENT_EVENT, applyConsent } from '@/lib/consent/gtag';
import { useT } from '@/components/site/PreferencesProvider';

/**
 * Cookie CONSENT bar. This replaced a notice-only bar (single "Accept", no gating) when the Google
 * Tag Manager container went in — analytics cookies require opt-in, so the bar now actually decides
 * whether they run, via Consent Mode (see src/lib/consent/gtag.ts).
 *
 * Rendering rules that matter:
 * - Starts hidden so SSR and the first client render agree (no hydration flash); a useEffect reads
 *   localStorage and shows the bar only when there is no choice at the current NOTICE_VERSION.
 * - "Reject all" is given equal visual weight to "Accept all". A reject that is harder to find than
 *   accept is not free consent, and the whole gate is worthless if it is not freely given.
 * - Dismissing without choosing is deliberately impossible (no ✕): silence is not consent, and a
 *   bar that can be waved away would leave analytics denied while implying the visitor decided.
 *
 * SCROLL-TO-ACCEPT (owner decision, 2026-08-03 — see SCROLL_CONSENT_PX in lib/consent/notice.ts for
 * the full rationale and how to revert): scrolling past the threshold grants full consent. This is
 * NOT valid consent under the GDPR, and was implemented on the owner's explicit instruction after
 * the objection was raised and overruled. The two mitigations below are load-bearing — do not
 * "tidy" them away:
 *   - the visible copy states that continuing to browse accepts, so it is at least disclosed;
 *   - the listener is disabled while the Customise panel is open, because a visitor mid-way through
 *     setting per-category toggles is actively choosing, and scrolling that panel into view must
 *     never overwrite the choice they are in the middle of making.
 */
export function CookieNotice() {
  const t = useT();
  const [show, setShow] = useState(false);
  const [customising, setCustomising] = useState(false);
  const [choice, setChoice] = useState<ConsentChoice>(CONSENT_DENIED);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(NOTICE_KEY);
    } catch {
      stored = null;
    }
    setShow(shouldShowNotice(stored));
    const existing = readConsent(stored);
    if (existing) setChoice(existing);
  }, []);

  // Lets /cookies reopen the bar — withdrawing consent must be as easy as giving it.
  useEffect(() => {
    const reopen = () => {
      setCustomising(true);
      setShow(true);
    };
    window.addEventListener(OPEN_CONSENT_EVENT, reopen);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, reopen);
  }, []);

  const decide = useCallback((next: ConsentChoice, via: ConsentSource = 'button') => {
    try {
      localStorage.setItem(NOTICE_KEY, serializeConsent(next, Date.now(), via));
    } catch {
      // Storage blocked (private mode): honour the choice for this page view anyway. The bar
      // returns on the next load because nothing was persisted — the safe direction to fail.
    }
    applyConsent(next);
    setChoice(next);
    setShow(false);
    setCustomising(false);
  }, []);

  // Scroll-to-accept. Only armed while the bar is up and the visitor is NOT mid-way through the
  // Customise panel. The baseline is where they were when the bar appeared, so a page restored
  // mid-article does not consent on their behalf before they have moved (see scrollGrantsConsent).
  useEffect(() => {
    if (!show || customising) return;
    const startY = window.scrollY;
    const onScroll = () => {
      if (scrollGrantsConsent(startY, window.scrollY)) decide(CONSENT_GRANTED, 'scroll');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [show, customising, decide]);

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t('Cookie settings')}
      className="fixed inset-x-0 bottom-0 z-30 border-t border-ink/10 bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_30px_-24px_rgba(10,46,54,0.45)]"
    >
      <div className="mx-auto max-w-5xl px-4 py-3.5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] leading-snug text-ink-muted">
            {t(
              'We use necessary cookies to run this site, and analytics cookies to understand how it is used.',
            )}{' '}
            {/* Disclosure is mandatory here — see the scroll-to-accept note in this file's header. */}
            {t('If you continue scrolling, we’ll take that as acceptance.')}{' '}
            <Link
              href="/cookies"
              className="font-semibold text-teal-dark underline-offset-2 hover:underline"
            >
              {t('Cookie policy')}
            </Link>
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCustomising((v) => !v)}
              aria-expanded={customising}
              className="rounded-full px-3.5 py-2 text-[13px] font-bold text-ink-muted outline-none transition hover:text-ink focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
            >
              {t('Customise')}
            </button>
            <button
              type="button"
              onClick={() => decide(CONSENT_DENIED)}
              className="rounded-full border border-ink/20 px-5 py-2 text-[13px] font-bold text-ink outline-none transition hover:border-ink/40 focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
            >
              {t('Reject all')}
            </button>
            <button
              type="button"
              onClick={() => decide(CONSENT_GRANTED)}
              className="rounded-full bg-teal-dark px-5 py-2 text-[13px] font-bold text-white outline-none transition hover:bg-teal-dark/90 focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
            >
              {t('Accept all')}
            </button>
          </div>
        </div>

        {customising && (
          <div className="mt-3 border-t border-ink/10 pt-3">
            <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
              <ConsentRow
                label={t('Strictly necessary')}
                hint={t('Sign-in, cart, language and currency. Always on.')}
                checked
                locked
              />
              <ConsentRow
                label={t('Analytics')}
                hint={t('Google Analytics, so we can see which pages are useful.')}
                checked={choice.analytics}
                onChange={(v) => setChoice((c) => ({ ...c, analytics: v }))}
              />
              <ConsentRow
                label={t('Marketing')}
                hint={t('Advertising and remarketing. Off unless you turn it on.')}
                checked={choice.marketing}
                onChange={(v) => setChoice((c) => ({ ...c, marketing: v }))}
              />
            </ul>
            <button
              type="button"
              onClick={() => decide(choice)}
              className="mt-3 rounded-full bg-teal-dark px-5 py-2 text-[13px] font-bold text-white outline-none transition hover:bg-teal-dark/90 focus-visible:ring-2 focus-visible:ring-teal focus-visible:ring-offset-2"
            >
              {t('Save my choices')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ConsentRow({
  label,
  hint,
  checked,
  locked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  locked?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <li>
      {/* Wrapping label: the whole row is the hit target, and the hint is read out with the name. */}
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          disabled={locked}
          onChange={(e) => onChange?.(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0 accent-teal-dark disabled:cursor-not-allowed disabled:opacity-60"
        />
        <span className="flex flex-col">
          <span className="text-[13px] font-bold text-ink">{label}</span>
          <span className="text-[12.5px] leading-snug text-ink-muted">{hint}</span>
        </span>
      </label>
    </li>
  );
}
