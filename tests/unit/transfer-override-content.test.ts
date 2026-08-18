import { describe, expect, it } from 'vitest';
import { getTransfer, genericTransferFaq, transfers } from '../../src/lib/content/transfers';

/**
 * Bug 3: when an unlisted hotel snaps to a listed one (?hotel= handoff), the page reads as the
 * guest's hotel but reused the LISTED hotel's FAQ — one of which names that hotel/area, contradicting
 * the H1. genericTransferFaq is the trim that keeps the override view coherent.
 */
describe('genericTransferFaq', () => {
  it('drops the entry that names the listed hotel / area (pearle-beach)', () => {
    const pearle = getTransfer('pearle-beach');
    expect(pearle).not.toBeNull();
    const generic = genericTransferFaq(pearle!);

    // At least the "how long to <hotel> in <area>" Q&A is removed.
    expect(generic.length).toBeLessThan(pearle!.faq.length);
    // Nothing left names the hotel or its area.
    const hay = generic.map((f) => `${f.q} ${f.a}`.toLowerCase());
    expect(hay.some((h) => h.includes('pearle beach'))).toBe(false);
    expect(hay.some((h) => h.includes('flic-en-flac'))).toBe(false);
    // The genuinely generic reassurance survives.
    expect(hay.some((h) => h.includes('flight'))).toBe(true);
  });

  it('never leaks the listed hotel name or area for ANY transfer', () => {
    for (const t of transfers) {
      const hotel = t.hotelName.toLowerCase();
      const area = t.area.toLowerCase();
      for (const f of genericTransferFaq(t)) {
        const hay = `${f.q} ${f.a}`.toLowerCase();
        expect(hay.includes(hotel), `${t.slug} FAQ still names the hotel`).toBe(false);
        expect(hay.includes(area), `${t.slug} FAQ still names the area`).toBe(false);
      }
    }
  });
});
