'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import { useT } from '@/components/site/PreferencesProvider';
import { IconShield, IconWallet } from '@/components/ui/icons';
import { SignedOutPrompt, AccountSpinner } from './AccountChrome';

interface SavedCard {
  id: string;
  brand: string | null;
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  createdAt: string;
}

/**
 * Saved (tokenised) payment cards, shown as realistic card faces. The card vault lives at Peach — we
 * only ever hold an opaque token + brand/last4/expiry — so we render that metadata (never a real PAN)
 * and let the customer forget a card. Saving happens at checkout (the widget's "save card" opt-in).
 */
export function AccountSavedCards() {
  const t = useT();
  const { user, profile, session, loading } = useAuth();
  const [cards, setCards] = useState<SavedCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const token = session?.access_token;

  useEffect(() => {
    if (!user || !token) return;
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/v1/saved-cards', {
          headers: { authorization: `Bearer ${token}` },
        });
        const json = (await res.json()) as { ok?: boolean; data?: SavedCard[] };
        if (!active) return;
        if (!res.ok || !json.ok) {
          setError(t('We couldn’t load your saved cards.'));
          setCards([]);
        } else {
          setCards(json.data ?? []);
        }
      } catch {
        if (active) {
          setError(t('We couldn’t load your saved cards.'));
          setCards([]);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [user, token, t]);

  async function remove(id: string): Promise<void> {
    if (!token) return;
    setRemoving(id);
    try {
      const res = await fetch(`/api/v1/saved-cards/${id}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${token}` },
      });
      if (res.ok) setCards((prev) => (prev ?? []).filter((c) => c.id !== id));
      else setError(t('We couldn’t remove that card.'));
    } catch {
      setError(t('We couldn’t remove that card.'));
    } finally {
      setRemoving(null);
    }
  }

  if (loading) return <AccountSpinner />;
  if (!user) return <SignedOutPrompt message={t('Sign in to manage your saved cards.')} />;

  const cardholder = profile?.fullName ?? user.email ?? '';

  return (
    <div className="max-w-2xl">
      <h1 className="font-display text-2xl font-semibold text-ink">{t('Saved cards')}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t('Save a card at checkout for faster payment next time.')}
      </p>

      {error && (
        <p role="alert" className="mt-4 text-[13px] font-medium text-coral">
          {error}
        </p>
      )}

      {cards === null && !error && (
        <div className="mt-6">
          <AccountSpinner />
        </div>
      )}

      {cards !== null && cards.length === 0 && (
        <div className="mt-5 rounded-2xl border border-dashed border-ink/15 bg-cream/40 p-8 text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-teal/10 text-teal">
            <IconWallet width={24} height={24} />
          </span>
          <p className="mt-3 text-sm font-bold text-ink">{t('No saved cards yet')}</p>
          <p className="mx-auto mt-1 max-w-sm text-[13px] text-ink-muted">
            {t(
              'When you pay for a booking, tick “save card” to securely store it here for next time.',
            )}
          </p>
        </div>
      )}

      {cards !== null && cards.length > 0 && (
        <ul className="mt-6 grid gap-5 sm:grid-cols-2">
          {cards.map((c) => {
            const expiry =
              c.expMonth && c.expYear
                ? `${String(c.expMonth).padStart(2, '0')}/${String(c.expYear).slice(-2)}`
                : '••/••';
            return (
              <li key={c.id} className="group">
                {/* Realistic card face — metadata only, never a real card number. */}
                <div className="relative aspect-[1.586] w-full overflow-hidden rounded-2xl bg-gradient-to-br from-teal-dark via-teal to-ink p-5 text-white shadow-[0_18px_40px_-22px_rgba(10,46,54,0.65)]">
                  <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/10 blur-2xl" />
                  <div className="pointer-events-none absolute -left-6 bottom-0 h-20 w-20 rounded-full bg-gold-light/20 blur-2xl" />
                  <div className="relative flex h-full flex-col justify-between">
                    <div className="flex items-start justify-between">
                      <span className="h-7 w-10 rounded-md bg-gradient-to-br from-gold-light to-gold/70 shadow-inner" />
                      <span className="text-sm font-bold uppercase tracking-[0.15em]">
                        {c.brand ?? t('Card')}
                      </span>
                    </div>
                    <div>
                      <p className="font-mono text-[17px] tracking-[0.25em] tabular-nums">
                        •••• •••• •••• {c.last4 ?? '••••'}
                      </p>
                      <div className="mt-3 flex items-end justify-between gap-3">
                        <span className="max-w-[62%] truncate text-[12px] uppercase tracking-wide text-white/85">
                          {cardholder}
                        </span>
                        <span className="shrink-0 text-[12px] tabular-nums text-white/85">
                          {expiry}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between px-1">
                  <span className="text-[13px] text-ink-muted">
                    {c.brand ?? t('Card')} · {t('Expires')} {expiry}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    disabled={removing === c.id}
                    className="text-[13px] font-bold text-coral hover:text-coral-dark disabled:opacity-50"
                  >
                    {removing === c.id ? t('Removing…') : t('Remove')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-6 flex items-center justify-center gap-2 text-[12.5px] text-ink-muted">
        <IconShield width={16} height={16} className="text-teal" />
        <span>
          {t('Encrypted by Peach Payments — we never see or store your full card number.')}
        </span>
      </div>
    </div>
  );
}
