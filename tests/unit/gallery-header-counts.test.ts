import { describe, expect, it } from 'vitest';
import { buildGalleryResponse } from '@/lib/booking/gallery-access';
import { buildGalleryCard } from '@/lib/booking/gallery-cards';
import { galleryHeaderCounts } from '@/lib/booking/gallery-view';

/**
 * "24 photos · 2 videos" appears twice for one shoot: on the account Galleries card and in the booking
 * page's gallery header. The gallery API's `meta.photoCount` is the number of ITEMS (photos and videos
 * together — the page also reads it as "does this gallery have anything?"), so showing it as the photo
 * count made the header read "3 photos · 1 videos" for 2 photos and a video, a figure the card
 * (photos only) contradicted. These tests tie the two surfaces to each other.
 */
const PHOTO_1 = 'https://cdn.example/gallery-bmt/1700000000000-abc123.jpg';
const PHOTO_2 = 'https://cdn.example/gallery-bmt/1700000000001-def456.jpg';
const VIDEO = 'https://cdn.example/gallery-bmt/1700000000002-ghi789.mp4';

const rows = (urls: string[]) => urls.map((url, i) => ({ id: `p${i}`, url, position: i }));

describe('galleryHeaderCounts', () => {
  it('counts photos WITHOUT the videos, from the API meta', () => {
    const { meta } = buildGalleryResponse({
      access: 'open',
      photos: rows([PHOTO_1, PHOTO_2, VIDEO]),
      balanceDueMinor: 0,
      packageTitle: 'Couples shoot',
      shootDate: null,
      location: null,
    });
    expect(meta.photoCount).toBe(3); // the API figure stays "items" — the locked state relies on it
    expect(galleryHeaderCounts(meta, { all: 3, videos: 1 })).toEqual({ photos: 2, videos: 1 });
  });

  it('agrees with the account Galleries card for the same shoot', () => {
    const urls = [PHOTO_1, VIDEO, PHOTO_2, VIDEO];
    const card = buildGalleryCard({
      ref: 'BMT2ABCD',
      packageTitle: 'Couples shoot',
      shootDate: null,
      photoUrls: urls,
      packageCover: null,
      readyAt: '2026-10-14T09:00:00.000Z',
      balanceDueMinor: 0,
      status: 'confirmed',
    });
    const { meta } = buildGalleryResponse({
      access: 'open',
      photos: rows(urls),
      balanceDueMinor: 0,
      packageTitle: null,
      shootDate: null,
      location: null,
    });
    expect(galleryHeaderCounts(meta, { all: 4, videos: 2 })).toEqual({
      photos: card?.photoCount,
      videos: card?.videoCount,
    });
  });

  it('uses the API meta even when the sent photos are fewer (a locked gallery sends none)', () => {
    expect(galleryHeaderCounts({ photoCount: 26, videoCount: 2 }, { all: 0, videos: 0 })).toEqual({
      photos: 24,
      videos: 2,
    });
  });

  it('falls back to counting what was actually sent when there is no meta', () => {
    expect(galleryHeaderCounts(null, { all: 5, videos: 2 })).toEqual({ photos: 3, videos: 2 });
    expect(galleryHeaderCounts(undefined, { all: 0, videos: 0 })).toEqual({ photos: 0, videos: 0 });
    expect(galleryHeaderCounts({}, { all: 4, videos: 1 })).toEqual({ photos: 3, videos: 1 });
  });

  it('never goes negative', () => {
    expect(galleryHeaderCounts({ photoCount: 1, videoCount: 3 }, { all: 0, videos: 0 })).toEqual({
      photos: 0,
      videos: 3,
    });
  });
});
