'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  CCY_COOKIE,
  LANG_COOKIE,
  PREF_MAX_AGE,
  type Currency,
  type Locale,
} from '@/lib/i18n/config';
import { translate } from '@/lib/i18n/translate';
import { formatMoney } from '@/lib/money/fx';
import { LangCurrencyModal } from './LangCurrencyModal';

// Back-compat re-exports (the modal + older imports used these names/paths).
export type Language = Locale;
export type { Currency } from '@/lib/i18n/config';
export { LANGUAGE_LABELS, CURRENCY_LABELS } from '@/lib/i18n/config';

interface PreferencesValue {
  language: Locale;
  currency: Currency;
  usdRate: number;
  setLanguage: (l: Locale) => void;
  setCurrency: (c: Currency) => void;
  openPrefs: (tab?: 'language' | 'currency') => void;
  closePrefs: () => void;
  /** Translate an English source string (interpolating `{name}` vars) for the current language. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** Format a EUR amount in the current display currency (USD is a live-rate display conversion). */
  money: (amountEur: number) => string;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);

function writeCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/; max-age=${PREF_MAX_AGE}; samesite=lax`;
}

/**
 * Site-wide language + display-currency preference (English/Français, EUR/USD). Initialised from the
 * cookies the server already read, so the first client render matches SSR (no flash). Changing either
 * writes the cookie and `router.refresh()`es so server-rendered pages re-render in the new
 * language/currency, while client components update instantly from context.
 */
export function PreferencesProvider({
  children,
  initialLanguage = 'en',
  initialCurrency = 'EUR',
  initialUsdRate = 1.08,
}: {
  children: ReactNode;
  initialLanguage?: Locale;
  initialCurrency?: Currency;
  initialUsdRate?: number;
}) {
  const router = useRouter();
  const [language, setLanguageState] = useState<Locale>(initialLanguage);
  const [currency, setCurrencyState] = useState<Currency>(initialCurrency);
  const [usdRate] = useState<number>(initialUsdRate);
  const [modalTab, setModalTab] = useState<'language' | 'currency' | null>(null);

  // The static root layout renders <html lang="en">; keep the document language in sync with the
  // chosen locale on the client (server pages already render their content in the right language).
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = useCallback(
    (l: Locale) => {
      setLanguageState(l);
      writeCookie(LANG_COOKIE, l);
      router.refresh();
    },
    [router],
  );

  const setCurrency = useCallback(
    (c: Currency) => {
      setCurrencyState(c);
      writeCookie(CCY_COOKIE, c);
      router.refresh();
    },
    [router],
  );

  const openPrefs = useCallback(
    (tab: 'language' | 'currency' = 'language') => setModalTab(tab),
    [],
  );
  const closePrefs = useCallback(() => setModalTab(null), []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => translate(language, key, vars),
    [language],
  );
  const money = useCallback(
    (amountEur: number) => formatMoney(amountEur, currency, usdRate),
    [currency, usdRate],
  );

  const value = useMemo<PreferencesValue>(
    () => ({
      language,
      currency,
      usdRate,
      setLanguage,
      setCurrency,
      openPrefs,
      closePrefs,
      t,
      money,
    }),
    [language, currency, usdRate, setLanguage, setCurrency, openPrefs, closePrefs, t, money],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
      {modalTab && (
        <LangCurrencyModal
          tab={modalTab}
          language={language}
          currency={currency}
          onLanguage={setLanguage}
          onCurrency={setCurrency}
          onClose={closePrefs}
        />
      )}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used within <PreferencesProvider>.');
  return ctx;
}

/** Convenience: the translate function bound to the current language. */
export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  return usePreferences().t;
}

/** Convenience: the EUR-amount formatter bound to the current display currency. */
export function useMoney(): (amountEur: number) => string {
  return usePreferences().money;
}
