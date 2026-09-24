import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PHOTOGRAPHY_BENEFITS, PHOTOGRAPHY_INFORMATION } from '@/lib/catalogue/photography-content';
import { fr } from '@/lib/i18n/messages';
import { PhotographyBenefits } from '@/components/photography/PhotographyInformation';
import { Faq } from '@/components/catalogue/Faq';

vi.mock('@/lib/i18n/server', () => ({
  getT: async () => (key: string) => key,
}));

describe('shared photography information', () => {
  it('renders all four benefits from the shared constants', async () => {
    const html = renderToStaticMarkup(await PhotographyBenefits());
    expect(PHOTOGRAPHY_BENEFITS).toHaveLength(4);
    expect(html.match(/<article>/g)).toHaveLength(4);
    for (const benefit of PHOTOGRAPHY_BENEFITS) {
      expect(html).toContain(benefit.title);
      expect(html).toContain(benefit.body);
    }
  });

  it('uses keyboard-accessible native accordions for every useful-information item', async () => {
    const html = renderToStaticMarkup(await Faq({ items: [...PHOTOGRAPHY_INFORMATION] }));
    expect(html.match(/<details/g)).toHaveLength(5);
    expect(html.match(/<summary/g)).toHaveLength(5);
    for (const item of PHOTOGRAPHY_INFORMATION) {
      expect(html).toContain(item.q);
      expect(html).toContain(item.a);
    }
  });

  it('keeps the existing deposit terms without adding unapproved refund or timing promises', () => {
    const terms = PHOTOGRAPHY_INFORMATION.find((item) => item.q === 'Payment and cancellation');
    expect(terms?.a).toContain('50% deposit');
    expect(terms?.a).toContain('non-refundable');
    expect(terms?.a).toContain('remaining 50% is due when your photos are delivered');
    const content = JSON.stringify([PHOTOGRAPHY_INFORMATION, PHOTOGRAPHY_BENEFITS]);
    expect(content).not.toMatch(/70%|96 hours|4.days|4.6 weeks/);
  });

  it('translates every dynamic constant key rather than silently falling back to English', () => {
    const keys = [
      'Why take photos with us?',
      'Useful information',
      ...PHOTOGRAPHY_BENEFITS.flatMap((item) => [item.title, item.body]),
      ...PHOTOGRAPHY_INFORMATION.flatMap((item) => [item.q, item.a]),
    ];
    for (const key of keys) {
      expect(fr[key], key).toBeTruthy();
      expect(fr[key], key).not.toBe(key);
    }
  });
});
