'use client';

import { useEffect, useState } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { useToast } from '@/components/site/ToastProvider';
import { IconWallet } from '@/components/ui/icons';
import { EUR_MUR_MAX, EUR_MUR_MIN, formatMur } from '@/lib/money/fx';
import type { ChargeCurrency } from '@/lib/settings/charge-currency';

/** What the pin falls back to when no rate has been set (create_payment's in-SQL floor). */
const FLOOR_RATE = 53;

const OPTIONS: { value: ChargeCurrency; label: string; detail: string }[] = [
  {
    value: 'MUR',
    label: 'Rupees (MUR)',
    detail: 'The euro price × your rate below, rounded to whole rupees.',
  },
  { value: 'EUR', label: 'Euros (EUR)', detail: 'Exactly the euro price the customer sees.' },
];

/** "53.2" / "53,2" → 53.2; anything unparseable → NaN. */
function parseRate(value: string): number {
  const normalised = value.trim().replace(',', '.');
  return normalised === '' ? Number.NaN : Number(normalised);
}

function formatChangedAt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Indian/Mauritius',
  });
}

/**
 * Admin control for how customers' cards are charged (the `business_settings` singleton,
 * 20261017120000): the MUR/EUR switch and the owner-set EUR→MUR rate, which replaced the Exchange
 * Rate API feed.
 *
 * Saves under staff RLS through the browser client, like {@link WhatsAppNumberCard}. Nothing here
 * computes a charge — create_payment pins every payment row in SQL from this same row (and the column
 * CHECK refuses a rate outside 40–70, the band validated here too). The "€100 →" preview mirrors that
 * pin's whole-rupee rounding for display only.
 */
export function PaymentCurrencyCard() {
  const { showToast } = useToast();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // The last-persisted values.
  const [savedCurrency, setSavedCurrency] = useState<ChargeCurrency>('MUR');
  const [savedRate, setSavedRate] = useState<number | null>(null);
  const [rateChangedAt, setRateChangedAt] = useState<string | null>(null);
  // The form.
  const [currency, setCurrency] = useState<ChargeCurrency>('MUR');
  const [rateInput, setRateInput] = useState('');

  useEffect(() => {
    let active = true;
    getBrowserSupabase()
      .from('business_settings')
      .select('charge_currency, eur_mur_rate, eur_mur_rate_updated_at')
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setLoadError('Could not load the payment settings.');
        } else {
          const ccy: ChargeCurrency = data?.charge_currency === 'EUR' ? 'EUR' : 'MUR';
          // numeric arrives as a number or a string depending on the client; normalise once.
          const rate = data?.eur_mur_rate != null ? Number(data.eur_mur_rate) : null;
          setSavedCurrency(ccy);
          setCurrency(ccy);
          setSavedRate(rate);
          setRateInput(rate != null ? String(rate) : '');
          setRateChangedAt(data?.eur_mur_rate_updated_at ?? null);
        }
        setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const rate = parseRate(rateInput);
  const rateBlank = rateInput.trim() === '';
  const rateValid = Number.isFinite(rate) && rate >= EUR_MUR_MIN && rate <= EUR_MUR_MAX;
  // A never-set rate may stay blank (the pin then uses the floor); a set one can't be cleared.
  const rateOk = rateValid || (rateBlank && savedRate == null);
  const rateChanged = rateValid ? rate !== savedRate : false;
  const dirty = currency !== savedCurrency || rateChanged;
  // €100 at this rate, rounded to whole rupees exactly as create_payment does.
  const previewRate = rateValid ? rate : savedRate == null && rateBlank ? FLOOR_RATE : null;
  const previewMinor = previewRate != null ? Math.round((10_000 * previewRate) / 100) * 100 : null;

  async function save() {
    if (!dirty || !rateOk || saving) return;
    if (
      currency !== savedCurrency &&
      !window.confirm(
        currency === 'EUR'
          ? 'Charge customer cards in euros from now on?\n\nPayments already started, and bookings that have already paid a deposit in rupees, stay in rupees.'
          : 'Charge customer cards in Mauritian rupees from now on?\n\nPayments already started, and bookings that have already paid a deposit in euros, stay in euros.',
      )
    ) {
      return;
    }
    setSaving(true);
    const supabase = getBrowserSupabase();
    const { data: userData } = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('business_settings')
      .update({
        charge_currency: currency,
        ...(rateChanged ? { eur_mur_rate: rate, eur_mur_rate_updated_at: now } : {}),
        updated_at: now,
        updated_by: userData.user?.id ?? null,
      })
      .eq('id', true);
    setSaving(false);
    if (error) {
      showToast({ title: 'Could not save', description: error.message, variant: 'error' });
      return;
    }
    setSavedCurrency(currency);
    if (rateChanged) {
      setSavedRate(rate);
      setRateChangedAt(now);
    }
    showToast({
      title: 'Payment settings saved',
      description:
        currency === 'EUR'
          ? 'New payments are charged in euros.'
          : `New payments are charged in rupees at 1 EUR = ${rateChanged ? rate : (savedRate ?? FLOOR_RATE)} MUR.`,
    });
  }

  return (
    <section className="rounded-2xl border border-[#EAEEF0] bg-white">
      <div className="flex items-center gap-2.5 border-b border-[#EEF1F3] px-[18px] py-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-teal/10 text-teal">
          <IconWallet width={18} height={18} />
        </span>
        <div>
          <h2 className="text-[15px] font-extrabold text-ink">Card payments</h2>
          <p className="text-[12.5px] text-ink-muted">
            The currency customers’ cards are charged in. Prices always show in euros.
          </p>
        </div>
      </div>

      <div className="px-[18px] py-4">
        {loadError ? (
          <p className="rounded-xl border border-coral/30 bg-coral/5 p-3 text-[13px] font-medium text-coral">
            {loadError}
          </p>
        ) : !loaded ? (
          <div className="h-32 animate-pulse rounded-xl bg-[#F1F4F5]" />
        ) : (
          <>
            <div
              role="radiogroup"
              aria-label="Charge cards in"
              className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            >
              {OPTIONS.map((option) => {
                const selected = currency === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setCurrency(option.value)}
                    className={`rounded-xl border px-3.5 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-teal/30 ${
                      selected
                        ? 'border-teal bg-teal/5'
                        : 'border-[#E2E7EA] bg-white hover:border-teal/50'
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-[13.5px] font-bold text-ink">{option.label}</span>
                      <span
                        aria-hidden
                        className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                          selected ? 'border-teal' : 'border-[#C9D1D5]'
                        }`}
                      >
                        {selected && <span className="h-2 w-2 rounded-full bg-teal" />}
                      </span>
                    </span>
                    <span className="mt-1 block text-[12px] text-ink-muted">{option.detail}</span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4">
              <label htmlFor="eur-mur-rate" className="text-[13px] font-bold text-ink">
                Euro to rupee rate
              </label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2.5">
                <div
                  className={`flex min-w-0 flex-1 items-center rounded-xl border bg-white focus-within:ring-2 ${
                    rateOk
                      ? 'border-[#E2E7EA] focus-within:border-teal focus-within:ring-teal/20'
                      : 'border-coral/50 focus-within:border-coral focus-within:ring-coral/20'
                  }`}
                >
                  <span className="shrink-0 pl-3.5 text-sm font-semibold text-ink-muted">
                    1 EUR =
                  </span>
                  <input
                    id="eur-mur-rate"
                    type="text"
                    inputMode="decimal"
                    value={rateInput}
                    onChange={(e) => setRateInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') save();
                    }}
                    placeholder={String(FLOOR_RATE)}
                    aria-invalid={!rateOk}
                    aria-describedby="eur-mur-rate-help"
                    className="min-w-0 flex-1 bg-transparent px-2 py-2.5 text-sm font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-muted"
                  />
                  <span className="shrink-0 pr-3.5 text-sm font-semibold text-ink-muted">MUR</span>
                </div>
                <button
                  type="button"
                  onClick={save}
                  disabled={!dirty || !rateOk || saving}
                  className="shrink-0 rounded-xl bg-teal px-4 py-2.5 text-[13.5px] font-bold text-white transition hover:bg-teal-dark disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>

              <div id="eur-mur-rate-help" className="mt-2 space-y-1 text-[12.5px]">
                {!rateOk ? (
                  <p className="font-medium text-coral">
                    Enter a rate between {EUR_MUR_MIN} and {EUR_MUR_MAX} — for example 53.20.
                  </p>
                ) : previewMinor != null ? (
                  <p className="text-ink-muted">
                    A €100 booking is charged{' '}
                    <span className="font-semibold text-ink">{formatMur(previewMinor)}</span>
                    {currency === 'EUR' ? ' when paid in rupees.' : '.'}
                  </p>
                ) : null}
                <p className="text-ink-muted">
                  {savedRate == null
                    ? `Not set yet — rupee charges use the ${FLOOR_RATE}.00 safety rate.`
                    : rateChangedAt
                      ? `Rate last changed ${formatChangedAt(rateChangedAt)}.`
                      : null}
                  {currency === 'EUR' &&
                    ' While cards are charged in euros, the rate is only used for bookings that already paid in rupees.'}
                </p>
              </div>
            </div>

            <p className="mt-4 rounded-xl bg-[#F6F8F9] px-3.5 py-2.5 text-[12px] leading-relaxed text-ink-muted">
              Changes apply to payments started from now on. A payment a customer has already opened
              keeps its currency and amount, and a booking that has already paid part (a deposit)
              pays the rest in the same currency.
            </p>
          </>
        )}
      </div>
    </section>
  );
}
