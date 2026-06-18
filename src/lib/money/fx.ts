import type { Currency } from '@/lib/i18n/config';

/** Used when the live rate can't be fetched, so prices never break. ~recent EUR→USD. */
export const FALLBACK_USD_RATE = 1.08;

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
 * Format a EUR amount in the chosen display currency. Bookings are always CHARGED in EUR; USD is a
 * live-rate display conversion (rounded to whole dollars to read as the approximation it is).
 */
export function formatMoney(amountEur: number, currency: Currency, usdRate: number): string {
  if (currency === 'USD') return `$${Math.round(amountEur * usdRate)}`;
  return formatEur(amountEur);
}
