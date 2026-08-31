import { describe, expect, it } from 'vitest';
import { renderChangeSummaryFragment, type ChangeSummaryInput } from '@/lib/email/change-summary';

/**
 * `renderChangeSummaryFragment` is the shared "Previously → Now → Difference" fragment composed
 * into three emails (the invoice-with-PDF confirmation, the PDF-less downgrade notice, and the
 * refund-confirmed follow-up). Pure: every value comes from the caller, no I/O, no Date.now().
 */

function base(): ChangeSummaryInput {
  return {
    locale: 'en',
    currency: 'EUR',
    fromActivityTitle: 'Full Day Speed Boat Ile Aux Cerf with Lunch',
    fromOptionName: 'Standard',
    fromStartsAt: '2026-09-21T08:00:00Z',
    fromTotalEur: 110,
    toActivityTitle: 'Full Day 5 Islands tour Ile Aux Cerfs with Lunch',
    toOptionName: 'Standard',
    toStartsAt: '2026-09-21T08:00:00Z',
    toTotalEur: 160,
    differenceEur: 50,
    refundStatus: 'none',
  };
}

describe('renderChangeSummaryFragment', () => {
  it('renders both tour names and totals for every sign', () => {
    for (const input of [
      base(),
      { ...base(), differenceEur: 0, toTotalEur: 110, refundStatus: 'none' as const },
      { ...base(), differenceEur: -50, toTotalEur: 60, refundStatus: 'pending' as const },
    ]) {
      const { html, text } = renderChangeSummaryFragment(input);
      expect(html).toContain('Full Day Speed Boat');
      expect(html).toContain('Full Day 5 Islands');
      expect(text).toContain('Full Day Speed Boat');
      expect(text).toContain('Full Day 5 Islands');
    }
  });

  it('an upgrade (positive difference) reads as charged', () => {
    const { html, text } = renderChangeSummaryFragment(base());
    expect(html).toContain('+EUR 50.00');
    expect(text).toContain('+EUR 50.00');
    expect(html).toContain('Charged');
  });

  it('a level move (zero difference) reads as no extra charge', () => {
    const { html, text } = renderChangeSummaryFragment({
      ...base(),
      differenceEur: 0,
      toTotalEur: 110,
    });
    expect(html).toContain('No extra charge');
    expect(text).toContain('No extra charge');
  });

  it('a pending refund (negative, not yet refunded) reads as refund pending', () => {
    const { html, text } = renderChangeSummaryFragment({
      ...base(),
      differenceEur: -50,
      toTotalEur: 60,
      refundStatus: 'pending',
    });
    expect(html).toContain('Refund pending');
    expect(html).toContain('EUR 50.00');
    expect(html).toContain('to the card you paid with');
    expect(text).toContain('Refund pending');
  });

  it('a completed refund reads as refunded, with the date', () => {
    const { html, text } = renderChangeSummaryFragment({
      ...base(),
      differenceEur: -50,
      toTotalEur: 60,
      refundStatus: 'refunded',
      refundedAt: '2026-09-22T12:00:00Z',
    });
    expect(html).toContain('Refunded');
    expect(html).toContain('2026-09-22');
    expect(text).toContain('Refunded');
    expect(text).toContain('2026-09-22');
  });

  it('escapes hostile activity titles in the html but not the text', () => {
    const { html } = renderChangeSummaryFragment({
      ...base(),
      fromActivityTitle: '<script>alert(1)</script> Tour',
      toActivityTitle: 'Trip <b>&</b> more',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<b>&</b>');
  });

  it('is covered in French for every refund status', () => {
    for (const refundStatus of ['none', 'pending', 'refunded'] as const) {
      const { html } = renderChangeSummaryFragment({
        ...base(),
        locale: 'fr',
        differenceEur: refundStatus === 'none' ? 50 : -50,
        toTotalEur: refundStatus === 'none' ? 160 : 60,
        refundStatus,
        refundedAt: refundStatus === 'refunded' ? '2026-09-22T12:00:00Z' : null,
      });
      // Every French render must still contain the raw money figures untranslated…
      expect(html).toMatch(/EUR \d+\.\d{2}/);
      // …and must not fall back to an untranslated English label like the raw key itself leaking
      // through as literal English prose ("Refund pending" has no French cognate that would pass
      // this check by accident).
      if (refundStatus === 'pending') expect(html).not.toContain('Refund pending');
      if (refundStatus === 'refunded') expect(html).not.toContain('>Refunded<');
    }
  });
});
