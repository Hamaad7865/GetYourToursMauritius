import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IMAGE_WIDTHS,
  canResize,
  isOwnPublicPhoto,
  resizeSource,
  resizedUrl,
  resizingEnabled,
  responsiveImage,
} from '@/lib/images/resize';
import { ARTICLE_HERO, GALLERY_LEAD, GALLERY_TILE, PHOTO_CARD } from '@/lib/images/presets';

/**
 * Photos are stored at full size in Supabase Storage and the site never resized them: the seaplane
 * page's lead photo is 668 KB, the catalogue's cards 19 MB. Cloudflare's /cdn-cgi/image/ serves a
 * 400–1600 px AVIF/WebP of the same file — but only from a source on our own zone, so a Supabase
 * photo goes through our proxy (/api/img). A wrong URL breaks the picture, so these tests pin exactly
 * when a URL is rewritten and what it looks like. With resizing off the markup must be byte-for-byte
 * what it was before.
 */
const PROJECT = 'https://abcdefghij.supabase.co';
const PHOTO = `${PROJECT}/storage/v1/object/public/activity-images/seaplane/1785790060957-espm2i.jpg`;
const PROXIED_PHOTO = `/api/img?u=${encodeURIComponent(PHOTO)}`;
const WIKI =
  '/api/img?u=https%3A%2F%2Fupload.wikimedia.org%2Fwikipedia%2Fcommons%2Fthumb%2Ff%2Ffa%2FCrystal_Rock%252C_Mauritius.jpg%2F1280px-Crystal_Rock%252C_Mauritius.jpg';
const base = { sizes: '(min-width: 1024px) 380px, 100vw', enabled: true, supabaseUrl: PROJECT };

afterEach(() => vi.unstubAllEnvs());

describe('resizingEnabled', () => {
  const site = (url: string | undefined) => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_IMAGE_RESIZING', undefined as unknown as string);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', url as unknown as string);
    return resizingEnabled();
  };

  it('is on for a real https domain', () => {
    expect(site('https://bellemaretours.com')).toBe(true);
    expect(site('https://bellemaretours.com ')).toBe(true); // a trailing space once broke payments
  });

  // /cdn-cgi/image does not exist on these hosts (404): every photo would fail once and fall back.
  it('is off where Cloudflare has no transformations to offer', () => {
    for (const url of [
      'https://bellemaretours.pages.dev',
      'https://sandbox-abc.pages.dev',
      'https://cron.example.workers.dev',
      'http://localhost:3000',
      'https://localhost:3000',
      'http://127.0.0.1:3000',
      'http://bellemaretours.com',
      '',
      undefined,
      'not a url',
    ]) {
      expect(site(url), String(url)).toBe(false);
    }
  });

  it('is off in a development build, whatever the site address says', () => {
    vi.stubEnv('NEXT_PUBLIC_IMAGE_RESIZING', undefined as unknown as string);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://bellemaretours.com');
    vi.stubEnv('NODE_ENV', 'development');
    expect(resizingEnabled()).toBe(false);
  });

  it('obeys the kill switch on a real domain, and the force switch anywhere', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://bellemaretours.com');
    vi.stubEnv('NEXT_PUBLIC_IMAGE_RESIZING', '0');
    expect(resizingEnabled()).toBe(false);
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'http://localhost:3000');
    vi.stubEnv('NEXT_PUBLIC_IMAGE_RESIZING', '1');
    expect(resizingEnabled()).toBe(true);
  });
});

describe('isOwnPublicPhoto — also what the proxy route will fetch', () => {
  it('accepts a public file in the site’s own Supabase project', () => {
    expect(isOwnPublicPhoto(PHOTO, PROJECT)).toBe(true);
    expect(isOwnPublicPhoto(`${PHOTO}?v=2`, PROJECT)).toBe(true);
  });

  it('refuses every other host and every non-public path', () => {
    const refused = [
      'https://otherproject.supabase.co/storage/v1/object/public/activity-images/a.jpg',
      'https://abcdefghij.supabase.co.evil.test/storage/v1/object/public/a.jpg',
      `${PROJECT}/storage/v1/object/sign/activity-images/a.jpg`, // signed, not public
      `${PROJECT}/storage/v1/object/authenticated/galleries/a.jpg`,
      `${PROJECT}/rest/v1/bookings`,
      `${PROJECT}/auth/v1/user`,
      'http://abcdefghij.supabase.co/storage/v1/object/public/activity-images/a.jpg', // not https
      'https://images.unsplash.com/photo-1.jpg',
      '/photography/couple.jpg',
      'data:image/png;base64,AAAA',
      '',
      'not a url',
    ];
    for (const url of refused) expect(isOwnPublicPhoto(url, PROJECT), url).toBe(false);
  });

  it('refuses everything when the build knows no Supabase project', () => {
    expect(isOwnPublicPhoto(PHOTO, undefined)).toBe(false);
    expect(isOwnPublicPhoto(PHOTO, '')).toBe(false);
  });
});

describe('resizeSource', () => {
  it('sends one of our Supabase photos through the proxy, percent-encoded', () => {
    expect(resizeSource(PHOTO, PROJECT)).toBe(PROXIED_PHOTO);
    expect(PROXIED_PHOTO).not.toMatch(/[\s,]/); // a comma or a space would break the srcset
  });

  it('keeps an image that already comes through the proxy as it is', () => {
    expect(resizeSource(WIKI, PROJECT)).toBe(WIKI);
  });

  it('returns null for anything else', () => {
    for (const src of [
      '/photography/couple.jpg',
      'https://images.unsplash.com/photo-1.jpg',
      'https://upload.wikimedia.org/wikipedia/commons/a.jpg', // not proxied: not on our zone
      `/cdn-cgi/image/width=400${PROXIED_PHOTO}`, // already a transform — no double resizing
      'data:image/png;base64,AAAA',
      '',
    ]) {
      expect(resizeSource(src, PROJECT), src).toBeNull();
      expect(canResize(src, PROJECT), src).toBe(false);
    }
  });

  it('refuses files a transform would damage or cannot read: svg, gif, video, pdf', () => {
    for (const ext of ['svg', 'gif', 'mp4', 'webm', 'mov', 'pdf']) {
      const file = `${PROJECT}/storage/v1/object/public/activity-images/a/b.${ext}`;
      expect(resizeSource(file, PROJECT), ext).toBeNull();
      expect(resizeSource(`/api/img?u=${encodeURIComponent(file)}`, PROJECT), ext).toBeNull();
    }
  });

  it('survives a proxied address that cannot be decoded', () => {
    expect(resizeSource('/api/img?u=%E0%A4%A', PROJECT)).toBeNull();
  });
});

describe('resizedUrl', () => {
  it('is a same-site /cdn-cgi/image path: width, quality 80, auto format, never upscale', () => {
    expect(resizedUrl(PROXIED_PHOTO, 800)).toBe(
      `/cdn-cgi/image/width=800,quality=80,format=auto,fit=scale-down${PROXIED_PHOTO}`,
    );
  });

  it('takes a quality override', () => {
    expect(resizedUrl(PROXIED_PHOTO, 400, 60)).toContain('width=400,quality=60,');
  });
});

describe('responsiveImage', () => {
  it('returns ONLY the src when resizing is off — the markup is unchanged', () => {
    expect(responsiveImage(PHOTO, { ...base, enabled: false })).toEqual({ src: PHOTO });
    expect(Object.keys(responsiveImage(PHOTO, { ...base, enabled: false }))).toEqual(['src']);
  });

  it('returns ONLY the src for a file that cannot be resized', () => {
    for (const src of ['/photography/couple.jpg', 'https://x.test/a.svg', '']) {
      expect(responsiveImage(src, base)).toEqual({ src });
    }
  });

  it('builds a srcset over the whole width ladder, tagged with its original', () => {
    const r = responsiveImage(PHOTO, base);
    expect(r.sizes).toBe(base.sizes);
    expect(r['data-src-original']).toBe(PHOTO);
    const candidates = (r.srcSet ?? '').split(/,\s+/);
    expect(candidates).toHaveLength(IMAGE_WIDTHS.length);
    IMAGE_WIDTHS.forEach((w, i) => {
      expect(candidates[i]).toBe(`${resizedUrl(PROXIED_PHOTO, w)} ${w}w`);
    });
  });

  it('resizes a proxied Wikimedia photo and falls back to the proxied address', () => {
    const r = responsiveImage(WIKI, { ...base, widths: [400, 800] });
    expect(r.src).toBe(resizedUrl(WIKI, 800));
    expect(r['data-src-original']).toBe(WIKI);
  });

  it('writes a srcset a browser can split: a space after every comma BETWEEN candidates', () => {
    // The option list inside each URL contains commas (width=400,quality=80,…) but never whitespace,
    // so splitting on "comma + whitespace" must give exactly one entry per width.
    for (const src of [PHOTO, WIKI]) {
      const srcSet = responsiveImage(src, base).srcSet ?? '';
      for (const c of srcSet.split(/,\s+/)) expect(c.trim().split(/\s+/)).toHaveLength(2);
    }
  });

  it('uses a mid-size variant as the plain src (what old browsers and crawlers fetch)', () => {
    expect(responsiveImage(PHOTO, base).src).toBe(resizedUrl(PROXIED_PHOTO, 1200));
  });

  it('honours a custom ladder: sorted, de-duplicated, src = first width >= 1200 else the largest', () => {
    const r = responsiveImage(PHOTO, { ...base, widths: [960, 480, 960] });
    expect(r.srcSet).toBe(
      `${resizedUrl(PROXIED_PHOTO, 480)} 480w, ${resizedUrl(PROXIED_PHOTO, 960)} 960w`,
    );
    expect(r.src).toBe(resizedUrl(PROXIED_PHOTO, 960));
  });

  it('falls back to the plain src for an empty or nonsense ladder', () => {
    expect(responsiveImage(PHOTO, { ...base, widths: [] })).toEqual({ src: PHOTO });
    expect(responsiveImage(PHOTO, { ...base, widths: [0, -5, Number.NaN] })).toEqual({
      src: PHOTO,
    });
  });

  it('reads the switch and the project from the environment when not told', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://bellemaretours.com');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', PROJECT);
    expect(responsiveImage(PHOTO, { sizes: '100vw' }).srcSet).toBeTruthy();
    vi.stubEnv('NEXT_PUBLIC_IMAGE_RESIZING', '0');
    expect(responsiveImage(PHOTO, { sizes: '100vw' })).toEqual({ src: PHOTO });
  });
});

// Each distinct (photo, width) is one of 5,000 free transformations a month. Presets that invent
// their own widths multiply that count for no visible gain.
describe('presets', () => {
  it('draw every width from the one shared ladder', () => {
    for (const preset of [PHOTO_CARD, GALLERY_LEAD, GALLERY_TILE, ARTICLE_HERO]) {
      for (const w of preset.widths) expect(IMAGE_WIDTHS).toContain(w);
      expect(preset.sizes.length).toBeGreaterThan(0);
    }
  });
});
