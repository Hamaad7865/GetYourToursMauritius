import { SITE } from '@/lib/seo/site';
import type { DocumentIssuer } from '@/lib/documents/model';

/**
 * Our own identity as it prints on a document, projected from the site-wide SITE constant. Distinct
 * from `INVOICE_BUSINESS` (the booking-invoice issuer) on two cosmetic points that matter on a
 * client-facing document: `locality` is dropped because SITE.street already ends in "Belle Mare"
 * (so the address does not read "…, Belle Mare, Belle Mare, …"), and the country is spelled out
 * ("Mauritius") rather than the ISO code SITE.country carries for schema.org.
 *
 * Frozen onto a document as its `issuer_snapshot` at issue time, so a later change to SITE never
 * alters an already-issued document.
 */
export const DOCUMENT_ISSUER: DocumentIssuer = {
  legalName: SITE.legalName,
  brn: SITE.brn,
  vat: SITE.vat,
  street: SITE.street,
  locality: null,
  region: SITE.region,
  country: 'Mauritius',
  email: SITE.email,
  phone: SITE.phone,
};
