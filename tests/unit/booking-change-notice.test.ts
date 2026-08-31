import { describe, expect, it } from 'vitest';
import {
  renderChangeAppliedNotice,
  type ChangeAppliedNoticeInput,
} from '@/lib/email/booking-change';

/**
 * `renderChangeAppliedNotice` — the downgrade's immediate, PDF-less notice. Must NEVER carry an
 * invoice concept (no total/paid/balance table): the one property tests here that actually matters
 * is that this stays a lightweight shell, since money-timing correctness depends on this template
 * never being confused with the invoice-with-PDF pipeline.
 */

function base(): ChangeAppliedNoticeInput {
  return {
    customerName: 'Jean Dupont',
    ref: 'BMT-1042',
    locale: 'en',
    summary: {
      currency: 'EUR',
      fromActivityTitle: 'Full Day 5 Islands tour Ile Aux Cerfs with Lunch',
      fromOptionName: 'Standard',
      fromStartsAt: '2026-09-21T08:00:00Z',
      fromTotalEur: 160,
      toActivityTitle: 'Full Day Speed Boat Ile Aux Cerf with Lunch',
      toOptionName: 'Standard',
      toStartsAt: '2026-09-21T08:00:00Z',
      toTotalEur: 110,
      differenceEur: -50,
      refundStatus: 'pending' as const,
    },
  };
}

describe('renderChangeAppliedNotice', () => {
  it('names the booking ref and both tours', () => {
    const { subject, html, text } = renderChangeAppliedNotice(base());
    expect(subject).toContain('BMT-1042');
    expect(html).toContain('Full Day 5 Islands');
    expect(html).toContain('Full Day Speed Boat');
    expect(text).toContain('Full Day 5 Islands');
  });

  it('promises the refund, and carries no invoice/PDF language at all', () => {
    const { html, text } = renderChangeAppliedNotice(base());
    // The apostrophe is HTML-escaped (We&#39;ll) by escapeHtml — check the unescaped tail instead.
    expect(html).toContain('refund the difference');
    expect(text).toContain("We'll refund the difference");
    // The invoice email's own vocabulary must never leak into this one — that vocabulary appearing
    // here would be a sign this got wired through the wrong enrich path.
    for (const word of ['invoice', 'PDF', 'VAT', 'Balance due', 'Amount paid']) {
      expect(html.toLowerCase()).not.toContain(word.toLowerCase());
    }
  });

  it('escapes a hostile customer name', () => {
    const input = base();
    input.customerName = '<script>alert(1)</script>';
    const { html } = renderChangeAppliedNotice(input);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('falls back to English for an unrecognised locale', () => {
    const input = base();
    // `locale` is typed `Locale | string | null` on purpose (mirrors pickup.ts) — a bad/legacy
    // stored value is a real runtime case, not a type error.
    input.locale = 'de';
    const { html } = renderChangeAppliedNotice(input);
    expect(html).toContain('Your tour has changed');
  });

  it('renders correctly in French', () => {
    const input = base();
    input.locale = 'fr';
    const { html, text } = renderChangeAppliedNotice(input);
    expect(html).not.toContain('Your tour has changed');
    expect(text.length).toBeGreaterThan(0);
  });
});
