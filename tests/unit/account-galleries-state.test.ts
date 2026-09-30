import { describe, expect, it } from 'vitest';
import {
  galleriesKey,
  galleriesState,
  settleGalleries,
  type SettledGalleries,
} from '@/lib/booking/account-galleries-state';
import type { GalleryCard } from '@/lib/booking/gallery-cards';

/**
 * What the account nav and the Galleries page show while the list loads, refreshes and fails.
 *
 * Supabase swaps the access token roughly hourly. The answer used to be remembered against the token,
 * so every refresh read as "a different request" — the Galleries tab vanished and the page fell back to
 * skeletons until the refetch landed. It is remembered against the CUSTOMER (and the retry count)
 * instead, and a refresh that fails keeps the last good answer rather than blanking the tab.
 */
const CARD: GalleryCard = {
  ref: 'BMT2ABCD',
  packageTitle: 'Couples shoot',
  shootDate: '2026-10-10T06:00:00.000Z',
  photoCount: 24,
  videoCount: 0,
  access: 'open',
  coverUrl: null,
  balanceDueMinor: 0,
};
const settled = (key: string, cards: GalleryCard[] | null): SettledGalleries => ({ key, cards });

describe('galleriesKey', () => {
  it('has no key while signed out', () => {
    expect(galleriesKey(null, 0)).toBeNull();
  });

  it('is per customer and per retry — and takes no token, so a token refresh cannot change it', () => {
    expect(galleriesKey('user-1', 0)).toBe(galleriesKey('user-1', 0));
    expect(galleriesKey('user-1', 0)).not.toBe(galleriesKey('user-2', 0));
    expect(galleriesKey('user-1', 0)).not.toBe(galleriesKey('user-1', 1));
  });
});

describe('galleriesState', () => {
  const key = galleriesKey('user-1', 0);

  it('is loading until there is an answer for THIS customer and attempt', () => {
    expect(galleriesState(null, key)).toEqual({ status: 'loading' });
    expect(galleriesState(settled('0:user-1', [CARD]), null)).toEqual({ status: 'loading' });
    // Another customer's answer (sign-out → sign-in) never shows, not even for a moment.
    expect(galleriesState(settled('0:user-2', [CARD]), key)).toEqual({ status: 'loading' });
    // A retry starts from loading again.
    expect(galleriesState(settled('0:user-1', null), galleriesKey('user-1', 1))).toEqual({
      status: 'loading',
    });
  });

  it('is ready with the cards, an empty list being an answer too', () => {
    expect(galleriesState(settled('0:user-1', [CARD]), key)).toEqual({
      status: 'ready',
      cards: [CARD],
    });
    expect(galleriesState(settled('0:user-1', []), key)).toEqual({ status: 'ready', cards: [] });
  });

  it('is an error when the fetch came back null', () => {
    expect(galleriesState(settled('0:user-1', null), key)).toEqual({ status: 'error' });
  });

  it('stays ready through a token refresh — the tab must not blink', () => {
    // The refresh gives the hook a new access token and refetches, but the key (customer + attempt)
    // is unchanged, so the answer already on screen still matches while the refetch is in flight.
    const before = galleriesKey('user-1', 0);
    const afterTokenRefresh = galleriesKey('user-1', 0);
    expect(galleriesState(settled('0:user-1', [CARD]), afterTokenRefresh)).toEqual(
      galleriesState(settled('0:user-1', [CARD]), before),
    );
    expect(galleriesState(settled('0:user-1', [CARD]), afterTokenRefresh).status).toBe('ready');
  });
});

describe('settleGalleries', () => {
  it('stores a fresh answer for the key', () => {
    expect(settleGalleries(null, '0:user-1', [CARD])).toEqual(settled('0:user-1', [CARD]));
    expect(settleGalleries(settled('0:user-1', [CARD]), '0:user-1', [])).toEqual(
      settled('0:user-1', []),
    );
  });

  it('keeps the last good answer when a background refresh of the SAME key fails', () => {
    const good = settled('0:user-1', [CARD]);
    expect(settleGalleries(good, '0:user-1', null)).toBe(good);
  });

  it('reports an error when the first load fails', () => {
    expect(settleGalleries(null, '0:user-1', null)).toEqual(settled('0:user-1', null));
  });

  it('reports an error when a RETRY fails, even though an earlier attempt had succeeded', () => {
    expect(settleGalleries(settled('0:user-1', [CARD]), '1:user-1', null)).toEqual(
      settled('1:user-1', null),
    );
  });

  it('never carries one customer’s answer over to another when a load fails', () => {
    expect(settleGalleries(settled('0:user-1', [CARD]), '0:user-2', null)).toEqual(
      settled('0:user-2', null),
    );
  });

  it('a failed refresh after an earlier failure stays an error', () => {
    expect(settleGalleries(settled('0:user-1', null), '0:user-1', null)).toEqual(
      settled('0:user-1', null),
    );
  });
});
