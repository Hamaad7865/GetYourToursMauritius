'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LangCurrencyModal } from './LangCurrencyModal';

export type Language = 'en' | 'fr';
export type Currency = 'EUR';

export const LANGUAGE_LABELS: Record<Language, string> = { en: 'English', fr: 'Français' };
export const CURRENCY_LABELS: Record<Currency, { label: string; symbol: string }> = {
  EUR: { label: 'Euro', symbol: '€' },
};

interface PreferencesValue {
  language: Language;
  currency: Currency;
  setLanguage: (l: Language) => void;
  setCurrency: (c: Currency) => void;
  openPrefs: (tab?: 'language' | 'currency') => void;
  closePrefs: () => void;
}

const PreferencesContext = createContext<PreferencesValue | null>(null);
const STORAGE_KEY = 'gytm:prefs';

/**
 * Site-wide language + currency preference (English/Français, EUR), persisted to
 * localStorage and surfaced through the header's "EN/EUR €" control + modal. Stored as the
 * foundation for full localisation; today it drives the header label and the html lang.
 */
export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>('en');
  const [currency, setCurrencyState] = useState<Currency>('EUR');
  const [modalTab, setModalTab] = useState<'language' | 'currency' | null>(null);

  // Hydrate the saved preference after mount (avoids an SSR/client mismatch).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as { language?: Language; currency?: Currency };
      if (saved.language === 'en' || saved.language === 'fr') setLanguageState(saved.language);
      if (saved.currency === 'EUR') setCurrencyState(saved.currency);
    } catch {
      /* ignore malformed storage */
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const persist = useCallback((next: { language: Language; currency: Currency }) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore storage errors */
    }
  }, []);

  const setLanguage = useCallback(
    (l: Language) => {
      setLanguageState(l);
      persist({ language: l, currency });
    },
    [currency, persist],
  );

  const setCurrency = useCallback(
    (c: Currency) => {
      setCurrencyState(c);
      persist({ language, currency: c });
    },
    [language, persist],
  );

  const openPrefs = useCallback((tab: 'language' | 'currency' = 'language') => setModalTab(tab), []);
  const closePrefs = useCallback(() => setModalTab(null), []);

  const value = useMemo<PreferencesValue>(
    () => ({ language, currency, setLanguage, setCurrency, openPrefs, closePrefs }),
    [language, currency, setLanguage, setCurrency, openPrefs, closePrefs],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
      {modalTab && (
        <LangCurrencyModal
          tab={modalTab}
          language={language}
          currency={currency}
          onLanguage={(l) => setLanguage(l)}
          onCurrency={(c) => setCurrency(c)}
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
