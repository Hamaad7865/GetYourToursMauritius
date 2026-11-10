import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchGooglePlaces } from '@/lib/maps/google-places';
import { clearPlacesCache } from '@/lib/maps/places-cache';

/** Every Text Search page is a billed request, so the pick-up box (which shows 6 results) must
 *  ask for ONE page, not three. */
describe('searchGooglePlaces page budget', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    clearPlacesCache();
    fetchMock.mockReset();
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ places: [], nextPageToken: 'more' }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('makes exactly one billed request when maxPages is 1', async () => {
    await searchGooglePlaces({ query: 'grand baie', maxPages: 1 }, 'k');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('still paginates up to 3 by default for the Add-places drawer', async () => {
    await searchGooglePlaces({ query: 'waterfall' }, 'k');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
