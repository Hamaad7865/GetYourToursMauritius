import { describe, expect, it } from 'vitest';
import { mediaKind, videoSource } from '@/lib/media';
import {
  PACKAGE_GRID_TILES,
  ensureImageLead,
  packageGalleryImages,
  sideTileClasses,
  validateLeadPhoto,
  validatePackageMedia,
} from '@/lib/catalogue/package-gallery';
import {
  PHOTOGRAPHY_ADD_ON_PRESETS,
  PHOTOGRAPHY_LOCATION_DEFAULTS,
  PHOTOGRAPHY_SHOOT_SLOTS,
} from '@/lib/catalogue/photography';
import {
  applyPackageInput,
  packageInputFromValues,
  photographyPackageValues,
  type PhotographyPackageInput,
} from '@/lib/admin/photography';

/**
 * The photoshoot package page used to be a fixed three-photo grid that filtered videos out, and the extra
 * photos could only be edited in the separate Tours editor. It is now lead + four tiles + "View all N"
 * (photos AND videos, uploaded files or YouTube / Vimeo links), edited in the Photography package form.
 * `images[0]` is the one position with a hard rule: cards, search and the social-share image all read it, so
 * it must always be a real photo — a video or a link there would be a broken picture everywhere.
 */
const PHOTO = (n: number) =>
  `https://x.supabase.co/storage/v1/object/public/activity-images/p/${n}.jpg`;
const MP4 = 'https://x.supabase.co/storage/v1/object/public/activity-images/p/film.mp4';
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const VIMEO = 'https://vimeo.com/76979871';

describe('mediaKind', () => {
  it('tells photos, video files, YouTube and Vimeo apart', () => {
    expect(mediaKind(PHOTO(1))).toBe('image');
    expect(mediaKind(MP4)).toBe('file');
    expect(mediaKind('https://cdn.test/a/b.WEBM')).toBe('file');
    expect(mediaKind(YT)).toBe('youtube');
    expect(mediaKind('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
    expect(mediaKind('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe('youtube');
    expect(mediaKind(VIMEO)).toBe('vimeo');
    expect(mediaKind('https://player.vimeo.com/video/76979871')).toBe('vimeo');
  });

  it('treats any other address as a photo — a URL pasted without a file extension is still a picture', () => {
    expect(mediaKind('https://images.unsplash.com/photo-123?w=1200')).toBe('image');
    expect(mediaKind('/photography/couple.jpg')).toBe('image');
    expect(mediaKind('')).toBe('image');
  });

  it('keeps the video-link parser the photography gallery already used', () => {
    expect(videoSource(YT)).toMatchObject({ kind: 'youtube', id: 'dQw4w9WgXcQ' });
    expect(videoSource(MP4)).toMatchObject({ kind: 'file' });
    expect(videoSource(PHOTO(1))).toBeNull();
  });
});

describe('ensureImageLead', () => {
  const item = (url: string) => ({ url, alt: '' });

  it('leaves a list that already starts with a photo exactly as it is', () => {
    const list = [item(PHOTO(1)), item(MP4), item(PHOTO(2))];
    expect(ensureImageLead(list)).toEqual(list);
  });

  it('promotes the first photo when a video or link would lead, keeping everything else in order', () => {
    expect(ensureImageLead([item(MP4), item(YT), item(PHOTO(1)), item(PHOTO(2))])).toEqual([
      item(PHOTO(1)),
      item(MP4),
      item(YT),
      item(PHOTO(2)),
    ]);
  });

  it('cannot invent a photo: a list of only videos comes back as it was', () => {
    const list = [item(MP4), item(VIMEO)];
    expect(ensureImageLead(list)).toEqual(list);
    expect(ensureImageLead([])).toEqual([]);
  });
});

describe('packageGalleryImages (what the package page shows)', () => {
  const img = (id: string, url: string) => ({ id, url, alt: null, position: 0 });

  it('puts the cover first and keeps the rest in the owner’s order', () => {
    const out = packageGalleryImages(
      [img('a', PHOTO(1)), img('b', PHOTO(2)), img('c', MP4)],
      PHOTO(2),
      'Beach shoot',
    );
    expect(out.map((i) => i.url)).toEqual([PHOTO(2), PHOTO(1), MP4]);
  });

  it('never shows the cover twice and drops empty rows', () => {
    const out = packageGalleryImages(
      [img('a', PHOTO(1)), img('b', ''), img('c', PHOTO(1)), img('d', '  ')],
      PHOTO(1),
      'Beach shoot',
    );
    expect(out.map((i) => i.url)).toEqual([PHOTO(1)]);
  });

  it('shows any repeated photo once, keeping its first place — with or without a cover', () => {
    const withCover = packageGalleryImages(
      [img('a', PHOTO(1)), img('b', PHOTO(2)), img('c', PHOTO(3)), img('d', PHOTO(2))],
      PHOTO(1),
      'Beach shoot',
    );
    expect(withCover.map((i) => i.url)).toEqual([PHOTO(1), PHOTO(2), PHOTO(3)]);
    const noCover = packageGalleryImages(
      [img('a', PHOTO(1)), img('b', PHOTO(1)), img('c', MP4), img('d', MP4)],
      null,
      'Beach shoot',
    );
    expect(noCover.map((i) => i.url)).toEqual([PHOTO(1), MP4]);
  });

  it('builds the cover tile itself when the cover is not among the saved photos', () => {
    const out = packageGalleryImages([img('a', PHOTO(2))], PHOTO(1), 'Beach shoot');
    expect(out.map((i) => i.url)).toEqual([PHOTO(1), PHOTO(2)]);
    expect(out[0]).toMatchObject({ alt: 'Beach shoot' });
  });

  it('with no cover, leads with the first real photo — never a video', () => {
    const out = packageGalleryImages([img('a', MP4), img('b', PHOTO(1))], null, 'Beach shoot');
    expect(out.map((i) => i.url)).toEqual([PHOTO(1), MP4]);
  });
});

describe('sideTileClasses (no empty cells beside the lead)', () => {
  const area = (cls: string) =>
    Number(/col-span-(\d)/.exec(cls)?.[1] ?? 1) * Number(/row-span-(\d)/.exec(cls)?.[1] ?? 1);

  it('shows the lead plus four tiles', () => {
    expect(PACKAGE_GRID_TILES).toBe(5);
  });

  it('fills the whole 2×2 block for 1, 2, 3 and 4 side tiles — no holes', () => {
    for (let k = 1; k <= 4; k++) {
      const classes = sideTileClasses(k);
      expect(classes, `k=${k}`).toHaveLength(k);
      expect(
        classes.reduce((sum, c) => sum + area(c), 0),
        `k=${k}`,
      ).toBe(4);
    }
  });

  it('has no side block at all when there is only a lead', () => {
    expect(sideTileClasses(0)).toEqual([]);
  });

  it('never makes more than four side tiles, however many photos there are', () => {
    expect(sideTileClasses(9)).toHaveLength(4);
  });
});

describe('validatePackageMedia', () => {
  it('accepts a photo cover with any mix of photos, videos and links after it', () => {
    expect(
      validatePackageMedia(PHOTO(1), [{ url: MP4 }, { url: YT }, { url: PHOTO(2) }]),
    ).toBeNull();
    expect(validatePackageMedia(PHOTO(1), [])).toBeNull();
  });

  it('lets a photo cover carry a gallery of only videos and links (the cover is the photo)', () => {
    expect(validatePackageMedia(PHOTO(1), [{ url: MP4 }, { url: YT }])).toBeNull();
  });

  it('refuses a video or a link as the cover', () => {
    expect(validatePackageMedia(MP4, [])).toMatch(/cover/i);
    expect(validatePackageMedia(YT, [{ url: PHOTO(1) }])).toMatch(/cover/i);
  });

  it('refuses videos when there is no photo to lead the page with', () => {
    expect(validatePackageMedia('', [{ url: MP4 }])).toMatch(/photo/i);
    expect(validatePackageMedia('', [{ url: MP4 }, { url: PHOTO(1) }])).toBeNull();
  });

  it('is fine with nothing at all (a draft package)', () => {
    expect(validatePackageMedia('', [])).toBeNull();
  });
});

/* The Tours editor shares the photo/video editor with the package form, so it needs the same rule — the
 * heroImage a card, a search result and the share image read is the first image of ANY activity. */
describe('validateLeadPhoto (any activity’s photos, videos and links)', () => {
  it('accepts photos, or a photo anywhere among videos and links', () => {
    expect(validateLeadPhoto([{ url: PHOTO(1) }, { url: MP4 }])).toBeNull();
    // A video first is put behind the photo when the images are written, so a photo LATER is enough.
    expect(validateLeadPhoto([{ url: MP4 }, { url: YT }, { url: PHOTO(1) }])).toBeNull();
  });

  it('refuses videos or links with no photo to lead with', () => {
    expect(validateLeadPhoto([{ url: MP4 }])).toMatch(/photo/i);
    expect(validateLeadPhoto([{ url: YT }, { url: VIMEO }])).toMatch(/photo/i);
  });

  it('ignores blank rows (the editor’s empty last row) and accepts nothing at all', () => {
    expect(validateLeadPhoto([])).toBeNull();
    expect(validateLeadPhoto([{ url: '  ' }])).toBeNull();
    expect(validateLeadPhoto([{ url: '  ' }, { url: MP4 }])).toMatch(/photo/i);
  });

  it('says the same thing the package form says, so the two editors never disagree', () => {
    expect(validateLeadPhoto([{ url: MP4 }])).toBe(validatePackageMedia('', [{ url: MP4 }]));
  });
});

/* ------------------------------------------------------------------------------------------ */

const INPUT: PhotographyPackageInput = {
  title: 'Couples session — Belle Mare',
  kind: 'shoots',
  summary: 'Golden-hour photos on the beach.',
  durationHours: 1.5,
  baseEur: 150,
  included: 2,
  extraEur: 25,
  maxGuests: 8,
  shootsPerDay: 2,
  minAdvanceDays: 1,
  features: ['Edited photos'],
  addOns: PHOTOGRAPHY_ADD_ON_PRESETS.map((a) => ({ ...a })),
  imageUrl: '',
  gallery: [],
  status: 'published',
  bestSeller: false,
  photoCount: 0,
  locationLine: '',
  deliveryLine: '',
  showDuration: true,
  showGuests: true,
  showAddOns: true,
  showDeposit: true,
  showDetails: true,
  inspiration: [],
  locations: PHOTOGRAPHY_LOCATION_DEFAULTS.map((l) => ({ ...l })),
  slots: PHOTOGRAPHY_SHOOT_SLOTS.map((s) => ({ ...s })),
  occasions: ['couple'],
};

describe('the package form’s gallery (photos, videos and links after the cover)', () => {
  const saved = {
    ...photographyPackageValues({ ...INPUT, imageUrl: PHOTO(1) }),
    images: [
      { url: PHOTO(1), alt: 'Cover' },
      { url: PHOTO(2), alt: 'Second' },
      { url: MP4, alt: 'Film' },
    ],
    photographyCover: PHOTO(1),
  };

  it('loads everything after the cover into the gallery list', () => {
    const input = packageInputFromValues(saved, 2);
    expect(input.imageUrl).toBe(PHOTO(1));
    expect(input.gallery).toEqual([
      { url: PHOTO(2), alt: 'Second' },
      { url: MP4, alt: 'Film' },
    ]);
  });

  it('saves back unchanged when nothing is edited', () => {
    expect(applyPackageInput(saved, packageInputFromValues(saved, 2))).toEqual(saved);
  });

  it('writes the cover first, then the gallery in the order the owner set', () => {
    const input = packageInputFromValues(saved, 2);
    const next = applyPackageInput(saved, {
      ...input,
      gallery: [
        { url: MP4, alt: 'Film' },
        { url: YT, alt: '' },
        { url: PHOTO(2), alt: 'Second' },
        { url: PHOTO(3), alt: '' },
        { url: PHOTO(4), alt: '' },
      ],
    });
    expect(next.images.map((i) => i.url)).toEqual([
      PHOTO(1),
      MP4,
      YT,
      PHOTO(2),
      PHOTO(3),
      PHOTO(4),
    ]);
    expect(next.images[0]).toEqual({ url: PHOTO(1), alt: 'Cover' }); // the cover keeps its alt text
  });

  it('never writes the cover twice, and drops empty rows left in the editor', () => {
    const input = packageInputFromValues(saved, 2);
    const next = applyPackageInput(saved, {
      ...input,
      gallery: [
        { url: PHOTO(1), alt: 'again' },
        { url: '', alt: '' },
        { url: '  ', alt: '' },
        { url: PHOTO(2), alt: 'Second' },
      ],
    });
    expect(next.images.map((i) => i.url)).toEqual([PHOTO(1), PHOTO(2)]);
  });

  it('replacing the cover replaces it — the old cover is gone and the gallery is untouched', () => {
    const input = packageInputFromValues(saved, 2);
    const next = applyPackageInput(saved, { ...input, imageUrl: PHOTO(9) });
    expect(next.images.map((i) => i.url)).toEqual([PHOTO(9), PHOTO(2), MP4]);
    expect(next.photographyCover).toBe(PHOTO(9));
  });

  it('with no cover, never lets a video become the first image (cards and search read images[0])', () => {
    const input = packageInputFromValues(saved, 2);
    const next = applyPackageInput(saved, {
      ...input,
      imageUrl: '',
      gallery: [
        { url: MP4, alt: '' },
        { url: PHOTO(2), alt: '' },
      ],
    });
    expect(next.images.map((i) => i.url)).toEqual([PHOTO(2), MP4]);
  });

  it('creates a new package with its gallery after the cover', () => {
    const v = photographyPackageValues({
      ...INPUT,
      imageUrl: PHOTO(1),
      gallery: [
        { url: PHOTO(2), alt: '' },
        { url: YT, alt: '' },
      ],
    });
    expect(v.images.map((i) => i.url)).toEqual([PHOTO(1), PHOTO(2), YT]);
  });
});
