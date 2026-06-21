import { describe, expect, it } from 'vitest';
import { formatMauritiusDate, formatMauritiusDateTime } from '@/lib/invoice/mauritius-time';

/**
 * Mauritius is a FIXED UTC+4 offset year-round (no DST). The invoice PDF + confirmation email
 * must print the trip's WALL-CLOCK time as it reads in Mauritius, not in UTC. Occurrences are
 * stored at noon Mauritius = 08:00 UTC, so a noon tour MUST render `12:00 MUT` — not `08:00 UTC`.
 *
 * The helper is edge-safe by construction: it shifts the parsed instant by +4h and reads the UTC
 * accessors, so it never depends on `Intl` timeZone ICU data being present on the Cloudflare edge.
 */
describe('formatMauritiusDateTime', () => {
  it('renders an 08:00:00Z instant (noon Mauritius) as `… 12:00 MUT`', () => {
    expect(formatMauritiusDateTime('2026-08-09T08:00:00Z')).toBe('2026-08-09 12:00 MUT');
  });

  it('rolls the date forward when the UTC instant is on the previous calendar day', () => {
    // 21:00Z + 4h = 01:00 the NEXT day in Mauritius.
    expect(formatMauritiusDateTime('2026-08-09T21:00:00Z')).toBe('2026-08-10 01:00 MUT');
  });

  it('returns the empty string for null / undefined', () => {
    expect(formatMauritiusDateTime(null)).toBe('');
    expect(formatMauritiusDateTime(undefined)).toBe('');
  });

  it('falls back to the raw string when the input is unparseable', () => {
    expect(formatMauritiusDateTime('not-a-date')).toBe('not-a-date');
  });
});

describe('formatMauritiusDate', () => {
  it('renders an 08:00:00Z instant as the same `YYYY-MM-DD` date (no time, no label)', () => {
    expect(formatMauritiusDate('2026-08-09T08:00:00Z')).toBe('2026-08-09');
  });

  it('rolls the date forward when +4h crosses midnight in Mauritius', () => {
    expect(formatMauritiusDate('2026-08-09T21:00:00Z')).toBe('2026-08-10');
  });

  it('returns the empty string for null / undefined', () => {
    expect(formatMauritiusDate(null)).toBe('');
    expect(formatMauritiusDate(undefined)).toBe('');
  });

  it('falls back to the raw string when the input is unparseable', () => {
    expect(formatMauritiusDate('not-a-date')).toBe('not-a-date');
  });
});
