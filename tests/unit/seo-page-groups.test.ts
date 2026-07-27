import { beforeEach, describe, expect, it, vi } from 'vitest';

/* /admin/seo used to edit 18 hand-listed pages out of a 233-URL sitemap. buildSeoPageGroups adds
 * the three content-module families (destinations, hotel transfers, attractions) so those ~75 URLs
 * stop needing a deploy to retitle. */

vi.mock('@/lib/catalogue/places', () => ({ loadPlaces: vi.fn() }));

import { loadPlaces } from '@/lib/catalogue/places';
import { buildSeoPageGroups } from '@/lib/seo/page-groups';
import { effectiveDefaultTitle, BRAND_SUFFIX, SEO_PAGES } from '@/lib/seo/page-registry';

const PLACE = {
  id: 'ile-aux-cerfs',
  name: 'Île aux Cerfs',
  region: 'East',
  blurb: 'A lagoon island off the east coast.',
};

beforeEach(() => {
  vi.mocked(loadPlaces).mockReset();
  vi.mocked(loadPlaces).mockResolvedValue([PLACE] as never);
});

describe('effectiveDefaultTitle', () => {
  it('appends the brand for template-branded pages (an override replaces it, so it must show)', () => {
    const page = {
      path: '/attractions/x',
      label: 'X',
      defaultTitle: 'X — Visitor Guide',
      defaultDescription: 'd',
      templated: true,
    };
    expect(effectiveDefaultTitle(page)).toBe(`X — Visitor Guide${BRAND_SUFFIX}`);
  });

  it('leaves an already-absolute title alone', () => {
    const page = {
      path: '/',
      label: 'Home',
      defaultTitle: 'Belle Mare Tours — Mauritius Tours',
      defaultDescription: 'd',
    };
    expect(effectiveDefaultTitle(page)).toBe('Belle Mare Tours — Mauritius Tours');
  });

  it('the hand-written registry is absolute-titled — every entry already carries its own brand', () => {
    for (const page of SEO_PAGES) expect(page.templated).toBeUndefined();
  });
});

describe('buildSeoPageGroups', () => {
  it('covers the core registry plus the three content-module families', async () => {
    const groups = await buildSeoPageGroups();
    expect(groups.map((g) => g.key)).toEqual(['core', 'destinations', 'transfers', 'attractions']);
    expect(groups.every((g) => g.pages.length > 0)).toBe(true);
  });

  it('marks the content-module pages as template-branded, and the core registry as not', async () => {
    const groups = await buildSeoPageGroups();
    const byKey = Object.fromEntries(groups.map((g) => [g.key, g]));
    expect(byKey.core!.pages.every((p) => !p.templated)).toBe(true);
    for (const key of ['destinations', 'transfers', 'attractions']) {
      expect(byKey[key]!.pages.every((p) => p.templated === true)).toBe(true);
    }
  });

  it('never lists the same path twice — two cards would silently overwrite each other', async () => {
    const groups = await buildSeoPageGroups();
    const paths = groups.flatMap((g) => g.pages.map((p) => p.path));
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('lists only real, root-relative paths', async () => {
    const groups = await buildSeoPageGroups();
    for (const p of groups.flatMap((g) => g.pages)) {
      expect(p.path.startsWith('/')).toBe(true);
      expect(p.path).not.toContain('[');
      expect(p.label.trim()).not.toBe('');
      expect(p.defaultTitle.trim()).not.toBe('');
    }
  });

  it('leaves tours and blog posts out — each already has its own editor', async () => {
    const groups = await buildSeoPageGroups();
    const paths = groups.flatMap((g) => g.pages.map((p) => p.path));
    expect(paths.some((p) => p.startsWith('/activities/'))).toBe(false);
    expect(paths.some((p) => p.startsWith('/blog/'))).toBe(false);
  });

  it('degrades to the other groups when the attraction fetch fails', async () => {
    vi.mocked(loadPlaces).mockRejectedValue(new Error('db down'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const groups = await buildSeoPageGroups();
    expect(groups.map((g) => g.key)).toEqual(['core', 'destinations', 'transfers']);
    spy.mockRestore();
  });
});
