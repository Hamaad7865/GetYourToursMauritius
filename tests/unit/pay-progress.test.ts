import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SESSION_COMPLETE_PERCENT,
  clearPayHandoff,
  percentFor,
  savePayHandoff,
  stageSpec,
  readPayHandoff,
} from '@/lib/checkout/pay-progress';

/**
 * The progress ring shown between "Pay" and the card form is only defensible if the number it shows
 * is honest. These pin the three properties that make it so: it never overstates a stage, it never
 * moves backwards, and it survives the full-document navigation to the pay page without either
 * restarting at zero or resuming from a stale attempt.
 */

/** Minimal sessionStorage on a fake `window` — the suite runs in the node environment. */
function stubStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('window', {
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('percentFor — never overstates progress', () => {
  const spec = stageSpec('session', false);

  it('starts at the stage floor, not at zero', () => {
    expect(percentFor(spec, 0)).toBeCloseTo(spec.from, 5);
  });

  it('never reaches the ceiling, however long the provider takes', () => {
    // The pathological case this exists for: a 10-second Peach call. It must keep moving and must
    // NOT claim the stage is done — including at absurd elapsed times, where the exponential
    // otherwise rounds onto the ceiling in floating point.
    for (const elapsed of [1_000, 5_000, 10_000, 60_000, 600_000, 6_000_000]) {
      expect(percentFor(spec, elapsed)).toBeLessThan(spec.to);
    }
  });

  it('never shows 100% while the card form is still loading', () => {
    // 100 belongs exclusively to a card form that is actually on screen; the ring is driven to it by
    // the caller that can see the iframe, never by elapsed time.
    for (const resumed of [true, false]) {
      for (const elapsed of [10_000, 600_000, 6_000_000]) {
        expect(percentFor(stageSpec('form', resumed), elapsed)).toBeLessThan(100);
      }
    }
  });

  it('is monotonic — more elapsed time never shows a smaller number', () => {
    let previous = -1;
    for (let elapsed = 0; elapsed <= 20_000; elapsed += 250) {
      const value = percentFor(spec, elapsed);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('respects the floor, so a stage change can never rewind the ring', () => {
    // Entering `form` at 65% must not snap back to that stage's eased start.
    expect(percentFor(stageSpec('form', true), 0, SESSION_COMPLETE_PERCENT)).toBeGreaterThanOrEqual(
      SESSION_COMPLETE_PERCENT,
    );
  });
});

describe('stageSpec — a direct arrival owns the whole bar', () => {
  it('resumes mid-bar when handed off from checkout', () => {
    expect(stageSpec('form', true).from).toBe(SESSION_COMPLETE_PERCENT);
  });

  it('starts from zero for a customer arriving straight at the pay page', () => {
    // Someone following the emailed "complete payment" link never ran the earlier stages, so showing
    // them 65% on arrival would be a fiction.
    expect(stageSpec('form', false).from).toBe(0);
  });
});

describe('the hand-off across the navigation', () => {
  it('round-trips the position, and survives a repeated read', () => {
    stubStorage();
    savePayHandoff(SESSION_COMPLETE_PERCENT, 1_000);

    expect(readPayHandoff(1_500)?.percent).toBe(SESSION_COMPLETE_PERCENT);
    // Non-destructive by design: React StrictMode mounts, unmounts and remounts in development, and
    // a read-once hand-off would be swallowed by the throwaway first mount. Explicitly cleared by
    // the reader once the form is up, and by every new attempt before it starts.
    expect(readPayHandoff(1_500)?.percent).toBe(SESSION_COMPLETE_PERCENT);

    clearPayHandoff();
    expect(readPayHandoff(1_500)).toBeNull();
  });

  it('ignores a stale hand-off', () => {
    stubStorage();
    savePayHandoff(65, 1_000);
    // Customer wandered off mid-payment and came back much later: this attempt is its own.
    expect(readPayHandoff(1_000 + 120_000)).toBeNull();
  });

  it('ignores a hand-off stamped in the future (clock skew / tampering)', () => {
    stubStorage();
    savePayHandoff(65, 10_000);
    expect(readPayHandoff(5_000)).toBeNull();
  });

  it('ignores malformed storage instead of throwing', () => {
    const store = stubStorage();
    store.set('gytm:pay-progress', 'not json');
    expect(readPayHandoff(1_000)).toBeNull();

    store.set('gytm:pay-progress', JSON.stringify({ percent: 'lots', at: 1 }));
    expect(readPayHandoff(1_000)).toBeNull();
  });

  it('clamps a wild percentage into range', () => {
    const store = stubStorage();
    store.set('gytm:pay-progress', JSON.stringify({ percent: 900, at: 1_000 }));
    expect(readPayHandoff(1_200)?.percent).toBe(99); // never hands the pay page a finished bar
  });

  it('survives storage being unavailable (private mode)', () => {
    vi.stubGlobal('window', {
      get sessionStorage(): never {
        throw new Error('blocked');
      },
    });
    expect(() => savePayHandoff(65, 1_000)).not.toThrow();
    expect(readPayHandoff(1_000)).toBeNull();
    expect(() => clearPayHandoff()).not.toThrow();
  });
});
