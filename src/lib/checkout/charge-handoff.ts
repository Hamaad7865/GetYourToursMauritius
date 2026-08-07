/**
 * Hands the EXACT card charge (the MUR figure pinned by api_create_payment and returned by
 * POST /api/v1/payments) from the page that minted the checkout to the pay page that discloses it.
 *
 * sessionStorage, not the URL: an amount in the query string invites tampering screenshots and leaks
 * into referrers/history. And a SEPARATE key from the pay-progress handoff on purpose —
 * EmbeddedCheckout clears that one the moment the widget is ready, which would wipe this disclosure
 * out from under the customer mid-read.
 *
 * The figure is display-only. The server charges what IT pinned regardless of what this says; a
 * missing/stale handoff downgrades the pay page to a currency-only sentence, never to a client-side
 * recomputation.
 */

const KEY = 'bmt.charge.v1';

/** Past this age the figure may describe an older session — say less rather than risk saying wrong. */
const MAX_AGE_MS = 30 * 60 * 1_000;

export interface ChargeHandoff {
  /** Booking ref the charge belongs to — read back only for the matching booking. */
  ref: string;
  /** ISO-4217 currency the CARD is charged in (MUR). */
  chargeCurrency: string;
  /** The pinned charge, in chargeCurrency minor units. */
  chargeAmountMinor: number;
  /** The EUR booking total in minor units, for the "converted from" phrasing. Optional. */
  totalEurMinor?: number;
  /** The EUR deposit taken NOW, in minor units, when this is a genuine PARTIAL deposit
   *  (0 < deposit < total). Present only alongside totalEurMinor; lets the pay page frame the MUR
   *  charge as a deposit + balance instead of a bare figure that can read like a bad exchange rate. */
  depositEurMinor?: number;
  at: number;
}

export function saveChargeHandoff(handoff: Omit<ChargeHandoff, 'at'>): void {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify({ ...handoff, at: Date.now() }));
  } catch {
    /* storage unavailable (private mode) — the pay page falls back to the currency-only line */
  }
}

export function readChargeHandoff(ref: string): ChargeHandoff | null {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChargeHandoff> | null;
    if (
      !parsed ||
      parsed.ref !== ref ||
      typeof parsed.chargeCurrency !== 'string' ||
      typeof parsed.chargeAmountMinor !== 'number' ||
      !Number.isFinite(parsed.chargeAmountMinor) ||
      parsed.chargeAmountMinor <= 0 ||
      typeof parsed.at !== 'number' ||
      Date.now() - parsed.at > MAX_AGE_MS
    ) {
      return null;
    }
    return parsed as ChargeHandoff;
  } catch {
    return null;
  }
}
