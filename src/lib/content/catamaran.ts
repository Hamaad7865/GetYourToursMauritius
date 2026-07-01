/**
 * Canonical "Important information" shared by EVERY catamaran cruise, so the whole range shows the same
 * what-to-bring checklist and know-before-you-go notes regardless of what each tour's admin record
 * carries. Mirrors the private-sightseeing shared content (src/lib/content/sightseeing.ts). A catamaran
 * cruise is any activity in the 'Catamaran cruises' category.
 */

/** The packing checklist shown on every catamaran cruise ("What to bring"). */
export const CATAMARAN_WHAT_TO_BRING: string[] = [
  'Comfortable shoes',
  'Sunglasses',
  'Hat',
  'Swimwear',
  'Change of clothes',
  'Towel',
  'Camera',
  'Sunscreen',
  'Snorkeling gear',
];

/** "Know before you go" notes shown on every catamaran cruise. */
export const CATAMARAN_KNOW_BEFORE: string[] = [
  'Infants aged 1 to 4 go free of charge.',
  'All food is halal. Vegetarian meals must be requested in advance.',
  'Pickup and drop-off is available if the applicable option is selected.',
  'Public parking is available 60m from the meeting point. Please arrive early to secure a space. Contact our team on WhatsApp for the location.',
  'The itinerary may be adjusted due to weather, sea conditions, tides, or operational requirements for guest safety.',
  'The captain’s decisions regarding navigation, timing, and itinerary adjustments are final and made in the interest of guest safety.',
  'Guests using wheelchairs need to stand briefly to get on and off the shuttle boat, with our crew assisting, to access the catamaran.',
  'For their own comfort and security, guests are kindly requested to keep personal belongings with them at all times. The company cannot be held responsible for any loss, theft, damage, or misplacement of personal items during the tour.',
];

/** True when an activity is a catamaran cruise (the shared cruise content applies). */
export function isCatamaranCruise(category: string): boolean {
  return category === 'Catamaran cruises';
}
