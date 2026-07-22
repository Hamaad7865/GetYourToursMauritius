/** Site-wide identity for SEO, JSON-LD and the footer. The site IS the operator's own brand — there is
 *  no separate platform name (the old pre-rebrand identity was retired; `name` === `operator`). */
export const SITE = {
  name: 'Belle Mare Tours',
  operator: 'Belle Mare Tours',
  /** Registered legal entity behind the brand (used on legal pages + the footer). */
  legalName: 'Belle Mare Tours Ltd',
  /** Mauritius Business Registration Number. */
  brn: 'C09091906',
  /** VAT registration number. */
  vat: '20529965',
  /**
   * The HUMAN inbox — where customers actually write to us. Shown on /contact, the legal pages
   * (privacy/terms/refunds/help/cookies) and the invoice, used as the Reply-To on every outbound
   * email, and the owner-alert fallback when OWNER_NOTIFY_EMAIL is unset.
   *
   * NOT the sender. Transactional mail goes OUT as `RESEND_FROM`
   * (Belle Mare Tours <bookings@bellemaretours.com>) — a send-only identity nobody monitors, which is
   * why replies to it are pointed back here.
   */
  email: 'info@bellemaretours.com',
  description:
    "Belle Mare Tours — book direct with the operator. Catamaran cruises, dolphin swims, sea walks and island days on Mauritius's east coast, plus airport transfers and car rental. No reseller markup.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  phone: '+230 5772 9919',
  street: 'Royal Road, Belle Mare',
  locality: 'Belle Mare',
  region: 'Flacq',
  country: 'MU',
  geo: { lat: -20.1944, lng: 57.7706 },
  priceRange: 'EUR 30–240',
  languages: ['en', 'fr'] as const,
  /**
   * Independent profiles for the SAME business. These are the source for schema.org `sameAs`, which
   * is how Google resolves the string "Belle Mare Tours" to this company rather than to the village
   * of Belle Mare — our brand name collides head-on with the place name (`locality` below IS
   * 'Belle Mare'), so corroborating profiles do real work on brand queries.
   *
   * Add each new profile here as it is claimed (Google Business Profile, Facebook, Instagram); every
   * entry must be a page that genuinely represents this business, or the hint is worthless.
   */
  profiles: {
    tripadvisor:
      'https://www.tripadvisor.com/Attraction_Review-g298342-d6553120-Reviews-Belle_Mare_Tours-Belle_Mare.html',
    google: 'https://www.google.com/maps?cid=2271389619635672229',
  },
  /** The direct "leave a review" link from Business Profile Manager → Read reviews → Get more
   *  reviews — a submission CTA, NOT a corroborating business profile, so it deliberately lives
   *  OUTSIDE `profiles` (which feeds `SAME_AS`/schema.org `sameAs`; a review link there would
   *  pollute that structured data). */
  googleReview: 'https://g.page/r/CaXU5CDTmIUfEAE/review',
} as const;

/** `SITE.profiles` as the flat array schema.org wants. Derived, so a profile added above is picked up
 *  by the JSON-LD automatically and the two can never drift. */
export const SAME_AS: readonly string[] = Object.values(SITE.profiles);

/** Default Open Graph / Twitter share image. A page that sets its OWN `openGraph` must re-include this —
 *  Next.js does NOT merge parent `openGraph.images` into a child that defines `openGraph`. */
export const OG_IMAGE = {
  url: '/hero-mauritius.jpg',
  width: 1200,
  height: 630,
  alt: 'Belle Mare Tours — Mauritius',
} as const;

export const CATEGORIES = [
  'Catamaran cruises',
  'Île aux Cerfs',
  'Dolphin swims',
  'Sea walks & diving',
  'Parasailing',
  'Sightseeing tours',
] as const;

/** wa.me deep link with a pre-filled message (digits-only number derived from SITE.phone). */
export function whatsappUrl(message: string): string {
  const number = SITE.phone.replace(/[^\d]/g, '');
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}
