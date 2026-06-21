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
