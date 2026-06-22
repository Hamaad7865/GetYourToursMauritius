import { SITE } from '@/lib/seo/site';

/**
 * The business identity block `buildInvoice` expects, projected from the site-wide SITE constant.
 * Shared by the notification drain (emailed invoice) and the on-demand invoice download endpoint so
 * both render an identical document.
 */
export const INVOICE_BUSINESS = {
  legalName: SITE.legalName,
  brn: SITE.brn,
  vat: SITE.vat,
  street: SITE.street,
  locality: SITE.locality,
  region: SITE.region,
  country: SITE.country,
  email: SITE.email,
  phone: SITE.phone,
};
