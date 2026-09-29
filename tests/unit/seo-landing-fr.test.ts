import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';
import { renderToStaticMarkup } from 'react-dom/server';

/* French search snippets for the landing pages (Search Console, Sep 2026: /fr/mauritius-catamaran-
 * cruise sat at #46 for "catamaran ile maurice" with an English title) and same-language footer
 * links, which are what give the French hubs internal links from the 237 French pages. */

vi.mock('@/lib/services/seo', () => ({ getSeoMeta: vi.fn() }));
vi.mock('@/lib/http/context', () => ({ publicServiceContext: () => ({}) }));
vi.mock('@/lib/i18n/server', () => ({
  getLocale: vi.fn(async () => 'en'),
  getT: vi.fn(async () => (s: string) => s),
}));
vi.mock('@/lib/settings/whatsapp-number', () => ({ getWhatsAppNumber: async () => '23000000' }));

import { getSeoMeta } from '@/lib/services/seo';
import { getLocale } from '@/lib/i18n/server';
import { overrideMetadata } from '@/lib/seo/override';
import { LANDING_META_FR } from '@/lib/seo/landing-fr';
import { SNIPPET_MAX } from '@/lib/seo/snippet';
import { SiteFooter } from '@/components/site/SiteFooter';

const DEFAULTS: Metadata = {
  title: { absolute: 'English Title' },
  description: 'English description',
  openGraph: { type: 'website', title: 'English Title', description: 'English description' },
};
const FR = { title: 'Titre français', description: 'Description française' };

beforeEach(() => vi.mocked(getSeoMeta).mockReset());

describe('overrideMetadata with French meta', () => {
  it('uses the French title and description on /fr', async () => {
    vi.mocked(getLocale).mockResolvedValueOnce('fr');
    vi.mocked(getSeoMeta).mockResolvedValue(null);
    const m = await overrideMetadata('/rent', DEFAULTS, FR);
    expect(m.title).toEqual({ absolute: FR.title });
    expect(m.description).toBe(FR.description);
    expect(m.openGraph).toMatchObject({ ...FR, locale: 'fr_FR' });
  });

  it('keeps the French text over an English /admin/seo override, but takes its OG image', async () => {
    vi.mocked(getLocale).mockResolvedValueOnce('fr');
    vi.mocked(getSeoMeta).mockResolvedValue({
      path: '/rent',
      title: 'Admin English Title',
      description: 'Admin English description',
      ogImageUrl: 'https://img.example/og.jpg',
    });
    const m = await overrideMetadata('/rent', DEFAULTS, FR);
    expect(m.title).toEqual({ absolute: FR.title });
    expect(m.description).toBe(FR.description);
    expect(m.openGraph).toMatchObject({
      title: FR.title,
      images: [{ url: 'https://img.example/og.jpg' }],
    });
  });

  it('leaves English untouched, override included', async () => {
    vi.mocked(getSeoMeta).mockResolvedValue({
      path: '/rent',
      title: 'Admin English Title',
      description: null,
      ogImageUrl: null,
    });
    const m = await overrideMetadata('/rent', DEFAULTS, FR);
    expect(m.title).toEqual({ absolute: 'Admin English Title' });
    expect(m.description).toBe('English description');
  });
});

describe('LANDING_META_FR', () => {
  it('covers real landing pages only', () => {
    for (const path of Object.keys(LANDING_META_FR)) {
      expect(existsSync(`app/(site)${path}/page.tsx`), path).toBe(true);
    }
  });

  it('says "île Maurice" and fits the search result', () => {
    for (const [path, { title, description }] of Object.entries(LANDING_META_FR)) {
      expect(title, path).toMatch(/[îÎ]le Maurice/);
      expect(title.length, path).toBeLessThanOrEqual(60);
      expect(description.length, path).toBeLessThanOrEqual(SNIPPET_MAX);
    }
  });
});

describe('SiteFooter links', () => {
  const hrefs = async () =>
    [...renderToStaticMarkup(await SiteFooter()).matchAll(/href="([^"]+)"/g)].map((m) => m[1]!);

  it('point at the French pages on /fr, except the English-only legal pages', async () => {
    vi.mocked(getLocale).mockResolvedValueOnce('fr');
    const internal = (await hrefs()).filter((h) => h.startsWith('/'));
    expect(internal).toContain('/fr/mauritius-catamaran-cruise');
    expect(internal).toContain('/fr/activities?category=Sea%20walks%20%26%20diving');
    for (const legal of ['/terms', '/privacy', '/refunds']) expect(internal).toContain(legal);
    // The logo (a shared component, links home) and its image are not footer column links.
    const unprefixed = internal.filter(
      (h) => !h.startsWith('/fr') && h !== '/' && !h.includes('.'),
    );
    expect(unprefixed.sort()).toEqual(['/privacy', '/refunds', '/terms']);
  });

  it('stay English on English pages', async () => {
    const internal = (await hrefs()).filter((h) => h.startsWith('/'));
    expect(internal).toContain('/mauritius-catamaran-cruise');
    expect(internal.some((h) => h.startsWith('/fr'))).toBe(false);
  });
});
