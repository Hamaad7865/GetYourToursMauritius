import { describe, expect, it } from 'vitest';
import { INVOICE_BUSINESS } from '@/lib/invoice/business';
import { SITE } from '@/lib/seo/site';

/**
 * The address a customer is told to write to must be the MONITORED inbox.
 *
 * Two addresses exist and they are not interchangeable:
 *   - SITE.email (info@)      — a human reads it. Goes on the invoice, the legal pages, and the
 *                               Reply-To of every outbound message.
 *   - RESEND_FROM (bookings@) — the send-only transactional identity. Nobody reads it. Mail leaves
 *                               from it, which is exactly why replies are pointed away from it.
 *
 * Printing the sender as the contact address would tell every guest to write somewhere nobody looks —
 * silently, because the mail still sends and still looks right. Nothing enforced the distinction, and
 * three test fixtures actively asserted the wrong one, so a regression here would have gone green.
 */
describe('INVOICE_BUSINESS contact address', () => {
  it('is the monitored human inbox', () => {
    expect(INVOICE_BUSINESS.email).toBe(SITE.email);
    expect(INVOICE_BUSINESS.email).toBe('info@bellemaretours.com');
  });

  it('is NOT the send-only transactional identity', () => {
    expect(INVOICE_BUSINESS.email.startsWith('bookings@')).toBe(false);
  });

  it('carries the rest of the legal identity the invoice needs', () => {
    // A blank BRN/VAT on a Mauritius tax invoice is a compliance problem, not a cosmetic one.
    expect(INVOICE_BUSINESS.legalName).toBe(SITE.legalName);
    expect(INVOICE_BUSINESS.brn).toBeTruthy();
    expect(INVOICE_BUSINESS.vat).toBeTruthy();
    expect(INVOICE_BUSINESS.phone).toBe(SITE.phone);
  });
});
