import { describe, expect, it } from 'vitest';
import { activityFlavorFacts } from '@/lib/content/activity-facts';

describe('activityFlavorFacts', () => {
  it('routes each category to its own flavour set (keyword-matched, label-robust)', () => {
    expect(activityFlavorFacts('Catamaran cruises', 'activity')[0]!.title).toMatch(/BBQ lunch/i);
    // Robust to the admin label variation seen on the site.
    expect(activityFlavorFacts('Private Sightseeing tours', 'activity')[0]!.title).toMatch(/driver-guide/i);
    expect(activityFlavorFacts('Speedboat Tours', 'activity')[0]!.title).toMatch(/island-hopping/i);
    expect(activityFlavorFacts('Dolphin swims', 'activity')[0]!.title).toMatch(/dolphins/i);
    expect(activityFlavorFacts('Parasailing', 'activity')[0]!.title).toMatch(/tandem/i);
    expect(activityFlavorFacts('Sea walks & diving', 'activity')[0]!.title).toMatch(/gear/i);
  });

  it('catamaran and sightseeing get DIFFERENT facts (the whole point)', () => {
    const cat = activityFlavorFacts('Catamaran cruises', 'activity').map((f) => f.title);
    const sight = activityFlavorFacts('Sightseeing tours', 'activity').map((f) => f.title);
    expect(cat).not.toEqual(sight);
  });

  it('transport always gets the transfer set regardless of category', () => {
    expect(activityFlavorFacts('Anything', 'transport')[0]!.title).toMatch(/private transfer/i);
  });

  it('falls back to a generic set for an unknown category', () => {
    expect(activityFlavorFacts('Mystery box', 'activity')[0]!.title).toMatch(/private group/i);
  });

  it('every fact uses a valid badge-icon key', async () => {
    const { BADGE_ICONS } = await import('@/components/ui/badge-icons');
    const keys = new Set(BADGE_ICONS.map((b) => b.key));
    for (const cat of ['Catamaran cruises', 'Speedboat Tours', 'Sightseeing tours', 'Dolphin swims', 'Parasailing', 'Sea walks & diving', 'Île aux Cerfs', 'Airport transfers', 'x']) {
      for (const f of activityFlavorFacts(cat, 'activity')) expect(keys.has(f.icon)).toBe(true);
    }
  });
});
