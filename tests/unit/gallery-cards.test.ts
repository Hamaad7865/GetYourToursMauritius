import { describe, expect, it } from 'vitest';
import {
  buildGalleryCard,
  parseAccountGalleriesResponse,
  type GalleryCard,
} from '@/lib/booking/gallery-cards';

/**
 * The account "Galleries" list. Two things matter and both are pinned here:
 *
 *  1. The photo files sit in a PUBLIC bucket, so a URL handed to the browser is a bearer credential.
 *     A LOCKED card (delivered, balance unpaid) must therefore serialise with no gallery file URL at
 *     all — it shows the package's public catalogue cover instead.
 *  2. The browser must read the route's `{ ok, data }` envelope. The booking gallery once shipped
 *     reading `.photos` off the raw body and never rendered, so the parser is tested against the exact
 *     envelope shape and against the bare shape it must refuse.
 */
const DELIVERED = '2026-10-14T09:00:00.000Z';
const PHOTO_1 = 'https://cdn.example/gallery-bmt/1700000000000-abc123.jpg';
const PHOTO_2 = 'https://cdn.example/gallery-bmt/1700000000001-def456.jpg';
const VIDEO = 'https://cdn.example/gallery-bmt/1700000000002-ghi789.mp4';
const COVER = 'https://cdn.example/activities/couples-shoot/cover.jpg';

const BASE = {
  ref: 'BMT2ABCD',
  packageTitle: 'Couples shoot',
  shootDate: '2026-10-10T06:00:00.000Z',
  photoUrls: [PHOTO_1, PHOTO_2, VIDEO],
  packageCover: COVER,
  readyAt: DELIVERED,
  balanceDueMinor: 0,
  status: 'confirmed',
};

describe('buildGalleryCard', () => {
  it('never lists a gallery the studio has not confirmed complete', () => {
    expect(buildGalleryCard({ ...BASE, readyAt: null })).toBeNull();
    expect(buildGalleryCard({ ...BASE, readyAt: null, balanceDueMinor: 500 })).toBeNull();
  });

  it('never lists a booking that is not live', () => {
    for (const status of [
      'payment_pending',
      'cancelled',
      'refund_pending',
      'refunded',
      'expired',
    ]) {
      expect(buildGalleryCard({ ...BASE, status })).toBeNull();
    }
  });

  it('OPEN: counts photos and videos apart and uses the first photo as the cover', () => {
    const card = buildGalleryCard(BASE);
    expect(card).toEqual({
      ref: 'BMT2ABCD',
      packageTitle: 'Couples shoot',
      shootDate: '2026-10-10T06:00:00.000Z',
      photoCount: 2,
      videoCount: 1,
      access: 'open',
      coverUrl: PHOTO_1,
      balanceDueMinor: 0,
    });
  });

  it('OPEN: the cover is the first PHOTO, never a video an <img> cannot draw', () => {
    expect(buildGalleryCard({ ...BASE, photoUrls: [VIDEO, PHOTO_2, PHOTO_1] })?.coverUrl).toBe(
      PHOTO_2,
    );
  });

  it('OPEN with nothing but videos falls back to the package cover', () => {
    expect(buildGalleryCard({ ...BASE, photoUrls: [VIDEO] })?.coverUrl).toBe(COVER);
    expect(
      buildGalleryCard({ ...BASE, photoUrls: [VIDEO], packageCover: null })?.coverUrl,
    ).toBeNull();
  });

  it('LOCKED: carries the balance and the public package cover, and NO gallery file URL', () => {
    const card = buildGalleryCard({ ...BASE, balanceDueMinor: 32500 });
    expect(card).toMatchObject({
      access: 'locked',
      balanceDueMinor: 32500,
      coverUrl: COVER,
      // Counts stay truthful so the teaser can say what is waiting.
      photoCount: 2,
      videoCount: 1,
    });
    const body = JSON.stringify(card);
    expect(body).not.toContain('gallery-bmt');
    expect(body).not.toContain('.mp4');
    expect(body).not.toContain(PHOTO_1);
  });

  it('LOCKED with no catalogue cover shows no image rather than a gallery photo', () => {
    const card = buildGalleryCard({ ...BASE, balanceDueMinor: 100, packageCover: null });
    expect(card?.coverUrl).toBeNull();
    expect(JSON.stringify(card)).not.toContain('gallery-bmt');
  });
});

const GOOD: GalleryCard = {
  ref: 'BMT2ABCD',
  packageTitle: 'Couples shoot',
  shootDate: '2026-10-10T06:00:00.000Z',
  photoCount: 24,
  videoCount: 2,
  access: 'open',
  coverUrl: PHOTO_1,
  balanceDueMinor: 0,
};

describe('parseAccountGalleriesResponse', () => {
  it('reads the { ok, data } envelope the route sends, end to end with buildGalleryCard', () => {
    const card = buildGalleryCard({ ...BASE, balanceDueMinor: 100 });
    const wire = JSON.parse(JSON.stringify({ ok: true, data: { galleries: [card] } }));
    expect(parseAccountGalleriesResponse(wire)).toEqual([card]);
  });

  it('refuses the bare body — reading `.galleries` off the raw JSON is the bug this guards', () => {
    expect(parseAccountGalleriesResponse({ galleries: [GOOD] })).toBeNull();
  });

  it('treats an empty list as an answer (no galleries), not as a failure', () => {
    expect(parseAccountGalleriesResponse({ ok: true, data: { galleries: [] } })).toEqual([]);
  });

  it('returns null for an error envelope or anything that is not an object', () => {
    expect(
      parseAccountGalleriesResponse({ ok: false, error: { code: 'unauthorized' } }),
    ).toBeNull();
    expect(parseAccountGalleriesResponse({ ok: true, data: {} })).toBeNull();
    expect(parseAccountGalleriesResponse({ ok: true, data: { galleries: 'nope' } })).toBeNull();
    expect(parseAccountGalleriesResponse(null)).toBeNull();
    expect(parseAccountGalleriesResponse('<html>')).toBeNull();
  });

  it('drops malformed cards but keeps the good ones', () => {
    const wire = {
      ok: true,
      data: {
        galleries: [
          GOOD,
          { ...GOOD, ref: 42 },
          { ...GOOD, access: 'hidden' },
          { ...GOOD, photoCount: 'many' },
          null,
          { ...GOOD, ref: 'BMT9ZZZZ', access: 'locked', coverUrl: null, shootDate: null },
        ],
      },
    };
    const out = parseAccountGalleriesResponse(wire);
    expect(out?.map((c) => c.ref)).toEqual(['BMT2ABCD', 'BMT9ZZZZ']);
  });
});
