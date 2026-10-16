import type { Currency, Locale } from '@/lib/i18n/config';

/** Used when the live rate can't be fetched, so prices never break. ~recent EUR→USD. */
export const FALLBACK_USD_RATE = 1.08;

/**
 * Plausibility band for the EUR→MUR rate. EUR/MUR has ranged ~44–54 over the past decade; anything
 * outside 40–70 is structurally wrong (an inverted value ≈ 0.0185 would bill MUR 1.85 for a €100
 * booking — and, because settled == charged, CONFIRM it; a slipped decimal gives 5.3 or 530). The rate
 * is typed in by the owner in /admin since 2026-10-17 (the Exchange Rate API feed is retired). The same
 * band is enforced in SQL (the business_settings.eur_mur_rate CHECK on write, create_payment on read)
 * and by the admin card — keep all three aligned.
 */
export const EUR_MUR_MIN = 40;
export const EUR_MUR_MAX = 70;

const MUR_BCP47: Record<Locale, string> = { en: 'en-GB', fr: 'fr-FR' };

/**
 * Format a MUR minor-unit amount for display/documents, e.g. `MUR 5,938.00` (en) /
 * `MUR 5 938,00` (fr). Always the ISO code, never `₨`: the invoice PDF's WinAnsi encoder silently
 * strips U+20A8, which would print a legal document with a bare number. MUR is an ISO exponent-2
 * currency, so /100 here must stay aligned with the provider boundary (peach.ts sends
 * `(minor / 100).toFixed(2)`).
 */
export function formatMur(amountMinor: number, locale: Locale = 'en'): string {
  const formatted = new Intl.NumberFormat(MUR_BCP47[locale], {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
  return `MUR ${formatted}`;
}

/**
 * Live EUR→USD rate from Frankfurter (frankfurter.app) — ECB daily reference rates, free, no API key.
 * Cached a day via the Next data cache; falls back to {@link FALLBACK_USD_RATE} on any failure so a
 * provider outage can never break price rendering.
 */
export async function getUsdRate(): Promise<number> {
  try {
    const res = await fetch('https://api.frankfurter.app/latest?from=EUR&to=USD', {
      next: { revalidate: 86400 },
    });
    if (!res.ok) return FALLBACK_USD_RATE;
    const data = (await res.json()) as { rates?: { USD?: number } };
    const rate = data.rates?.USD;
    return typeof rate === 'number' && rate > 0 ? rate : FALLBACK_USD_RATE;
  } catch {
    return FALLBACK_USD_RATE;
  }
}

function formatEur(amount: number): string {
  // Whole euros render clean; otherwise two decimals (matches the booking amounts).
  return Number.isInteger(amount) ? `€${amount}` : `€${amount.toFixed(2)}`;
}

/**
 * Format a EUR amount in the chosen display currency. Prices are QUOTED in EUR (the contractual
 * price; the card is charged in EUR or in MUR at a pinned rate, per the admin switch — see
 * create_payment); USD is a live-rate display conversion (rounded to whole dollars to read as the
 * approximation it is).
 */
export function formatMoney(amountEur: number, currency: Currency, usdRate: number): string {
  if (currency === 'USD') return `$${Math.round(amountEur * usdRate)}`;
  return formatEur(amountEur);
}
