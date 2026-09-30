import { describe, expect, it } from 'vitest';
import {
  isConfirmedStatus,
  nextDelayMs,
  shouldKeepPolling,
  shouldKeepPollingGallery,
  CONFIRM_POLL_MAX_MS,
} from '@/lib/checkout/confirm-poll';

describe('shouldKeepPolling', () => {
  it('keeps polling while payment_pending and within the window', () => {
    expect(shouldKeepPolling({ status: 'payment_pending', elapsedMs: 0, maxMs: 90_000 })).toBe(
      true,
    );
    expect(shouldKeepPolling({ status: 'payment_pending', elapsedMs: 30_000, maxMs: 90_000 })).toBe(
      true,
    );
    // Right at the edge but not past it — still polling.
    expect(shouldKeepPolling({ status: 'payment_pending', elapsedMs: 89_999, maxMs: 90_000 })).toBe(
      true,
    );
  });

  it('stops polling once the status is confirmed (or otherwise terminal)', () => {
    expect(shouldKeepPolling({ status: 'confirmed', elapsedMs: 0, maxMs: 90_000 })).toBe(false);
    expect(shouldKeepPolling({ status: 'completed', elapsedMs: 0, maxMs: 90_000 })).toBe(false);
    expect(shouldKeepPolling({ status: 'cancelled', elapsedMs: 0, maxMs: 90_000 })).toBe(false);
    expect(shouldKeepPolling({ status: 'refunded', elapsedMs: 0, maxMs: 90_000 })).toBe(false);
  });

  it('stops polling once the window has elapsed, even if still pending', () => {
    expect(shouldKeepPolling({ status: 'payment_pending', elapsedMs: 90_000, maxMs: 90_000 })).toBe(
      false,
    );
    expect(
      shouldKeepPolling({ status: 'payment_pending', elapsedMs: 120_000, maxMs: 90_000 }),
    ).toBe(false);
  });
});

describe('isConfirmedStatus', () => {
  it('treats confirmed and completed as confirmed (paid) terminal states', () => {
    expect(isConfirmedStatus('confirmed')).toBe(true);
    expect(isConfirmedStatus('completed')).toBe(true);
  });
  it('does not treat pending or failed states as confirmed', () => {
    expect(isConfirmedStatus('payment_pending')).toBe(false);
    expect(isConfirmedStatus('cancelled')).toBe(false);
    expect(isConfirmedStatus('refunded')).toBe(false);
    expect(isConfirmedStatus('')).toBe(false);
  });
});

describe('nextDelayMs', () => {
  it('backs off as the attempt index increases', () => {
    expect(nextDelayMs(0)).toBeLessThan(nextDelayMs(1));
    expect(nextDelayMs(1)).toBeLessThan(nextDelayMs(2));
  });

  it('starts at a short delay (~1.5s) and caps so it never grows unbounded', () => {
    expect(nextDelayMs(0)).toBe(1500);
    const capped = nextDelayMs(50);
    expect(capped).toBeLessThanOrEqual(6000);
    // Once capped, further attempts do not increase the delay.
    expect(nextDelayMs(100)).toBe(capped);
  });

  it('never returns a non-positive delay', () => {
    for (let i = 0; i < 10; i++) {
      expect(nextDelayMs(i)).toBeGreaterThan(0);
    }
  });
});

describe('CONFIRM_POLL_MAX_MS', () => {
  it('is a sane confirmation window (60-90s)', () => {
    expect(CONFIRM_POLL_MAX_MS).toBeGreaterThanOrEqual(60_000);
    expect(CONFIRM_POLL_MAX_MS).toBeLessThanOrEqual(90_000);
  });
});

describe('shouldKeepPollingGallery', () => {
  const base = { locked: true, justPaid: true, elapsedMs: 0, maxMs: 90_000 };

  it('keeps looking while the gallery is locked, right after a payment, inside the window', () => {
    expect(shouldKeepPollingGallery(base)).toBe(true);
    expect(shouldKeepPollingGallery({ ...base, elapsedMs: 89_999 })).toBe(true);
  });

  it('stops once the gallery has opened', () => {
    expect(shouldKeepPollingGallery({ ...base, locked: false })).toBe(false);
  });

  it('never polls a guest who did not just pay — a locked gallery is only a balance still owed', () => {
    expect(shouldKeepPollingGallery({ ...base, justPaid: false })).toBe(false);
  });

  it('gives up when the confirmation window elapses', () => {
    expect(shouldKeepPollingGallery({ ...base, elapsedMs: 90_000 })).toBe(false);
    expect(shouldKeepPollingGallery({ ...base, elapsedMs: 300_000 })).toBe(false);
  });
});
