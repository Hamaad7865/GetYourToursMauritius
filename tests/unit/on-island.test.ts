import { afterEach, describe, expect, it, vi } from 'vitest';
import { ON_ISLAND_KEY, readOnIsland, writeOnIsland } from '@/lib/recent/on-island';

/* The locality answer, kept for the rest of the visit so a second homepage view can put up the
 * on-island row's placeholders before paint. Unknown (never asked, or storage refused) must read as
 * null — not as "abroad" — so the caller can tell "no answer yet" from "no". */

function fakeSession(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    sessionStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
}

describe('on-island session flag', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is unknown until the locality has been asked', () => {
    vi.stubGlobal('window', fakeSession());
    expect(readOnIsland()).toBeNull();
  });

  it('round-trips yes and no', () => {
    const win = fakeSession();
    vi.stubGlobal('window', win);
    writeOnIsland(true);
    expect(win.store.get(ON_ISLAND_KEY)).toBe('1');
    expect(readOnIsland()).toBe(true);
    writeOnIsland(false);
    expect(readOnIsland()).toBe(false);
  });

  it('reads anything else, or storage that throws, as unknown', () => {
    vi.stubGlobal('window', fakeSession({ [ON_ISLAND_KEY]: 'yes' }));
    expect(readOnIsland()).toBeNull();
    vi.stubGlobal('window', {
      sessionStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
    });
    expect(readOnIsland()).toBeNull();
    expect(() => writeOnIsland(true)).not.toThrow();
  });
});
