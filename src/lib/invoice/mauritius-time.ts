/**
 * Mauritius local-time formatting for the invoice PDF + confirmation email.
 *
 * Mauritius observes a FIXED UTC+4 offset year-round (no daylight saving). Tour occurrences are
 * stored as instants (noon Mauritius = 08:00 UTC), so printing the raw UTC wall-clock is 4 hours
 * wrong — a noon tour reads `08:00`, and a post-20:00-MUT instant rolls the date back a day.
 *
 * EDGE-SAFE BY CONSTRUCTION: we do NOT use `Intl.DateTimeFormat({ timeZone: 'Indian/Mauritius' })`
 * because the Cloudflare edge runtime is not guaranteed to ship the ICU timezone database. Instead
 * we parse the ISO to a millisecond instant, add a deterministic +4h, and read the UTC accessors —
 * so the displayed wall-clock IS Mauritius local time, with zero runtime dependencies. Pure: no
 * `Date.now()`, no ambient timezone.
 */

import { transferLegs } from '@/lib/transfers/leg-times';
import type { TransferDetails } from './model';

/** Mauritius is UTC+4 with no DST — a constant offset we can add directly. */
const MAURITIUS_OFFSET_MS = 4 * 60 * 60 * 1000;

const pad = (n: number) => String(n).padStart(2, '0');

/** Parse an ISO string to the Mauritius-local instant, or `null` if the input is null/unparseable. */
function toMauritiusDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  // Shift the instant by the fixed offset, then read UTC accessors to get the Mauritius wall-clock.
  return new Date(ms + MAURITIUS_OFFSET_MS);
}

/**
 * Format an ISO instant as Mauritius local `YYYY-MM-DD HH:mm MUT`.
 * Returns `''` for null/undefined and the raw string when unparseable (mirrors the prior helpers).
 */
export function formatMauritiusDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = toMauritiusDate(iso);
  if (!d) return iso;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours(),
  )}:${pad(d.getUTCMinutes())} MUT`;
}

/**
 * Format an ISO instant as a plain Mauritius-local `YYYY-MM-DD` date (no time, no label).
 * Returns `''` for null/undefined and the raw string when unparseable.
 */
export function formatMauritiusDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = toMauritiusDate(iso);
  if (!d) return iso;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/**
 * The booking's "Date" line on the invoice PDF + confirmation email: when the guest is collected.
 *
 * Every catalogue day-slot is materialised at a placeholder NOON (`materialize_availability`), so a
 * transfer's occurrence clock time is meaningless — the real pickup is the time the guest typed. A
 * transfer therefore prints its first leg from {@link transferLegs} (the same legs the e-voucher and
 * the confirmation page show, so a departure-only trip is dated by its returnDate, not the slot), and
 * the date ALONE when no time was captured — never the noon placeholder. A hotel-to-hotel transfer
 * has no airport direction, so its pickup time arrives as `pickupTime`. Every other booking keeps the
 * occurrence date-time.
 */
export function formatServiceWhen(booking: {
  when: string | null | undefined;
  transfer?: TransferDetails | null;
  pickupTime?: string | null;
}): string {
  const tr = booking.transfer;
  if (tr) {
    const [leg] = transferLegs({
      direction: tr.direction,
      serviceDateIso: booking.when,
      arrivalTime: tr.arrivalTime,
      returnDate: tr.returnDate,
      returnTime: tr.returnTime,
    });
    if (leg) return `${leg.pickupYmd} ${leg.pickupTime} MUT`;
    return tr.direction === 'departure' && tr.returnDate
      ? tr.returnDate
      : formatMauritiusDate(booking.when);
  }
  if (booking.pickupTime) {
    const ymd = formatMauritiusDate(booking.when);
    return ymd ? `${ymd} ${booking.pickupTime} MUT` : '';
  }
  return formatMauritiusDateTime(booking.when);
}
