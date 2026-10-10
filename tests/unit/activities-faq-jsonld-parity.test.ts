import { describe, expect, it, vi } from 'vitest';
import { JsonLd } from '@/components/seo/JsonLd';
import { FaqAccordion } from '@/components/seo/LandingSections';
import type { Locale } from '@/lib/i18n/config';

/**
 * /activities is the page meant to rank for "Mauritius activities". Its FAQ used to be one English
 * array, so /fr/activities showed English questions and served English FAQPage JSON-LD. Same check as
 * landing-faq-jsonld-parity: the visible accordion and the structured data get the SAME array, in the
 * visitor's language.
 */

const localeRef = vi.hoisted(() => ({ current: 'en' as Locale }));

vi.mock('@/lib/i18n/server', () => ({
  getT: async () => (key: string) => key,
  getLocale: async () => localeRef.current,
}));
vi.mock('@/lib/http/context', () => ({ publicServiceContext: () => ({}) }));
vi.mock('@/lib/services/activities', () => ({
  searchActivities: async () => ({ items: [], total: 0 }),
}));

const { default: ActivitiesPage } = await import('../../app/(site)/activities/page');

type FiberLike = { type: unknown; props: Record<string, unknown> };

function isElement(node: unknown): node is FiberLike {
  return !!node && typeof node === 'object' && 'type' in node && 'props' in node;
}

function findAll(node: unknown, target: unknown, out: FiberLike[] = []): FiberLike[] {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, target, out);
    return out;
  }
  if (!isElement(node)) return out;
  if (node.type === target) out.push(node);
  findAll(node.props?.children, target, out);
  return out;
}

async function faqPairsFor(locale: Locale) {
  localeRef.current = locale;
  const tree = await ActivitiesPage({ searchParams: Promise.resolve({}) });

  const accordionEls = findAll(tree, FaqAccordion);
  expect(accordionEls).toHaveLength(1);
  const visibleItems = accordionEls[0]!.props.items as { q: string; a: string }[];

  const faqJsonLdEls = findAll(tree, JsonLd).filter(
    (el) => (el.props.data as Record<string, unknown>)?.['@type'] === 'FAQPage',
  );
  expect(faqJsonLdEls).toHaveLength(1);
  const mainEntity = (faqJsonLdEls[0]!.props.data as { mainEntity: unknown[] }).mainEntity as {
    name: string;
    acceptedAnswer: { text: string };
  }[];
  return {
    visibleItems,
    jsonLdItems: mainEntity.map((m) => ({ q: m.name, a: m.acceptedAnswer.text })),
  };
}

describe('FAQ visible text matches FAQPage JSON-LD (/activities)', () => {
  it('matches in English', async () => {
    const { visibleItems, jsonLdItems } = await faqPairsFor('en');
    expect(visibleItems.length).toBeGreaterThan(0);
    expect(jsonLdItems).toEqual(visibleItems);
    expect(visibleItems[0]!.q).toBe('What activities can I book in Mauritius?');
  });

  it('is French on /fr, in both the accordion and the JSON-LD', async () => {
    const { visibleItems, jsonLdItems } = await faqPairsFor('fr');
    expect(jsonLdItems).toEqual(visibleItems);
    expect(visibleItems[0]!.q).not.toBe('What activities can I book in Mauritius?');
    expect(visibleItems.every((f) => f.q.endsWith(' ?'))).toBe(true);
  });

  it('has the same number of FAQ entries in both locales', async () => {
    const en = await faqPairsFor('en');
    const fr = await faqPairsFor('fr');
    expect(fr.visibleItems).toHaveLength(en.visibleItems.length);
  });
});
