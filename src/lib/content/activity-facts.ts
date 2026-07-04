/**
 * Category-specific "at a glance" facts — the flavour cards in the detail-page QuickFacts grid, so a
 * catamaran cruise, a speedboat tour, a private sightseeing tour etc. each read differently instead of
 * the one generic set. The universal facts (free cancellation, reserve & pay later, instant confirmation)
 * and the data-derived ones (duration, languages, pickup) still apply to every activity; these just swap
 * in the middle "experience" cards. An activity's admin-authored `extra.badges` overrides all of it.
 *
 * `icon` is a BADGE_ICONS key (see src/components/ui/badge-icons.tsx). Titles/subs pass through t().
 * Matched by keyword on the category NAME so it's robust to the exact admin label
 * (e.g. "Private Sightseeing tours" vs "Sightseeing tours").
 */
export interface ActivityFact {
  icon: string;
  title: string;
  sub: string;
}

const CATAMARAN: ActivityFact[] = [
  { icon: 'check', title: 'BBQ lunch & drinks on board', sub: 'Grilled lunch, soft drinks and local rum included' },
  { icon: 'star', title: 'Snorkelling & swim stops', sub: 'Gear provided — explore the lagoon' },
  { icon: 'heart', title: 'A relaxed day at sea', sub: 'Sun deck, shade and space to unwind' },
];

const SPEEDBOAT: ActivityFact[] = [
  { icon: 'bolt', title: 'Fast island-hopping', sub: 'See more of the coast and islets in a day' },
  { icon: 'star', title: 'Snorkelling included', sub: 'Masks and fins provided on board' },
  { icon: 'users', title: 'Small-group speedboat', sub: 'Just your party and the skipper' },
];

const SIGHTSEEING: ActivityFact[] = [
  { icon: 'users', title: 'Private driver-guide', sub: 'Your own English-speaking guide, never shared' },
  { icon: 'pin', title: 'Flexible, your-pace route', sub: 'Add, swap or skip stops on the day' },
  { icon: 'shield', title: 'Air-conditioned vehicle', sub: 'Comfortable door-to-door travel' },
];

const CERFS: ActivityFact[] = [
  { icon: 'star', title: 'Île aux Cerfs beach time', sub: 'Relax on the famous white-sand beaches' },
  { icon: 'check', title: 'Lagoon snorkelling', sub: 'Clear turquoise water and marine life' },
];

const DOLPHIN: ActivityFact[] = [
  { icon: 'star', title: 'Swim with wild dolphins', sub: 'Early-morning encounter in the bay' },
  { icon: 'check', title: 'Snorkelling gear included', sub: 'Mask and fins provided on board' },
];

const SEAWALK: ActivityFact[] = [
  { icon: 'shield', title: 'All gear included', sub: 'Helmet / dive equipment provided' },
  { icon: 'users', title: 'Beginner-friendly', sub: 'A certified crew guides you throughout' },
];

const PARASAILING: ActivityFact[] = [
  { icon: 'star', title: 'Tandem flights', sub: 'Soar above the lagoon with a partner' },
  { icon: 'shield', title: 'Certified crew & gear', sub: 'Safety-checked equipment, trained team' },
];

const TRANSFER: ActivityFact[] = [
  { icon: 'users', title: 'Private transfer', sub: 'Just your party — no strangers' },
  { icon: 'pin', title: 'Meet & greet', sub: 'Your driver is waiting on arrival' },
  { icon: 'wallet', title: 'Fixed price', sub: 'No meters, no surprises' },
];

const DEFAULT: ActivityFact[] = [
  { icon: 'users', title: 'Private group', sub: 'Only your party — no strangers' },
];

/** The flavour facts for an activity — driven by its category name (or transport type). */
export function activityFlavorFacts(category: string, type: 'activity' | 'transport'): ActivityFact[] {
  if (type === 'transport') return TRANSFER;
  const c = (category ?? '').toLowerCase();
  if (c.includes('catamaran')) return CATAMARAN;
  if (c.includes('speedboat') || c.includes('speed boat')) return SPEEDBOAT;
  if (c.includes('dolphin')) return DOLPHIN;
  if (c.includes('parasail')) return PARASAILING;
  if (c.includes('sea walk') || c.includes('diving') || c.includes('dive') || c.includes('snorkel')) return SEAWALK;
  if (c.includes('cerf')) return CERFS;
  if (c.includes('sightseeing')) return SIGHTSEEING;
  if (c.includes('transfer') || c.includes('airport') || c.includes('taxi')) return TRANSFER;
  return DEFAULT;
}
