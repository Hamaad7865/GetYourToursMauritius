import { describe, expect, it } from 'vitest';
import {
  buildInvoice,
  type InvoiceBookingInput,
  type InvoicePaymentInput,
} from '@/lib/invoice/model';
import { INVOICE_BUSINESS } from '@/lib/invoice/business';
import { renderConfirmationEmail } from '@/lib/email/booking-confirmation';
import { renderReviewRequestEmail } from '@/lib/email/review-request';
import { renderVoucherPdf } from '@/lib/invoice/voucher-pdf';
import { renderInvoicePdf } from '@/lib/invoice/pdf';
import { formatLocaleDate } from '@/lib/i18n/format';

/**
 * The guest's language, not the sender's. These render from a cron worker whose own locale is
 * meaningless, so the booking's stored locale is the only correct source.
 */

const payment: InvoicePaymentInput = {
  chargedAmountMinor: 20700,
  chargedCurrency: 'USD',
  paidAt: '2026-06-20T10:00:00Z',
  providerRef: 'pe_123',
};

function bookingInput(over: Partial<InvoiceBookingInput> = {}): InvoiceBookingInput {
  return {
    ref: 'BMT-1042',
    customerName: 'Jean Dupont',
    customerEmail: 'jean@example.com',
    currency: 'EUR',
    totalEur: 191,
    activityTitle: 'Catamaran Cruise to Île aux Cerfs',
    when: '2026-08-09T06:00:00Z',
    pickupLocation: 'Le Touessrok Resort',
    dropoffLocation: null,
    items: [{ priceLabel: 'Adult', quantity: 3, pax: null, subtotalEur: 191 }],
    ...over,
  };
}

function transferBookingInput(over: Partial<InvoiceBookingInput> = {}): InvoiceBookingInput {
  return bookingInput({
    ref: 'BMT-TR1',
    activityTitle: 'Airport transfer',
    totalEur: 35,
    pickupLocation: 'SSR International Airport',
    dropoffLocation: 'Shandrani Beachcomber',
    transfer: { direction: 'arrival', flightNumber: 'BA123', arrivalTime: '13:40' },
    items: [{ priceLabel: 'Standard car', quantity: 1, pax: 2, subtotalEur: 35 }],
    ...over,
  });
}

describe('renderConfirmationEmail — locale', () => {
  it('renders French copy for a booking with locale "fr"', () => {
    const model = buildInvoice(bookingInput({ locale: 'fr' }), payment, INVOICE_BUSINESS);
    const { html, text } = renderConfirmationEmail(model);

    expect(html).toContain('Votre réservation est confirmée');
    expect(html).toContain('Réf. réservation');
    expect(html).toContain('Activité');
    expect(html).toContain('Total');
    expect(text).toContain('Bonjour Jean Dupont,');
    expect(text).toContain('Bonne nouvelle');
  });

  it('renders English copy for a booking with locale "en"', () => {
    const model = buildInvoice(bookingInput({ locale: 'en' }), payment, INVOICE_BUSINESS);
    const { html, text } = renderConfirmationEmail(model);

    expect(html).toContain('Your booking is confirmed');
    expect(html).toContain('Booking ref');
    expect(html).not.toContain('Réf. réservation');
    expect(text).toContain('Hi Jean Dupont,');
    expect(text).toContain('Good news');
  });

  it('renders the French transfer-direction + e-voucher copy for a French airport-transfer booking', () => {
    const model = buildInvoice(transferBookingInput({ locale: 'fr' }), payment, INVOICE_BUSINESS);
    const { html } = renderConfirmationEmail(model, 'https://bellemaretours.com/bookings/BMT-TR1');

    expect(html).toContain('Arrivée (aéroport → hôtel)');
    expect(html).toContain('Voir et télécharger votre e-bon');
  });

  it('falls back to English for an unrecognised locale value rather than throwing', () => {
    const model = buildInvoice(bookingInput({ locale: 'de' as never }), payment, INVOICE_BUSINESS);
    expect(() => renderConfirmationEmail(model)).not.toThrow();
    const { html } = renderConfirmationEmail(model);
    expect(html).toContain('Your booking is confirmed');
  });

  it('falls back to English when locale is entirely absent from the booking input', () => {
    const model = buildInvoice(bookingInput(), payment, INVOICE_BUSINESS);
    expect(() => renderConfirmationEmail(model)).not.toThrow();
    expect(renderConfirmationEmail(model).html).toContain('Your booking is confirmed');
  });

  it('never translates or reformats the booking reference, and never touches the currency figure', () => {
    const fr = renderConfirmationEmail(
      buildInvoice(bookingInput({ locale: 'fr' }), payment, INVOICE_BUSINESS),
    );
    const en = renderConfirmationEmail(
      buildInvoice(bookingInput({ locale: 'en' }), payment, INVOICE_BUSINESS),
    );
    expect(fr.html).toContain('BMT-1042');
    expect(en.html).toContain('BMT-1042');
    // Currency + amount are identical, byte-for-byte, in both locales.
    expect(fr.html).toContain('EUR 191.00');
    expect(en.html).toContain('EUR 191.00');
  });
});

describe('renderReviewRequestEmail — locale', () => {
  const input = {
    customerName: 'Alex Guest',
    activityTitle: 'Dolphin Swim',
    siteReviewUrl: 'https://bellemaretours.com/reviews/write?token=abc123',
    googleReviewUrl: 'https://g.page/r/test-review-link/review',
  };

  it('renders French for locale "fr"', () => {
    const { subject, html } = renderReviewRequestEmail({ ...input, locale: 'fr' });
    expect(subject).toContain('Comment s’est passé votre Dolphin Swim');
    expect(html).toContain('Laissez un avis sur notre site');
  });

  it('renders English for locale "en"', () => {
    const { subject, html } = renderReviewRequestEmail({ ...input, locale: 'en' });
    expect(subject).toContain('How was your Dolphin Swim');
    expect(html).toContain('Review us on our site');
  });

  it('falls back to English for a missing/unrecognised locale rather than throwing', () => {
    expect(() => renderReviewRequestEmail({ ...input, locale: null })).not.toThrow();
    expect(() => renderReviewRequestEmail({ ...input, locale: 'xx' })).not.toThrow();
    expect(renderReviewRequestEmail({ ...input, locale: 'xx' }).html).toContain(
      'Review us on Google',
    );
  });
});

describe('renderVoucherPdf / renderInvoicePdf — locale threads through without throwing', () => {
  it('renders a real PDF for a French transfer booking', async () => {
    const model = buildInvoice(transferBookingInput({ locale: 'fr' }), payment, INVOICE_BUSINESS);
    const bytes = await renderVoucherPdf(model, 'https://bellemaretours.com/bookings/BMT-TR1');
    expect(String.fromCharCode(...bytes.subarray(0, 5))).toBe('%PDF-');
  });

  it('renders a real invoice PDF for a French booking', async () => {
    const model = buildInvoice(bookingInput({ locale: 'fr' }), payment, INVOICE_BUSINESS);
    const bytes = await renderInvoicePdf(model);
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('%PDF');
  });

  it('an unrecognised locale on the booking never breaks PDF rendering (falls back to English)', async () => {
    const model = buildInvoice(
      transferBookingInput({ locale: 'not-a-locale' as never }),
      payment,
      INVOICE_BUSINESS,
    );
    expect(model.locale).toBe('en');
    await expect(
      renderVoucherPdf(model, 'https://bellemaretours.com/bookings/BMT-TR1'),
    ).resolves.toBeInstanceOf(Uint8Array);
  });
});

describe('date formatting is per-locale (the voucher-pdf en-GB fix)', () => {
  // The historical bug: voucher-pdf.ts's leg-date formatter hardcoded toLocaleDateString('en-GB', …),
  // so every voucher showed English month names regardless of the guest's language. It now delegates to
  // this same shared formatLocaleDate() helper — this is the primitive that fix relies on.
  it('shows the French month name for a French locale, and the English abbreviation for English', () => {
    const iso = '2026-08-15T00:00:00Z';
    const opts = { day: 'numeric' as const, month: 'short' as const, year: 'numeric' as const };
    expect(formatLocaleDate(iso, 'fr', opts)).toContain('août');
    expect(formatLocaleDate(iso, 'en', opts)).toContain('Aug');
  });
});
