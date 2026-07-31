import { describe, expect, it, vi } from 'vitest';
import { JsonLd } from '@/components/seo/JsonLd';
import { FaqAccordion } from '@/components/seo/LandingSections';
import type { Locale } from '@/lib/i18n/config';

/**
 * The whole point of Task 10c: the FAQ text rendered on a landing page and the FAQ text embedded in
 * its FAQPage JSON-LD must be THE SAME STRINGS, in whichever locale the visitor is on. If they ever
 * diverge — someone edits one array but not the other, or feeds a different variable to each consumer
 * — the structured data becomes invalid per Google's FAQPage guidelines, and nothing else catches it.
 *
 * This test exercises the real page module (not a mock of it): it calls the page's default export
 * directly and walks the returned React element tree — without a DOM or a Next.js request context —
 * to find the actual props handed to <FaqAccordion> and to the FAQPage <JsonLd>, for both locales.
 */

const localeRef = vi.hoisted(() => ({ current: 'en' as Locale }));

vi.mock('@/lib/i18n/server', () => ({
  getT: async () => (key: string) => key,
  getLocale: async () => localeRef.current,
}));
vi.mock('@/lib/seo/landing', () => ({
  featuredActivities: async () => [],
}));

const { default: MauritiusToursPage } = await import('../../app/(site)/mauritius-tours/page');

type FiberLike = { type: unknown; props: Record<string, unknown> };

function isElement(node: unknown): node is FiberLike {
  return !!node && typeof node === 'object' && 'type' in node && 'props' in node;
}

/** Depth-first search of a React element tree (as plain, un-rendered element objects) for every
 *  element whose `type` matches `target`. Never invokes any component function — JSX children are
 *  already fully-constructed data by the time a parent component would run, so this finds the exact
 *  props a component was given without needing to render anything. */
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
  const tree = await MauritiusToursPage();

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
  const jsonLdItems = mainEntity.map((m) => ({ q: m.name, a: m.acceptedAnswer.text }));

  return { visibleItems, jsonLdItems };
}

describe('FAQ visible text matches FAQPage JSON-LD (/mauritius-tours)', () => {
  it('matches in English', async () => {
    const { visibleItems, jsonLdItems } = await faqPairsFor('en');
    expect(visibleItems.length).toBeGreaterThan(0);
    expect(jsonLdItems).toEqual(visibleItems);
    // Sanity: this is really the known English copy, not an empty/placeholder array.
    expect(visibleItems[0]!.q).toBe('What tours are most popular in Mauritius?');
  });

  it('matches in French', async () => {
    const { visibleItems, jsonLdItems } = await faqPairsFor('fr');
    expect(visibleItems.length).toBeGreaterThan(0);
    expect(jsonLdItems).toEqual(visibleItems);
    // Sanity: this is really translated, not the English copy silently reused.
    expect(visibleItems[0]!.q).not.toBe('What tours are most popular in Mauritius?');
    expect(visibleItems[0]!.q.endsWith(' ?')).toBe(true);
  });

  it('has the same number of FAQ entries in both locales', async () => {
    const en = await faqPairsFor('en');
    const fr = await faqPairsFor('fr');
    expect(fr.visibleItems).toHaveLength(en.visibleItems.length);
  });
});
