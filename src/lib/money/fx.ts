import type { Currency, Locale } from '@/lib/i18n/config';

/** Used when the live rate can't be fetched, so prices never break. ~recent EUR→USD. */
export const FALLBACK_USD_RATE = 1.08;

/**
 * Plausibility band for the EUR→MUR rate. EUR/MUR has ranged ~44–54 over the past decade; anything
 * outside 40–70 is structurally wrong (an inverted payload ≈ 0.0185 would bill MUR 1.85 for a €100
 * booking — and, because settled == charged, CONFIRM it; a USD-based one lands near 1). The same
 * band is enforced in SQL (api_upsert_fx_rate on write, api_create_payment on read) — keep all
 * three aligned.
 */
export const EUR_MUR_MIN = 40;
export const EUR_MUR_MAX = 70;

/** Abort the FX fetch fast — it runs on the maintenance cron, never on a checkout request, and a
 *  hung fetch must not eat the cron invocation. Mirrors PEACH_TIMEOUT_MS's reasoning at cron scale. */
const FX_FETCH_TIMEOUT_MS = 2_500;

/** Reject a "fresh" payload whose own timestamp is ancient — the API echoing a stale cache must not
 *  re-arm our 48h staleness alarm. */
const FX_MAX_UPSTREAM_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export interface EurMurRate {
  rate: number;
  source: string;
  /** ISO timestamp of the upstream quote (their update time, not our fetch time). */
  fetchedAt: string;
}

/**
 * Live EUR→MUR rate from open.er-api.com (the ECB feed used for USD display does not publish MUR).
 * Called ONLY by the maintenance cron, which persists it server-side (`fx_rates`) via
 * `api_upsert_fx_rate`; the charge pin in `api_create_payment` reads the table, so checkout never
 * waits on this network call and tests never need it stubbed. Returns null on ANY failure —
 * non-200, malformed body, missing/implausible rate, stale upstream timestamp, timeout — and never
 * throws; the caller keeps the last-known-good row and alerts only once it is older than 48h.
 */
export async function fetchEurMurRate(): Promise<EurMurRate | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FX_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/EUR', {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: string;
      base_code?: string;
      rates?: { MUR?: unknown };
      time_last_update_unix?: unknown;
    };
    if (data.result !== 'success' || data.base_code !== 'EUR') return null;
    const rate = data.rates?.MUR;
    if (typeof rate !== 'number' || !Number.isFinite(rate)) return null;
    if (rate < EUR_MUR_MIN || rate > EUR_MUR_MAX) return null;
    const updatedUnix = data.time_last_update_unix;
    const updatedMs = typeof updatedUnix === 'number' ? updatedUnix * 1_000 : NaN;
    if (!Number.isFinite(updatedMs) || Date.now() - updatedMs > FX_MAX_UPSTREAM_AGE_MS) return null;
    return {
      rate,
      source: 'open.er-api.com',
      fetchedAt: new Date(updatedMs).toISOString(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
 * price; the card is charged in MUR at a pinned rate — see api_create_payment); USD is a live-rate
 * display conversion (rounded to whole dollars to read as the approximation it is).
 */
export function formatMoney(amountEur: number, currency: Currency, usdRate: number): string {
  if (currency === 'USD') return `$${Math.round(amountEur * usdRate)}`;
  return formatEur(amountEur);
}
