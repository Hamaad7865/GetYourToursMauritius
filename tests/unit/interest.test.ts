import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTEREST_EVENT,
  INTEREST_KEY,
  clearInterest,
  readInterest,
  recordInterest,
} from '@/lib/recent/interest';

/**
 * The guides a visitor read, each with the tours it recommends — what lets the homepage's first row
 * lead with "Picked from the guides you've read". It lives in the visitor's own browser, so it must
 * survive whatever is already in there. This suite runs in `node`; `window` is a minimal stand-in.
 */

function fakeWindow(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const events: string[] = [];
  return {
    events,
    store,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    },
    dispatchEvent: (e: Event) => {
      events.push(e.type);
      return true;
    },
  };
}

describe('guide interest', () => {
  let win: ReturnType<typeof fakeWindow>;

  beforeEach(() => {
    win = fakeWindow();
    vi.stubGlobal('window', win);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is empty before any guide has been read', () => {
    expect(readInterest()).toEqual([]);
  });

  it('keeps the latest guide first, each with its tours in page order', () => {
    recordInterest('post:mauritius-in-december', ['catamaran', 'dolphins']);
    recordInterest('attraction:ile-aux-cerfs', ['blue-cruise', 'catamaran']);
    expect(readInterest()).toEqual([
      { topic: 'attraction:ile-aux-cerfs', slugs: ['blue-cruise', 'catamaran'] },
      { topic: 'post:mauritius-in-december', slugs: ['catamaran', 'dolphins'] },
    ]);
  });

  it('moves a re-read guide to the front instead of listing it twice', () => {
    recordInterest('post:a', ['x']);
    recordInterest('post:b', ['y']);
    recordInterest('post:a', ['x', 'z']);
    expect(readInterest().map((i) => i.topic)).toEqual(['post:a', 'post:b']);
    expect(readInterest()[0]!.slugs).toEqual(['x', 'z']);
  });

  it('keeps five guides and six tours per guide', () => {
    for (let i = 0; i < 7; i++) {
      recordInterest(`post:${i}`, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
    }
    const kept = readInterest();
    expect(kept).toHaveLength(5);
    expect(kept[0]!.topic).toBe('post:6');
    expect(kept[0]!.slugs).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('lists a tour once per guide', () => {
    recordInterest('hub:/dolphin-swim-mauritius', ['a', 'a', 'b']);
    expect(readInterest()[0]!.slugs).toEqual(['a', 'b']);
  });

  it('records nothing for a guide with no tours, or no topic', () => {
    recordInterest('post:empty', []);
    recordInterest('', ['a']);
    expect(readInterest()).toEqual([]);
    expect(win.store.has(INTEREST_KEY)).toBe(false);
  });

  it('announces each change in this tab', () => {
    recordInterest('post:a', ['x']);
    clearInterest();
    expect(win.events).toEqual([INTEREST_EVENT, INTEREST_EVENT]);
  });

  it('clear empties it', () => {
    recordInterest('post:a', ['x']);
    clearInterest();
    expect(readInterest()).toEqual([]);
  });

  it('reads malformed storage as empty, and drops malformed entries', () => {
    win.store.set(INTEREST_KEY, '{not json');
    expect(readInterest()).toEqual([]);
    win.store.set(
      INTEREST_KEY,
      JSON.stringify([
        { topic: 1 },
        { topic: 'ok', slugs: ['a'] },
        'x',
        { topic: 'n', slugs: [2] },
      ]),
    );
    expect(readInterest()).toEqual([{ topic: 'ok', slugs: ['a'] }]);
  });

  it('survives storage that throws (private mode, full quota)', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
        removeItem: () => {
          throw new Error('denied');
        },
      },
      dispatchEvent: () => true,
    });
    expect(readInterest()).toEqual([]);
    expect(() => recordInterest('post:a', ['x'])).not.toThrow();
    expect(() => clearInterest()).not.toThrow();
  });
});
