import { describe, expect, it } from 'vitest';
import {
  PHOTOGRAPHY_ADD_ON_PRESETS,
  PHOTOGRAPHY_CATEGORY,
  crossSellHref,
  isPhotographyCategory,
  photographyAddOnSlugs,
  photographyGroup,
} from '@/lib/catalogue/photography';
import { breadcrumbTrail } from '@/lib/catalogue/detail';
import { activityExtraSchema } from '@/lib/validation/tours';
import { activityRow, assertPricingValid } from '@/lib/admin/activity-write';
import { photographyPackageValues, type PhotographyPackageInput } from '@/lib/admin/photography';

const INPUT: PhotographyPackageInput = {
  title: 'Couples session — Belle Mare',
  kind: 'shoots',
  summary: 'Golden-hour photos on the beach.',
  durationHours: 1.5,
  baseEur: 150,
  included: 2,
  extraEur: 25,
  maxGuests: 8,
  shootsPerDay: 2,
  minAdvanceDays: 1,
  features: ['Edited photos', '  ', 'Online gallery'],
  addOns: PHOTOGRAPHY_ADD_ON_PRESETS.map((a) => ({ ...a })),
  imageUrl: '',
  status: 'published',
};

describe('photography catalogue rules', () => {
  it('recognises the category case-insensitively and nothing else', () => {
    expect(isPhotographyCategory('Photography')).toBe(true);
    expect(isPhotographyCategory(' photography ')).toBe(true);
    expect(isPhotographyCategory('Catamaran cruises')).toBe(false);
    expect(isPhotographyCategory(null)).toBe(false);
  });

  it('files weddings and films apart from other shoots', () => {
    expect(photographyGroup({ title: 'Wedding — Photo + Film' })).toBe('weddings');
    expect(photographyGroup({ title: 'Elopement on the sandbank' })).toBe('weddings');
    expect(photographyGroup({ title: 'Family & kids', summary: null })).toBe('shoots');
  });

  it('reads the tour add-on slugs defensively', () => {
    expect(photographyAddOnSlugs({ photographyAddOns: [' a ', 'b', 'a', 3, ''] })).toEqual([
      'a',
      'b',
    ]);
    expect(photographyAddOnSlugs({ photographyAddOns: 'a' })).toEqual([]);
    expect(photographyAddOnSlugs(null)).toEqual([]);
  });

  it('keeps the tour add-on key through the extra schema, and drops a malformed one', () => {
    expect(activityExtraSchema.parse({ photographyAddOns: ['x'] }).photographyAddOns).toEqual([
      'x',
    ]);
    expect(activityExtraSchema.parse({ photographyAddOns: 'x' }).photographyAddOns).toBeUndefined();
  });

  it('deep-links the paired product for the same day and party', () => {
    expect(crossSellHref('couples-session', '2026-10-01', 3)).toBe(
      '/activities/couples-session?date=2026-10-01&adults=3',
    );
    // No date picked yet: still a valid link, just without the prefill.
    expect(crossSellHref('couples-session', '', 2)).toBe('/activities/couples-session?adults=2');
  });

  it('puts a package under Photography in the breadcrumb, a tour under Activities', () => {
    expect(
      breadcrumbTrail({ type: 'activity', category: PHOTOGRAPHY_CATEGORY }).map((c) => c.href),
    ).toEqual(['/', '/photography', '/photography/packages']);
    expect(breadcrumbTrail({ type: 'activity', category: 'Dolphin swims' })[1]?.href).toBe(
      '/activities',
    );
  });
});

describe('the admin "New package" template', () => {
  const v = photographyPackageValues(INPUT);

  it('builds a valid private-option activity in the Photography category', () => {
    expect(v.category).toBe(PHOTOGRAPHY_CATEGORY);
    expect(v.slug).toBe('couples-session-belle-mare');
    expect(v.durationMinutes).toBe(90);
    expect(v.pickupAvailable).toBe(false);
    expect(v.options).toHaveLength(1);
    expect(v.options[0]).toMatchObject({
      isPrivateOption: true,
      privateBaseEur: 150,
      privateIncluded: 2,
      privateExtraEur: 25,
      privateMaxGuests: 8,
    });
    // The save path's own validation accepts it, so Create can't fail on pricing.
    expect(() => assertPricingValid(v)).not.toThrow();
  });

  it('turns each add-on into a supplement and drops blank included items', () => {
    expect(v.supplements.map((s) => s.name)).toEqual(PHOTOGRAPHY_ADD_ON_PRESETS.map((a) => a.name));
    expect(v.supplements.every((s) => s.priceEur != null && s.priceEur > 0)).toBe(true);
    expect(v.inclusions).toEqual(['Edited photos', 'Online gallery']);
  });

  it('never lets max guests fall below the guests the price covers', () => {
    const w = photographyPackageValues({ ...INPUT, included: 4, maxGuests: 2 });
    expect(w.options[0]?.privateMaxGuests).toBe(4);
    expect(() => assertPricingValid(w)).not.toThrow();
  });

  it('round-trips the tour add-on list through extra, and omits it when empty', () => {
    const tour = { ...v, category: 'Sightseeing tours', photographyAddOns: ['couples', 'couples'] };
    expect((activityRow(tour, 'op') as { extra: Record<string, unknown> }).extra).toMatchObject({
      photographyAddOns: ['couples'],
    });
    const none = activityRow({ ...tour, photographyAddOns: [] }, 'op') as {
      extra: Record<string, unknown>;
    };
    expect(none.extra).not.toHaveProperty('photographyAddOns');
  });
});
