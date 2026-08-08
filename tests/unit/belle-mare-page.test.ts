import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import nextConfig from '../../next.config.mjs';
import { AREA_PATH_OVERRIDES, areas, destinationPath, getArea } from '@/lib/content/areas';
import { hotelsFor, DEFAULT_AIRPORT_MINUTES } from '@/lib/content/destination-hotels';
import { BELLE_MARE_HOTEL_PHOTOS } from '@/lib/content/hotel-photos';
import { getTransfer } from '@/lib/content/transfers';
import { LOCALE_PREFIX } from '@/lib/i18n/routing';

/**
 * The Belle Mare area guide lives at the bare /belle-mare instead of /destinations/belle-mare.
 *
 * That move is expressed in exactly two places that have to agree: AREA_PATH_OVERRIDES (which the
 * sitemap, the /destinations index, the canonical, the breadcrumb and the Place JSON-LD all read)
 * and the 308 pair in next.config.mjs. Drop the redirect and the old URL — the one Google actually
 * cites for "belle mare", and the target of the visitemaurice.com retirement Worker — starts
 * serving a live, unlinked duplicate of the new page. Drop the override and the new URL exists but
 * nothing points at it. Neither failure is visible from the rendered page, which is why it is
 * guarded here rather than left to review.
 */

const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([a-z]:)/i, '$1');

type Redirect = { source: string; destination: string; permanent?: boolean };

async function redirects(): Promise<Redirect[]> {
  const all = (await nextConfig.redirects?.()) ?? [];
  return all as Redirect[];
}

describe('AREA_PATH_OVERRIDES', () => {
  it('moves Belle Mare to the bare /belle-mare, and that is what every consumer reads', () => {
    expect(AREA_PATH_OVERRIDES['belle-mare']).toBe('/belle-mare');
    expect(destinationPath('belle-mare')).toBe('/belle-mare');
    // `areas` is the array the sitemap and the /destinations index map over — the override has to
    // survive the build of that array, not just the helper.
    expect(getArea('belle-mare')?.path).toBe('/belle-mare');
    expect(areas.find((a) => a.slug === 'belle-mare')?.path).toBe('/belle-mare');
  });

  it('leaves every other area under /destinations', () => {
    for (const area of areas) {
      if (AREA_PATH_OVERRIDES[area.slug]) continue;
      expect(area.path).toBe(`/destinations/${area.slug}`);
    }
  });

  it('backs each override with a route file, or the new URL 404s', () => {
    for (const path of Object.values(AREA_PATH_OVERRIDES)) {
      expect(existsSync(`${ROOT}app/(site)${path}/page.tsx`), `no route for ${path}`).toBe(true);
    }
  });

  it('308s the vacated /destinations URL onto the override, in BOTH locales', async () => {
    const rules = await redirects();
    for (const [slug, path] of Object.entries(AREA_PATH_OVERRIDES)) {
      // next.config redirects run BEFORE the locale middleware, so /fr is still literally in the
      // path here and needs its own rule — it does not inherit the bare one.
      for (const prefix of Object.values(LOCALE_PREFIX)) {
        const source = `${prefix}/destinations/${slug}`;
        const rule = rules.find((r) => r.source === source);
        expect(rule, `no redirect from ${source}`).toBeDefined();
        expect(rule?.destination).toBe(`${prefix}${path}`);
        expect(rule?.permanent, `${source} must be permanent`).toBe(true);
      }
    }
  });
});

describe('hotel journey times', () => {
  const hotels = hotelsFor('belle-mare');

  it('has a roster to show', () => {
    expect(hotels.length).toBeGreaterThan(0);
  });

  /*
   * ONE SOURCE for a hotel's journey time.
   *
   * The first cut of this page carried a hand-derived `airportMinutes` on each hotel, and it drifted
   * from the figure the hotel's own /airport-transfers/<slug> page publishes — Anahita Golf read
   * "≈40" on the guide and "50 min" on its transfer page. Same site, same hotel, two answers. The
   * guide now reads `durationMinFromAirport` straight from the transfer record, and this test fails
   * if anyone reintroduces a competing per-hotel field.
   */
  it('takes journey times from the transfer record, not a second copy on the hotel', () => {
    expect('airportMinutes' in ({} as Record<string, unknown>)).toBe(false);
    for (const h of hotels) {
      expect(
        Object.keys(h),
        `${h.slug} must not carry its own journey time — read it from _transfers.gen.ts`,
      ).not.toContain('airportMinutes');
    }
  });

  it('covers all but a known handful with a real transfer page', () => {
    const withTransfer = hotels.filter((h) => getTransfer(h.slug));
    // 13 of 14 today; the page falls back to the area figure for the remainder.
    expect(withTransfer.length).toBeGreaterThanOrEqual(hotels.length - 1);
  });

  /* The page renders `{minutes} {t('min')}`, so a unit baked into the fallback would print twice —
     and in French would print the English one. */
  it('keeps the fallback a bare range, never a unit', () => {
    expect(DEFAULT_AIRPORT_MINUTES).toMatch(/^[0-9≈–\s-]+$/);
  });
});

describe('hotel card photography', () => {
  /*
   * Every photo we publish must be one we can point at a licence for. Commons CC BY / CC BY-SA both
   * require naming the author AND the licence, so a credit-less remote file is a licence breach
   * waiting to be noticed; and a photo of the COAST sitting under a hotel's name is a claim about
   * that hotel unless the card captions it. Both are enforced here rather than left to review.
   */
  it('credits every remote photo and leaves only our own files uncredited', () => {
    for (const [slug, photo] of Object.entries(BELLE_MARE_HOTEL_PHOTOS)) {
      if (photo.url.startsWith('/')) {
        expect(photo.credit, `${slug} is our own file and needs no credit`).toBeNull();
        continue;
      }
      expect(photo.credit, `${slug} publishes a remote file with no credit`).not.toBeNull();
      expect(photo.credit?.author, `${slug} credit has no author`).toBeTruthy();
      expect(photo.credit?.licence, `${slug} credit has no licence`).toBeTruthy();
      expect(photo.credit?.source ?? '').toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
    }
  });

  /*
   * A card shows the property or it shows nothing.
   *
   * The first pass filled the eleven hotels with no free photograph using a picture of the coast
   * each sits on. The owner rejected it immediately — "they're not for the real hotels" — because a
   * beach under a hotel's name reads as that hotel however it is captioned. This test is what stops
   * that being quietly redone: a `subject`/`depicts`/`caption` field reappearing on the register is
   * the shape area photography comes back in.
   */
  it('registers only photographs of the property itself, never of the surrounding area', () => {
    for (const [slug, photo] of Object.entries(BELLE_MARE_HOTEL_PHOTOS)) {
      for (const banned of ['subject', 'depicts', 'caption', 'area']) {
        expect(
          Object.keys(photo),
          `${slug}: "${banned}" means an area photo is being passed off as the hotel`,
        ).not.toContain(banned);
      }
    }
  });

  it('only registers photos for hotels that exist', () => {
    const slugs = new Set(hotelsFor('belle-mare').map((h) => h.slug));
    for (const slug of Object.keys(BELLE_MARE_HOTEL_PHOTOS)) {
      expect(slugs.has(slug), `${slug} is not in the Belle Mare roster`).toBe(true);
    }
  });
});
