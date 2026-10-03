import { describe, expect, it } from 'vitest';
import { galleryItemsKey, galleryViewerItems, type GalleryPhoto } from '@/lib/booking/gallery-view';

/**
 * What the customers' gallery hands the full-screen viewer. The viewer is the library's, and the library resets
 * itself to the photo it was opened on whenever it is given a NEW list of slides — so the page's habit of building
 * a fresh array on every favourite toggle must not reach it as a new list. `galleryItemsKey` is what tells the two
 * apart: the same files give the same key, whatever array they arrive in.
 */
const photo = (id: string, url: string, position = 0): GalleryPhoto => ({ id, url, position });
const A = photo(
  'a',
  'https://x.supabase.co/storage/v1/object/public/activity-images/g/IMG_0001.jpg',
  0,
);
const B = photo(
  'b',
  'https://x.supabase.co/storage/v1/object/public/activity-images/g/IMG_0002.jpg',
  1,
);
const FILM = photo(
  'c',
  'https://x.supabase.co/storage/v1/object/public/activity-images/g/clip.mp4',
  2,
);

describe('galleryViewerItems', () => {
  it('turns each file into a viewer item, telling a film from a photo by the file', () => {
    const items = galleryViewerItems([A, FILM]);
    expect(items).toEqual([
      { src: A.url, alt: '', video: false },
      { src: FILM.url, alt: '', video: true },
    ]);
  });

  it('keeps the order and the count, and is empty for none', () => {
    expect(galleryViewerItems([B, A, FILM]).map((i) => i.src)).toEqual([B.url, A.url, FILM.url]);
    expect(galleryViewerItems([])).toEqual([]);
  });

  it('never marks a photo as a video, and sees .mov and .webm as films', () => {
    const mov = photo('m', 'https://x/y/a.mov');
    const webm = photo('w', 'https://x/y/a.webm');
    expect(galleryViewerItems([mov, webm]).map((i) => i.video)).toEqual([true, true]);
    expect(galleryViewerItems([photo('p', 'https://x/y/a.jpeg')])[0]!.video).toBe(false);
  });
});

describe('galleryItemsKey', () => {
  it('is the same for the same files in a new array — a favourite toggle must not look like a new gallery', () => {
    expect(galleryItemsKey([A, B, FILM])).toBe(galleryItemsKey([...[A, B, FILM]]));
    expect(galleryItemsKey([A, B])).toBe(galleryItemsKey([{ ...A }, { ...B }]));
  });

  it('changes when a file is added, removed, replaced or moved', () => {
    const base = galleryItemsKey([A, B, FILM]);
    expect(galleryItemsKey([A, B])).not.toBe(base);
    expect(galleryItemsKey([A, B, FILM, photo('d', 'https://x/y/d.jpg')])).not.toBe(base);
    expect(galleryItemsKey([B, A, FILM])).not.toBe(base);
    expect(galleryItemsKey([A, B, { ...FILM, url: 'https://x/y/other.mp4' }])).not.toBe(base);
  });

  it('cannot be fooled by ids and urls that run together', () => {
    const one = galleryItemsKey([photo('ab', 'c'), photo('d', 'e')]);
    const two = galleryItemsKey([photo('a', 'bc'), photo('d', 'e')]);
    expect(one).not.toBe(two);
  });

  it('is empty for no files', () => {
    expect(galleryItemsKey([])).toBe('');
  });
});
