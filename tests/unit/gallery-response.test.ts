import { describe, expect, it } from 'vitest';
import { jsonOk } from '@/lib/http/envelope';
import { buildGalleryResponse } from '@/lib/booking/gallery-access';
import { parseGalleryResponse } from '@/lib/booking/gallery-view';

/**
 * The contract between GET /api/v1/bookings/:ref/gallery and the booking page. Every /api/v1 route
 * answers in a `{ ok, data }` envelope (jsonOk); the first cut of the redesigned page read `.photos`
 * off the raw body, so it saw NOTHING — the gallery never rendered, paid or not — and no test could
 * tell, because component fetch code is untested. These tests run the route's real response body
 * (the same builder, the same jsonOk) through the page's parser, so the two cannot drift apart again.
 */
const PHOTOS = [
  { id: 'p1', url: 'https://cdn.example/g/1.jpg', position: 1 },
  { id: 'p2', url: 'https://cdn.example/g/2.mp4', position: 2 },
];
const BASE = {
  photos: PHOTOS,
  balanceDueMinor: 0,
  packageTitle: 'Couples shoot',
  shootDate: '2026-10-10T06:00:00.000Z',
  location: 'Belle Mare Plage',
};

/** What the browser actually receives: the route's Response, read back as JSON. */
async function overTheWire(res: ReturnType<typeof buildGalleryResponse>): Promise<unknown> {
  return jsonOk(res).json();
}

describe('parseGalleryResponse', () => {
  it('reads an OPEN gallery out of the route’s envelope', async () => {
    const parsed = parseGalleryResponse(
      await overTheWire(buildGalleryResponse({ access: 'open', ...BASE })),
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.locked).toBe(false);
    expect(parsed!.photos).toEqual(PHOTOS);
    expect(parsed!.meta).toMatchObject({
      packageTitle: 'Couples shoot',
      photoCount: 2,
      videoCount: 1,
    });
  });

  it('reads a LOCKED gallery: no photos, but the teaser data survives the trip', async () => {
    const parsed = parseGalleryResponse(
      await overTheWire(
        buildGalleryResponse({ access: 'locked', ...BASE, balanceDueMinor: 32500 }),
      ),
    );
    expect(parsed!.locked).toBe(true);
    expect(parsed!.photos).toEqual([]);
    expect(parsed!.balanceDueMinor).toBe(32500);
    // The page decides "a gallery exists" from this count — the array is empty by design.
    expect(parsed!.meta?.photoCount).toBe(2);
  });

  it('reads a HIDDEN gallery as nothing to show', async () => {
    const parsed = parseGalleryResponse(
      await overTheWire(buildGalleryResponse({ access: 'hidden', ...BASE })),
    );
    expect(parsed!.locked).toBe(false);
    expect(parsed!.photos).toEqual([]);
    expect(parsed!.meta?.photoCount).toBe(0);
  });

  it('does NOT accept the bare payload — only the envelope the API really sends', () => {
    // This is the exact mistake: the un-wrapped body has `photos` at the top level.
    expect(parseGalleryResponse({ photos: PHOTOS, locked: false })).toBeNull();
  });

  it('returns null for an error envelope, a non-object and garbage', () => {
    expect(
      parseGalleryResponse({ ok: false, error: { code: 'not_found', message: 'x' } }),
    ).toBeNull();
    expect(parseGalleryResponse(null)).toBeNull();
    expect(parseGalleryResponse('nope')).toBeNull();
    expect(parseGalleryResponse({ ok: true })).toBeNull();
    expect(parseGalleryResponse({ ok: true, data: 'x' })).toBeNull();
  });

  it('drops photos without a usable URL instead of rendering broken tiles', () => {
    const parsed = parseGalleryResponse({
      ok: true,
      data: {
        photos: [
          { id: 'a', url: 'https://cdn.example/a.jpg', position: 1 },
          { id: 'b', url: '', position: 2 },
          { id: 'c', position: 3 },
          null,
          { id: 'd', url: 42, position: 4 },
        ],
      },
    });
    expect(parsed!.photos.map((p) => p.id)).toEqual(['a']);
  });

  it('tolerates a payload with no meta or balance', () => {
    const parsed = parseGalleryResponse({ ok: true, data: { photos: [] } });
    expect(parsed).toEqual({ photos: [], locked: false, balanceDueMinor: undefined, meta: null });
  });
});
