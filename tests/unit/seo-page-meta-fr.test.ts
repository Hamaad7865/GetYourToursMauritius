import { existsSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Metadata } from 'next';
import { renderToStaticMarkup } from 'react-dom/server';

/* French search snippets for public pages (Search Console, Sep 2026: /fr/mauritius-catamaran-
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
import { PAGE_META_FR } from '@/lib/seo/page-meta-fr';
import { getTransfer, transferMetaFr } from '@/lib/content/transfers';
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

describe('PAGE_META_FR', () => {
  it('covers real pages only', () => {
    for (const path of Object.keys(PAGE_META_FR)) {
      const file = path === '/' ? 'app/(site)/page.tsx' : `app/(site)${path}/page.tsx`;
      expect(existsSync(file), path).toBe(true);
    }
  });

  it('is picked up by path, with no per-page wiring', async () => {
    vi.mocked(getLocale).mockResolvedValueOnce('fr');
    vi.mocked(getSeoMeta).mockResolvedValue(null);
    const m = await overrideMetadata('/mauritius-catamaran-cruise', DEFAULTS);
    expect(m.title).toEqual({ absolute: PAGE_META_FR['/mauritius-catamaran-cruise']!.title });
  });

  it('says "île Maurice" where it targets a search, and fits the search result', () => {
    for (const [path, { title, description }] of Object.entries(PAGE_META_FR)) {
      if (path !== '/cookies') expect(title, path).toMatch(/[îÎ]le Maurice/);
      expect(title.length, path).toBeLessThanOrEqual(60);
      expect(description.length, path).toBeLessThanOrEqual(SNIPPET_MAX);
    }
  });
});

describe('transferMetaFr', () => {
  it('writes the hotel transfer snippet in French with the live price', () => {
    const t = getTransfer('lux-belle-mare')!;
    const { title, description } = transferMetaFr(t, 55);
    expect(title).toBe('Transfert aéroport vers LUX* Belle Mare : dès 55 €');
    expect(description).toMatch(/^Transfert privé de l’aéroport SSR à LUX\* Belle Mare/);
    expect(description.length).toBeLessThanOrEqual(SNIPPET_MAX);
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
