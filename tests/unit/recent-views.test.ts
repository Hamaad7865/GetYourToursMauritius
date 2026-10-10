import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RECENT_VIEWS_EVENT,
  RECENT_VIEWS_KEY,
  clearRecentViews,
  readRecentViews,
  recordRecentView,
} from '@/lib/recent/views';

/**
 * The store behind the homepage's "Continue planning your trip" rail. It lives in the visitor's own
 * browser, so it has to survive whatever is already in there: an older build's value, a value another
 * script wrote, or storage that throws (Safari private mode, a full quota).
 *
 * This suite runs in `node`, so `window` is a minimal stand-in: just the storage and event surface
 * the module touches.
 */

function fakeWindow(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const events: string[] = [];
  return {
    events,
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

describe('recent views', () => {
  let win: ReturnType<typeof fakeWindow>;

  beforeEach(() => {
    win = fakeWindow();
    vi.stubGlobal('window', win);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is empty before anything has been viewed', () => {
    expect(readRecentViews()).toEqual([]);
  });

  it('keeps the most recent view first', () => {
    recordRecentView('north-tour');
    recordRecentView('hiking-le-morne');
    expect(readRecentViews()).toEqual(['hiking-le-morne', 'north-tour']);
  });

  it('moves a re-viewed tour to the front instead of listing it twice', () => {
    recordRecentView('north-tour');
    recordRecentView('hiking-le-morne');
    recordRecentView('north-tour');
    expect(readRecentViews()).toEqual(['north-tour', 'hiking-le-morne']);
  });

  it('caps the list at twelve, dropping the oldest', () => {
    for (let i = 1; i <= 15; i += 1) recordRecentView(`tour-${i}`);
    const views = readRecentViews();
    expect(views).toHaveLength(12);
    expect(views[0]).toBe('tour-15');
    expect(views).not.toContain('tour-3');
  });

  it('announces every change, so an open homepage updates without a reload', () => {
    recordRecentView('north-tour');
    clearRecentViews();
    expect(win.events).toEqual([RECENT_VIEWS_EVENT, RECENT_VIEWS_EVENT]);
  });

  it('clears the list', () => {
    recordRecentView('north-tour');
    clearRecentViews();
    expect(readRecentViews()).toEqual([]);
  });

  it('reads a corrupt or foreign value as empty rather than throwing', () => {
    vi.stubGlobal('window', fakeWindow({ [RECENT_VIEWS_KEY]: '{not json' }));
    expect(readRecentViews()).toEqual([]);
    vi.stubGlobal('window', fakeWindow({ [RECENT_VIEWS_KEY]: '{"a":1}' }));
    expect(readRecentViews()).toEqual([]);
    vi.stubGlobal('window', fakeWindow({ [RECENT_VIEWS_KEY]: '["ok", 7, null]' }));
    expect(readRecentViews()).toEqual(['ok']);
  });

  it('does nothing, quietly, when storage refuses the write', () => {
    win.localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(() => recordRecentView('north-tour')).not.toThrow();
    expect(readRecentViews()).toEqual([]);
  });

  it('is inert on the server, where there is no window', () => {
    vi.unstubAllGlobals();
    expect(readRecentViews()).toEqual([]);
    expect(() => recordRecentView('north-tour')).not.toThrow();
    expect(() => clearRecentViews()).not.toThrow();
  });
});
