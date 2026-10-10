import { describe, expect, it } from 'vitest';
import {
  ATTRACTION_TYPES,
  PLACES_MENU,
  THINGS_MENU_STATIC,
  regionAnchor,
} from '@/lib/nav/mega-menu';
import { areas } from '@/lib/content/areas';
import { REGION_ORDER, attractionImage } from '@/lib/content/attractions';
import { fr } from '@/lib/i18n/messages';

/**
 * The header's menus are written out by hand (src/lib/nav/mega-menu.ts) because the modules they
 * mirror are too heavy to ship to a browser. That makes them a second copy, and a second copy drifts:
 * an area guide is added and never appears in the menu, or a guide moves and the menu keeps a dead
 * link on every page of the site. These hold the copy to its sources.
 */

const group = (id: string) => {
  const found = PLACES_MENU.find((g) => g.id === id);
  if (!found) throw new Error(`no "${id}" group in the Places menu`);
  return found;
};

describe('Places to see menu', () => {
  it('lists every area guide, by its real name, at its real URL', () => {
    const menu = group('areas')
      .links.map((l) => `${l.label} -> ${l.href}`)
      .sort();
    const guides = areas.map((a) => `${a.name} -> ${a.path}`).sort();
    expect(menu).toEqual(guides);
  });

  it('gives every top sight a photo from the attraction set, at thumbnail size', () => {
    for (const link of group('top-sights').links) {
      const slug = link.href.replace('/attractions/', '');
      expect(attractionImage(slug), `${slug} has no photo`).not.toBeNull();
      expect(link.thumb, slug).toBeTruthy();
      // A menu thumbnail is 40px; the stored 1280px rendition must never be what it requests.
      expect(link.thumb, slug).not.toContain('1280px');
    }
  });

  it('has no duplicate links inside a group', () => {
    for (const g of [...PLACES_MENU, ...THINGS_MENU_STATIC]) {
      const hrefs = g.links.map((l) => l.href);
      expect(new Set(hrefs).size, g.id).toBe(hrefs.length);
    }
  });

  it('links each attraction type to the filter /attractions reads, one slug per type', () => {
    for (const type of ATTRACTION_TYPES) expect(type.slug).toMatch(/^[a-z]+$/);
    expect(new Set(ATTRACTION_TYPES.map((x) => x.slug)).size).toBe(ATTRACTION_TYPES.length);
    expect(new Set(ATTRACTION_TYPES.map((x) => x.category)).size).toBe(ATTRACTION_TYPES.length);
    expect(group('types').links.map((l) => l.href)).toEqual(
      ATTRACTION_TYPES.map((x) => `/attractions?type=${x.slug}`),
    );
  });

  it('points "By coast" at the anchors /attractions gives its region sections', () => {
    expect(group('coasts').links.map((l) => l.href)).toEqual(
      REGION_ORDER.map((region) => `/attractions#${regionAnchor(region)}`),
    );
  });
});

describe('menu copy', () => {
  it('has French for every label that is UI copy rather than a place name', () => {
    // These labels reach t() through a variable, so scripts/i18n-scan.mjs cannot see them.
    const groups = [...PLACES_MENU, ...THINGS_MENU_STATIC];
    const keys = [
      'Tours & activities',
      ...groups.map((g) => g.label),
      ...groups
        .flatMap((g) => [...g.links, ...(g.more ? [g.more] : [])])
        .flatMap((l) => (l.translate ? [l.label] : [])),
    ];
    const missing = [...new Set(keys)].filter((key) => !(key in fr));
    expect(missing).toEqual([]);
  });
});
