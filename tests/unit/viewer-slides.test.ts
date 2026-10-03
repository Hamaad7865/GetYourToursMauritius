import { describe, expect, it } from 'vitest';
import {
  VIEWER_THUMB_WIDTH,
  VIEWER_WIDTHS,
  viewerSlides,
  type ViewerItem,
} from '@/lib/images/viewer-slides';
import { videoMime } from '@/lib/media';

/**
 * What the full-screen viewer is given. The page hands over plain items (a photo, an uploaded video, a
 * YouTube / Vimeo link); this decides what each one is as a slide — including which resized copies a photo
 * offers — so the rules are testable without a browser. The viewer component itself is the library's.
 */
const SB = 'https://proj.supabase.co';
const ON = { enabled: true, supabaseUrl: SB };
const OFF = { enabled: false, supabaseUrl: SB };
const PHOTO = (n: number) => `${SB}/storage/v1/object/public/activity-images/p/${n}.jpg`;
const MP4 = `${SB}/storage/v1/object/public/activity-images/p/film.mp4`;
const photo = (n: number, over: Partial<ViewerItem> = {}): ViewerItem => ({
  src: PHOTO(n),
  alt: `Photo ${n}`,
  video: false,
  ...over,
});

describe('viewerSlides — photos', () => {
  it('is just the address and the description while resizing is off', () => {
    expect(viewerSlides([photo(1)], OFF)).toEqual([{ src: PHOTO(1), alt: 'Photo 1' }]);
  });

  it('offers a ladder of resized copies, a small thumbnail and the original when resizing is on', () => {
    const [slide] = viewerSlides([photo(1)], ON);
    expect(slide).toMatchObject({ alt: 'Photo 1', original: PHOTO(1) });
    const widths = (slide as { srcSet: { width: number }[] }).srcSet.map((s) => s.width);
    expect(widths).toEqual([...VIEWER_WIDTHS]);
    for (const s of (slide as { srcSet: { src: string; width: number }[] }).srcSet) {
      expect(s.src).toContain(`width=${s.width},`);
      expect(s.src).toContain(PHOTO(1));
    }
    // What an old browser or a crawler loads is a decent size, never the multi-megabyte original.
    expect((slide as { src: string }).src).toContain('/cdn-cgi/image/width=1200,');
    expect((slide as { thumbnail: string }).thumbnail).toContain(`width=${VIEWER_THUMB_WIDTH},`);
  });

  it('remembers the untouched picture behind a resized thumbnail, for the fallback when it fails to load', () => {
    const [slide] = viewerSlides([photo(1)], ON) as { thumbnailOriginal?: string }[];
    expect(slide!.thumbnailOriginal).toBe(PHOTO(1));
    const [plain] = viewerSlides([photo(1)], OFF);
    expect(plain).not.toHaveProperty('thumbnailOriginal');
  });

  it('keeps a made-up height beside each width, in the usual 3:2 shape (the real one is not stored)', () => {
    const [slide] = viewerSlides([photo(1)], ON);
    for (const s of (slide as { srcSet: { width: number; height: number }[] }).srcSet) {
      expect(s.height).toBe(Math.round((s.width * 2) / 3));
    }
  });

  it('leaves a photo from another site alone, even with resizing on', () => {
    const other = photo(1, { src: 'https://elsewhere.example/p/1.jpg' });
    expect(viewerSlides([other], ON)).toEqual([{ src: other.src, alt: 'Photo 1' }]);
  });

  it('leaves our own static files alone (a relative path is not in the storage bucket)', () => {
    const local = photo(1, { src: '/images/hero.jpg' });
    expect(viewerSlides([local], ON)).toEqual([{ src: '/images/hero.jpg', alt: 'Photo 1' }]);
  });

  it('uses the thumbnail an item brings (the inspiration grid’s own small copy)', () => {
    const thumb = `${SB}/storage/v1/object/public/activity-images/p/1-small.jpg`;
    const off = viewerSlides([photo(1, { thumb })], OFF)[0] as { thumbnail: string };
    expect(off.thumbnail).toBe(thumb);
    // …and resizes it to the thumbnail width when it is one of ours.
    const on = viewerSlides([photo(1, { thumb })], ON)[0] as {
      thumbnail: string;
      thumbnailOriginal: string;
    };
    expect(on.thumbnail).toContain(`width=${VIEWER_THUMB_WIDTH},`);
    expect(on.thumbnail).toContain(thumb);
    // The fallback goes back to the thumbnail's own source (the small copy), not to the big photo.
    expect(on.thumbnailOriginal).toBe(thumb);
    expect(off).not.toHaveProperty('thumbnailOriginal');
  });

  it('has no thumbnail of its own when resizing is off and none was given (the viewer uses the photo)', () => {
    expect(viewerSlides([photo(1, { thumb: null })], OFF)[0]).not.toHaveProperty('thumbnail');
  });
});

describe('viewerSlides — videos and links', () => {
  it('plays an uploaded video file from its own address, typed by its extension', () => {
    const [slide] = viewerSlides([{ src: MP4, alt: 'Film', video: true }], ON);
    expect(slide).toMatchObject({
      type: 'video',
      sources: [{ src: MP4, type: 'video/mp4' }],
      autoPlay: true,
      controls: true,
    });
    // A film is never run through the photo resizer.
    expect(JSON.stringify(slide)).not.toContain('/cdn-cgi/image');
  });

  it('knows a .mov and a .webm file', () => {
    const mov = viewerSlides([{ src: `${SB}/x/a.mov`, alt: '', video: true }], OFF)[0] as {
      sources: { type: string }[];
    };
    const webm = viewerSlides([{ src: `${SB}/x/a.webm`, alt: '', video: true }], OFF)[0] as {
      sources: { type: string }[];
    };
    expect(mov.sources[0]!.type).toBe('video/quicktime');
    expect(webm.sources[0]!.type).toBe('video/webm');
  });

  it('turns a YouTube or Vimeo link into an embedded player, titled for screen readers', () => {
    const yt = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1';
    const still = 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg';
    const [a] = viewerSlides(
      [
        {
          src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          thumb: still,
          alt: 'Clip',
          video: true,
          embedUrl: yt,
        },
      ],
      ON,
    );
    // YouTube's own still is its thumbnail, and it is not pushed through our photo resizer.
    expect(a).toEqual({ type: 'embed', embedUrl: yt, title: 'Clip', thumbnail: still });

    const vimeo = 'https://player.vimeo.com/video/76979871?autoplay=1';
    const [b] = viewerSlides(
      [{ src: 'https://vimeo.com/76979871', alt: 'Film', video: true, embedUrl: vimeo }],
      ON,
    );
    // Vimeo offers no still, so there is no thumbnail to claim.
    expect(b).toEqual({ type: 'embed', embedUrl: vimeo, title: 'Film' });
  });
});

describe('viewerSlides — the list', () => {
  it('keeps the order and the count, whatever mix it is given', () => {
    const slides = viewerSlides(
      [
        photo(1),
        { src: MP4, alt: 'Film', video: true },
        photo(2),
        { src: 'https://vimeo.com/76979871', alt: 'V', video: true, embedUrl: 'https://p/v' },
      ],
      ON,
    );
    expect(slides).toHaveLength(4);
    expect(slides.map((s) => ('type' in s ? s.type : 'photo'))).toEqual([
      'photo',
      'video',
      'photo',
      'embed',
    ]);
  });

  it('is empty for no items', () => {
    expect(viewerSlides([], ON)).toEqual([]);
  });
});

describe('videoMime', () => {
  it('maps each supported extension to the type a <video> source wants', () => {
    expect(videoMime('https://x/a.mp4')).toBe('video/mp4');
    expect(videoMime('https://x/a.m4v')).toBe('video/mp4');
    expect(videoMime('https://x/a.webm')).toBe('video/webm');
    expect(videoMime('https://x/a.mov')).toBe('video/quicktime');
    expect(videoMime('https://x/a.ogv')).toBe('video/ogg');
  });

  it('ignores case and a query string, and says nothing for a photo or a bare page', () => {
    expect(videoMime('https://x/A.MP4?token=1')).toBe('video/mp4');
    expect(videoMime('https://x/a.jpg')).toBeNull();
    expect(videoMime('https://youtu.be/dQw4w9WgXcQ')).toBeNull();
  });
});
