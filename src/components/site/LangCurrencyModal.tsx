'use client';

import { useRef, useState } from 'react';
import { IconCheck, IconGlobe, IconWallet, IconX } from '@/components/ui/icons';
import { useDialog } from '@/lib/a11y/useDialog';
import type { Currency, Language } from './PreferencesProvider';
import { CURRENCY_LABELS, LANGUAGE_LABELS, useT } from './PreferencesProvider';

const LANGUAGES: Language[] = ['en', 'fr'];
const CURRENCIES: Currency[] = ['EUR', 'USD'];

/** GetYourGuide-style language + currency picker. English/Français; prices shown in EUR or USD
 *  (USD is a live-rate display conversion — bookings are charged in EUR). */
export function LangCurrencyModal({
  tab,
  language,
  currency,
  onLanguage,
  onCurrency,
  onClose,
}: {
  tab: 'language' | 'currency';
  language: Language;
  currency: Currency;
  onLanguage: (l: Language) => void;
  onCurrency: (c: Currency) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [active, setActive] = useState<'language' | 'currency'>(tab);
  const firstTabRef = useRef<HTMLButtonElement>(null);
  // APG modal behaviour: scroll-lock, Escape, focus move-in/return, and a Tab focus trap.
  const dialogRef = useDialog(true, onClose, () => firstTabRef.current);

  return (
    <div
      ref={dialogRef}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/50 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t('Language and currency')}
      onMouseDown={onClose}
    >
      <div
        className="relative w-full max-w-[560px] rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Close')}
          className="absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-full text-ink-muted hover:bg-cream hover:text-ink"
        >
          <IconX width={18} height={18} />
        </button>

        <div className="flex gap-6 border-b border-ink/10">
          <TabButton ref={firstTabRef} active={active === 'language'} onClick={() => setActive('language')} icon={<IconGlobe width={18} height={18} />}>
            {t('Language')}
          </TabButton>
          <TabButton active={active === 'currency'} onClick={() => setActive('currency')} icon={<IconWallet width={18} height={18} />}>
            {t('Currency')}
          </TabButton>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-1 sm:grid-cols-3">
          {active === 'language'
            ? LANGUAGES.map((l) => (
                <Option
                  key={l}
                  selected={l === language}
                  label={LANGUAGE_LABELS[l]}
                  onClick={() => {
                    onLanguage(l);
                    onClose();
                  }}
                />
              ))
            : CURRENCIES.map((c) => (
                <Option
                  key={c}
                  selected={c === currency}
                  label={`${CURRENCY_LABELS[c].label} (${CURRENCY_LABELS[c].symbol})`}
                  onClick={() => {
                    onCurrency(c);
                    onClose();
                  }}
                />
              ))}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
  ref,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  ref?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 pb-3 text-sm font-bold transition-colors ${
        active ? 'border-teal text-teal' : 'border-transparent text-ink-muted hover:text-ink'
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function Option({ selected, label, onClick }: { selected: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
        selected ? 'text-teal' : 'text-ink hover:bg-cream'
      }`}
    >
      {label}
      {selected && <IconCheck width={16} height={16} className="shrink-0 text-teal" />}
    </button>
  );
}
