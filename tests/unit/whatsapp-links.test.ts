import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { whatsappUrl, SITE } from '@/lib/seo/site';

/**
 * Two footer buttons labelled "Chat on WhatsApp" and "WhatsApp us" shipped with `href="#whatsapp"`
 * — which was the footer's OWN id. Clicking them scrolled to the footer and did nothing else, so
 * the site's most prominent contact route was dead while looking completely normal in review: the
 * markup was valid, the anchor target existed, and nothing errored.
 *
 * These assertions are deliberately about the SOURCE of every WhatsApp entry point, because the
 * failure mode is a link that is well-formed but points at the wrong place.
 */
const ROOT = new URL('../../', import.meta.url).pathname.replace(/^\/([a-z]:)/i, '$1');

/**
 * Source with comments stripped. These assertions scan text, so a comment that merely QUOTES the old
 * broken markup while explaining the fix would otherwise fail the very test documenting it.
 */
const read = (f: string): string =>
  readFileSync(`${ROOT}${f}`, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

const ENTRY_POINTS = [
  'src/components/site/SiteFooter.tsx',
  'src/components/site/WhatsAppFloat.tsx',
];

describe('whatsappUrl', () => {
  it('builds a wa.me deep link from the site phone number, digits only', () => {
    const url = whatsappUrl('hello');
    expect(url).toBe(`https://wa.me/${SITE.phone.replace(/[^\d]/g, '')}?text=hello`);
    expect(url).toMatch(/^https:\/\/wa\.me\/\d{8,15}\?/);
  });

  it('percent-encodes the message so punctuation cannot truncate it', () => {
    expect(whatsappUrl('Hi! A & B?')).toContain('text=Hi!%20A%20%26%20B%3F');
  });
});

describe('WhatsApp entry points', () => {
  // The specific regression: an in-page anchor standing in for a real deep link.
  it('never points a WhatsApp control at an in-page anchor', () => {
    for (const file of ENTRY_POINTS) {
      expect(read(file), `${file} still links WhatsApp to a page fragment`).not.toMatch(
        /href=["']#/,
      );
    }
  });

  it('has no element left claiming the #whatsapp anchor', () => {
    for (const file of ENTRY_POINTS) {
      expect(read(file), `${file} still defines the dead #whatsapp target`).not.toContain(
        'id="whatsapp"',
      );
    }
  });

  it('routes every entry point through whatsappUrl() rather than a hardcoded number', () => {
    for (const file of ENTRY_POINTS) {
      const src = read(file);
      expect(src, `${file} does not use whatsappUrl()`).toContain('whatsappUrl(');
      expect(src, `${file} hardcodes a wa.me URL`).not.toMatch(/["']https:\/\/wa\.me\//);
    }
  });

  // An off-site link opened in the same tab loses the visitor's place in the booking flow.
  it('opens off-site WhatsApp links in a new tab, safely', () => {
    for (const file of ENTRY_POINTS) {
      const src = read(file);
      expect(src).toContain('target="_blank"');
      expect(src).toContain('rel="noopener noreferrer"');
    }
  });
});
