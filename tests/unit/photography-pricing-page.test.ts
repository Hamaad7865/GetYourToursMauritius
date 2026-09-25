import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PricingGuideCard } from '@/components/photography/PricingGuideCard';
import { GalleryGrid, type GalleryItem } from '@/components/photography/GalleryGrid';
import type { PhotoPackage } from '@/components/photography/PackagesSection';

vi.mock('@/components/site/PreferencesProvider', () => ({
  useT: () => (key: string, vars?: Record<string, string>) =>
    key.replace(/\{(\w+)\}/g, (_, name: string) => vars?.[name] ?? name),
}));
vi.mock('@/components/site/Price', () => ({ Price: ({ eur }: { eur: number }) => `EUR ${eur}` }));

const pkg: PhotoPackage = {
  key: 'couple',
  group: 'shoots',
  title: 'Couples session',
  meta: '1 hour',
  features: [],
  summary: 'Photographs on the beach.',
  image: '/photography/couple.jpg',
  imageAlt: 'Couple on the beach',
  priceEur: 150,
  href: '/activities/couples-session',
  external: false,
  highlight: false,
  bestSeller: false,
};

describe('simple photography package cards', () => {
  const render = (value: PhotoPackage) =>
    renderToStaticMarkup(
      createElement(PricingGuideCard, {
        pkg: value,
        fromLabel: 'From',
        onRequestLabel: 'Price on request',
        ctaLabel: value.external ? 'Enquire' : 'See more',
        bestSellerLabel: 'Best seller',
      }),
    );

  it('preserves catalogue content, cover, real price and booking destination', () => {
    const html = render(pkg);
    for (const value of [pkg.title, pkg.summary!, pkg.image, pkg.href, 'EUR 150', 'See more']) {
      expect(html).toContain(value);
    }
    expect(html).not.toContain('target="_blank"');
  });

  it('keeps unpublished example packages as enquiries, not fictitious bookable prices', () => {
    const html = render({
      ...pkg,
      priceEur: null,
      external: true,
      href: 'https://wa.me/23057729919',
    });
    expect(html).toContain('Price on request');
    expect(html).toContain('Enquire');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('EUR 150');
  });
});

describe('preserved gallery preview', () => {
  const items: GalleryItem[] = [
    {
      key: 'a',
      kind: 'image',
      src: '/a.jpg',
      thumb: '/a.jpg',
      alt: 'Beach',
      categories: ['couples'],
      aspect: 'aspect-square',
    },
    {
      key: 'b',
      kind: 'video',
      src: 'https://www.youtube.com/watch?v=abcdefghijk',
      thumb: '/b.jpg',
      alt: 'Wedding film',
      categories: ['films'],
      aspect: 'aspect-video',
    },
  ];

  it('keeps photo/video controls and categories on the light background', () => {
    const html = renderToStaticMarkup(createElement(GalleryGrid, { items, tone: 'light' }));
    expect(html).toContain('Open photo: Beach');
    expect(html).toContain('Play video: Wedding film');
    expect(html).toContain('Couples');
    expect(html).toContain('Films');
    expect(html).toContain('bg-teal-dark text-white');
  });

  it('filters before limiting so every category can have a preview', () => {
    const html = renderToStaticMarkup(
      createElement(GalleryGrid, { items, limit: 1, initialFilter: 'films', tone: 'light' }),
    );
    expect(html).toContain('Play video: Wedding film');
    expect(html).not.toContain('Open photo: Beach');
  });
});
