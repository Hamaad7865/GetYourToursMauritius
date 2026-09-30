import { describe, expect, it } from 'vitest';
import { buildGalleryResponse, galleryAccess } from '@/lib/booking/gallery-access';

/**
 * Who may see a booking's gallery photos. The files sit in a PUBLIC bucket, so a URL handed to the
 * browser is a bearer credential — the "lock" on an unpaid gallery is only real if the API never
 * sends the URLs at all. These tests pin that: a locked or undelivered gallery must serialise with
 * NO photo URL anywhere in the body.
 */
const DELIVERED = '2026-10-14T09:00:00.000Z';

describe('galleryAccess', () => {
  it('is hidden until the studio has confirmed the gallery complete', () => {
    expect(galleryAccess({ readyAt: null, balanceDueMinor: 0, status: 'confirmed' })).toBe(
      'hidden',
    );
    expect(galleryAccess({ readyAt: undefined, balanceDueMinor: 0, status: 'confirmed' })).toBe(
      'hidden',
    );
    // Even paid in full: uploading photos alone never reaches the guest.
    expect(galleryAccess({ readyAt: '', balanceDueMinor: 0, status: 'completed' })).toBe('hidden');
  });

  it('is locked while the balance is owed, once delivered', () => {
    expect(galleryAccess({ readyAt: DELIVERED, balanceDueMinor: 1, status: 'confirmed' })).toBe(
      'locked',
    );
    expect(galleryAccess({ readyAt: DELIVERED, balanceDueMinor: 7500, status: 'confirmed' })).toBe(
      'locked',
    );
  });

  it('is open once delivered and paid in full', () => {
    expect(galleryAccess({ readyAt: DELIVERED, balanceDueMinor: 0, status: 'confirmed' })).toBe(
      'open',
    );
    expect(galleryAccess({ readyAt: DELIVERED, balanceDueMinor: 0, status: 'completed' })).toBe(
      'open',
    );
  });

  it('is hidden on a booking that is not live, whatever the balance says', () => {
    for (const status of [
      'payment_pending',
      'cancelled',
      'refund_pending',
      'refunded',
      'expired',
      'failed',
    ]) {
      expect(galleryAccess({ readyAt: DELIVERED, balanceDueMinor: 0, status })).toBe('hidden');
      expect(galleryAccess({ readyAt: DELIVERED, balanceDueMinor: 500, status })).toBe('hidden');
    }
  });
});

const PHOTOS = [
  { id: 'p1', url: 'https://cdn.example/gallery-bmt/1700000000000-abc123.jpg', position: 1 },
  { id: 'p2', url: 'https://cdn.example/gallery-bmt/1700000000001-def456.jpg', position: 2 },
  { id: 'p3', url: 'https://cdn.example/gallery-bmt/1700000000002-ghi789.mp4', position: 3 },
];
const META = {
  balanceDueMinor: 0,
  packageTitle: 'Couples shoot',
  shootDate: '2026-10-10T06:00:00.000Z',
  location: 'Belle Mare Plage',
};

describe('buildGalleryResponse', () => {
  it('serves the photos, with truthful counts, when the gallery is open', () => {
    const res = buildGalleryResponse({ access: 'open', photos: PHOTOS, ...META });
    expect(res.locked).toBe(false);
    expect(res.photos.map((p) => p.id)).toEqual(['p1', 'p2', 'p3']);
    expect(res.meta).toEqual({
      packageTitle: 'Couples shoot',
      shootDate: '2026-10-10T06:00:00.000Z',
      location: 'Belle Mare Plage',
      photoCount: 3,
      videoCount: 1,
    });
  });

  it('LOCKED: sends no photo URL at all, only the counts the teaser needs', () => {
    const res = buildGalleryResponse({
      access: 'locked',
      photos: PHOTOS,
      ...META,
      balanceDueMinor: 32500,
    });
    expect(res.locked).toBe(true);
    expect(res.photos).toEqual([]);
    expect(res.balanceDueMinor).toBe(32500);
    expect(res.meta.photoCount).toBe(3);
    expect(res.meta.videoCount).toBe(1);
    // The whole serialised body — not just `photos` — must be free of any file URL.
    const body = JSON.stringify(res);
    expect(body).not.toContain('cdn.example');
    expect(body).not.toContain('.jpg');
    expect(body).not.toContain('.mp4');
  });

  it('HIDDEN: reveals nothing — not the URLs, not even that photos exist', () => {
    const res = buildGalleryResponse({ access: 'hidden', photos: PHOTOS, ...META });
    expect(res.locked).toBe(false);
    expect(res.photos).toEqual([]);
    expect(res.meta).toEqual({
      packageTitle: null,
      shootDate: null,
      location: null,
      photoCount: 0,
      videoCount: 0,
    });
    expect(JSON.stringify(res)).not.toContain('cdn.example');
  });

  it('does not alias the caller’s array when open', () => {
    const res = buildGalleryResponse({ access: 'open', photos: PHOTOS, ...META });
    expect(res.photos).not.toBe(PHOTOS);
    expect(res.photos).toEqual(PHOTOS);
  });
});
