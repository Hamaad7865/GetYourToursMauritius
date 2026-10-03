import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  IMAGE_WIDTHS,
  canResize,
  resizedUrl,
  resizingEnabled,
  responsiveImage,
} from '@/lib/images/resize';

/**
 * Photos are stored at full camera size in Supabase Storage and the site never resized them, so a
 * photoshoot page downloaded ~53 MB. Cloudflare's /cdn-cgi/image/ can serve a 400–2400 px AVIF/WebP of
 * the same file, but ONLY for the owner's Supabase project (the one origin allow-listed in Cloudflare),
 * ONLY once the owner has turned the feature on (NEXT_PUBLIC_IMAGE_RESIZING=1), and a wrong URL breaks the
 * picture — so these tests pin exactly when a URL is rewritten and what it looks like. With the switch
 * off the markup must be byte-for-byte what it was before.
 */
const PROJECT = 'https://abcdefghij.supabase.co';
const PHOTO = `${PROJECT}/storage/v1/object/public/activity-images/photography/1790291756505-paulyg.jpg`;
const base = { sizes: '(min-width: 1024px) 380px, 100vw', enabled: true, supabaseUrl: PROJECT };

afterEach(() => vi.unstubAllEnvs());

describe('resizingEnabled', () => {
  it('is on only for the exact value 1', () => {
    vi.stubEnv('NEXT_PUBLIC_IMAGE_RESIZING', '1');
    expect(resizingEnabled()).toBe(true);
    for (const v of ['', '0', 'true', 'yes', ' 1', 'on']) {
      vi.stubEnv('NEXT_PUBLIC_IMAGE_RESIZING', v);
      expect(resizingEnabled()).toBe(false);
    }
  });

  it('is off when the variable is not set at all (the default for every build)', () => {
    vi.stubEnv('NEXT_PUBLIC_IMAGE_RESIZING', undefined as unknown as string);
    expect(resizingEnabled()).toBe(false);
  });
});

describe('canResize', () => {
  it('accepts a public photo from the site’s own Supabase project', () => {
    expect(canResize(PHOTO, PROJECT)).toBe(true);
    expect(canResize(`${PHOTO}?v=2`, PROJECT)).toBe(true);
  });

  it('refuses anything that is not that project’s public storage', () => {
    const refused = [
      'https://otherproject.supabase.co/storage/v1/object/public/activity-images/a.jpg', // not ours: 403s
      `${PROJECT}/storage/v1/object/sign/activity-images/a.jpg`, // signed, not public
      `${PROJECT}/rest/v1/activity_images`,
      'http://abcdefghij.supabase.co/storage/v1/object/public/activity-images/a.jpg', // not https
      'https://images.unsplash.com/photo-1.jpg',
      '/photography/couple.jpg', // our own static file: already web-sized
      'data:image/png;base64,AAAA',
      '',
      'not a url',
    ];
    for (const src of refused) expect(canResize(src, PROJECT), src).toBe(false);
  });

  it('refuses files a transform would damage or cannot read: svg, gif, video, pdf', () => {
    for (const ext of ['svg', 'gif', 'mp4', 'webm', 'mov', 'pdf']) {
      expect(
        canResize(`${PROJECT}/storage/v1/object/public/activity-images/a/b.${ext}`, PROJECT),
        ext,
      ).toBe(false);
    }
  });

  it('refuses an address that is already a transform (no double resizing)', () => {
    expect(canResize(`/cdn-cgi/image/width=400/${PHOTO}`, PROJECT)).toBe(false);
  });

  it('refuses everything when the build knows no Supabase project', () => {
    expect(canResize(PHOTO, undefined)).toBe(false);
    expect(canResize(PHOTO, '')).toBe(false);
  });
});

describe('resizedUrl', () => {
  it('is a same-site /cdn-cgi/image path: width, quality 80, auto format, never upscale', () => {
    expect(resizedUrl(PHOTO, 800)).toBe(
      `/cdn-cgi/image/width=800,quality=80,format=auto,fit=scale-down/${PHOTO}`,
    );
  });

  it('takes a quality override', () => {
    expect(resizedUrl(PHOTO, 400, 60)).toContain('width=400,quality=60,');
  });
});

describe('responsiveImage', () => {
  it('returns ONLY the src when the switch is off — the markup is unchanged', () => {
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
      expect(candidates[i]).toBe(`${resizedUrl(PHOTO, w)} ${w}w`);
    });
  });

  it('writes a srcset a browser can split: a space after every comma BETWEEN candidates', () => {
    // The option list inside each URL contains commas (width=400,quality=80,…) but never whitespace, so
    // splitting on "comma + whitespace" must give exactly one entry per width.
    const srcSet = responsiveImage(PHOTO, base).srcSet ?? '';
    for (const c of srcSet.split(/,\s+/)) expect(c.trim().split(/\s+/)).toHaveLength(2);
  });

  it('uses a mid-size variant as the plain src (what old browsers and crawlers fetch)', () => {
    expect(responsiveImage(PHOTO, base).src).toBe(resizedUrl(PHOTO, 1200));
  });

  it('honours a custom ladder: sorted, de-duplicated, src = first width >= 1200 else the largest', () => {
    const r = responsiveImage(PHOTO, { ...base, widths: [960, 480, 960] });
    expect(r.srcSet).toBe(`${resizedUrl(PHOTO, 480)} 480w, ${resizedUrl(PHOTO, 960)} 960w`);
    expect(r.src).toBe(resizedUrl(PHOTO, 960));
    expect(responsiveImage(PHOTO, { ...base, widths: [1600] }).src).toBe(resizedUrl(PHOTO, 1600));
  });

  it('falls back to the plain src for an empty or nonsense ladder', () => {
    expect(responsiveImage(PHOTO, { ...base, widths: [] })).toEqual({ src: PHOTO });
    expect(responsiveImage(PHOTO, { ...base, widths: [0, -5, Number.NaN] })).toEqual({
      src: PHOTO,
    });
  });

  it('reads the switch from the environment when not told', () => {
    vi.stubEnv('NEXT_PUBLIC_IMAGE_RESIZING', '1');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', PROJECT);
    expect(responsiveImage(PHOTO, { sizes: '100vw' }).srcSet).toBeTruthy();
    vi.stubEnv('NEXT_PUBLIC_IMAGE_RESIZING', '');
    expect(responsiveImage(PHOTO, { sizes: '100vw' })).toEqual({ src: PHOTO });
  });
});
