'use client';

import { useAuth } from '@/components/auth/AuthProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { IconShield, IconWallet } from '@/components/ui/icons';
import { SignedOutPrompt, AccountSpinner } from './AccountChrome';

/**
 * Saved (tokenised) payment cards. The card vault lives at the payment provider — we only ever store
 * a token + the last four digits — so until Peach card tokenisation is enabled on the merchant
 * account this is an informational empty state. See the saved-cards write-up for what's required.
 */
export function AccountSavedCards() {
  const t = useT();
  const { user, loading } = useAuth();

  if (loading) return <AccountSpinner />;
  if (!user) return <SignedOutPrompt message={t('Sign in to manage your saved cards.')} />;

  return (
    <div className="max-w-xl">
      <h1 className="font-display text-2xl font-semibold text-ink">{t('Saved cards')}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t('Save a card for faster checkout next time.')}
      </p>

      <div className="mt-5 rounded-2xl border border-dashed border-ink/15 bg-cream/40 p-8 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-teal/10 text-teal">
          <IconWallet width={24} height={24} />
        </span>
        <p className="mt-3 text-sm font-bold text-ink">{t('No saved cards yet')}</p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] text-ink-muted">
          {t(
            'When you pay for a booking you’ll be able to securely save your card here for next time.',
          )}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 text-[12.5px] text-ink-muted">
        <IconShield width={16} height={16} className="text-teal" />
        <span>
          {t('Encrypted by Peach Payments — we never see or store your full card number.')}
        </span>
      </div>
    </div>
  );
}
