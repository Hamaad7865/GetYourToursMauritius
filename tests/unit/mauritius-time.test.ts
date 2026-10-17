import { describe, expect, it } from 'vitest';
import {
  formatMauritiusDate,
  formatMauritiusDateTime,
  formatServiceWhen,
} from '@/lib/invoice/mauritius-time';

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

/**
 * The booking's "Date" line on the invoice + confirmation email. Every catalogue day-slot is
 * materialised at a placeholder NOON, so for a transfer the slot's clock time is meaningless — the
 * real pickup is the time the guest typed. BMTA0D8CBF245973 (landing 16:00) printed `12:00 MUT`.
 */
describe('formatServiceWhen', () => {
  const NOON_SLOT = '2026-10-07T08:00:00+00:00'; // 12:00 MUT — the materialised day-slot

  it('prints the arrival time for an arrival transfer, not the noon slot', () => {
    expect(
      formatServiceWhen({
        when: NOON_SLOT,
        transfer: { direction: 'arrival', flightNumber: 'HM-49', arrivalTime: '16:00' },
      }),
    ).toBe('2026-10-07 16:00 MUT');
  });

  it('prints the departure pickup DATE and time for a departure-only transfer', () => {
    // The slot sits on the widget's day (9 Oct); the guest is collected on 15 Oct.
    expect(
      formatServiceWhen({
        when: '2026-10-09T08:00:00+00:00',
        transfer: { direction: 'departure', returnDate: '2026-10-15', returnTime: '05:30' },
      }),
    ).toBe('2026-10-15 05:30 MUT');
  });

  it('prints the first (arrival) leg for a return transfer', () => {
    expect(
      formatServiceWhen({
        when: NOON_SLOT,
        transfer: {
          direction: 'return',
          arrivalTime: '09:30',
          returnDate: '2026-10-14',
          returnTime: '13:00',
        },
      }),
    ).toBe('2026-10-07 09:30 MUT');
  });

  it('prints the date alone — never the noon placeholder — for a transfer with no time captured', () => {
    expect(formatServiceWhen({ when: NOON_SLOT, transfer: { direction: 'arrival' } })).toBe(
      '2026-10-07',
    );
    expect(
      formatServiceWhen({
        when: '2026-10-09T08:00:00+00:00',
        transfer: { direction: 'departure', returnDate: '2026-10-15' },
      }),
    ).toBe('2026-10-15');
  });

  it('prints a hotel-to-hotel transfer’s pickup time', () => {
    expect(formatServiceWhen({ when: NOON_SLOT, transfer: null, pickupTime: '07:15' })).toBe(
      '2026-10-07 07:15 MUT',
    );
  });

  it('leaves every other booking on the occurrence date-time', () => {
    expect(formatServiceWhen({ when: NOON_SLOT })).toBe('2026-10-07 12:00 MUT');
    expect(formatServiceWhen({ when: '' })).toBe('');
  });
});
