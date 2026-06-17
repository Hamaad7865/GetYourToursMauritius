/** Site-wide identity for SEO, JSON-LD and the footer. */
export const SITE = {
  name: 'GetYourToursMauritius',
  operator: 'Belle Mare Tours',
  alternateName: 'GetYourToursMauritius',
  description:
    "The official booking platform of Belle Mare Tours. Catamaran cruises, dolphin swims, sea walks and island days on Mauritius's east coast — booked direct, no reseller markup.",
  url: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
  phone: '+230 5772 9919',
  street: 'Royal Road, Belle Mare',
  locality: 'Belle Mare',
  region: 'Flacq',
  country: 'MU',
  geo: { lat: -20.1944, lng: 57.7706 },
  priceRange: 'EUR 30–240',
  languages: ['en', 'fr'] as const,
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
