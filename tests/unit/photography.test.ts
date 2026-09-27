import { describe, expect, it } from 'vitest';
import {
  PHOTOGRAPHY_ADD_ON_PRESETS,
  PHOTOGRAPHY_CATEGORY,
  crossSellHref,
  isPhotographyCategory,
  photographyAddOnSlugs,
  photographyCover,
  photographyGroup,
  photographyInspirationIds,
  photographyLocations,
  photographyOccasions,
  photographySlots,
  photographySpecs,
  PHOTOGRAPHY_LOCATION_DEFAULTS,
  PHOTOGRAPHY_SHOOT_SLOTS,
  PHOTOGRAPHY_WEDDING_SLOTS,
  PHOTO_SLOTS,
  photosIn,
  slotUrl,
  toPhotographyPhoto,
  type PhotographyPhoto,
} from '@/lib/catalogue/photography';
import { breadcrumbTrail } from '@/lib/catalogue/detail';
import { activityExtraSchema } from '@/lib/validation/tours';
import { activityRow, assertPricingValid } from '@/lib/admin/activity-write';
import {
  applyPackageInput,
  packageInputFromValues,
  packageSeo,
  photographyPackageValues,
  starterPackageInput,
  type PhotographyPackageInput,
} from '@/lib/admin/photography';
import { PHOTOGRAPHY_STARTER_PACKAGES } from '@/lib/catalogue/photography';
import { buildInspirationItems } from '@/components/photography/packages-data';
import { serviceJsonLd } from '@/lib/seo/jsonld';
import { SEO_PAGES } from '@/lib/seo/page-registry';
import { renderGalleryReadyEmail, renderPhotoBalanceEmail } from '@/lib/email/photography';
import { SITE } from '@/lib/seo/site';

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
  bestSeller: false,
  photoCount: 0,
  locationLine: '',
  deliveryLine: '',
  showDuration: true,
  showGuests: true,
  showAddOns: true,
  showDeposit: true,
  showDetails: true,
  inspiration: [],
  locations: PHOTOGRAPHY_LOCATION_DEFAULTS.map((l) => ({ ...l })),
  slots: PHOTOGRAPHY_SHOOT_SLOTS.map((s) => ({ ...s })),
  occasions: ['couple'],
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

  it('reads the price-card specs defensively, and keeps them through the extra schema', () => {
    expect(
      photographySpecs({
        photographyBestSeller: true,
        photographyPhotoCount: 40,
        photographyLocation: ' Beach of your choice ',
        photographyDelivery: 'Delivery in 3 weeks',
      }),
    ).toEqual({
      bestSeller: true,
      photoCount: 40,
      location: 'Beach of your choice',
      delivery: 'Delivery in 3 weeks',
      showDuration: true,
      showGuests: true,
      showAddOns: true,
      showDeposit: true,
      showDetails: true,
    });
    // Unknown shapes read as unset, never as a badge or a tick.
    expect(photographySpecs(null)).toEqual({
      bestSeller: false,
      photoCount: null,
      location: null,
      delivery: null,
      showDuration: true,
      showGuests: true,
      showAddOns: true,
      showDeposit: true,
      showDetails: true,
    });
    expect(photographySpecs({ photographyBestSeller: 'yes', photographyPhotoCount: -3 })).toEqual({
      bestSeller: false,
      photoCount: null,
      location: null,
      delivery: null,
      showDuration: true,
      showGuests: true,
      showAddOns: true,
      showDeposit: true,
      showDetails: true,
    });
    // Tick visibility is opt-out: only an explicit false hides one.
    expect(
      photographySpecs({ photographyShowGuests: false, photographyShowDeposit: 0 }),
    ).toMatchObject({ showGuests: false, showDuration: true, showDeposit: true });
    expect(photographySpecs({ photographyShowDetails: false }).showDetails).toBe(false);
    const parsed = activityExtraSchema.parse({
      photographyBestSeller: true,
      photographyPhotoCount: 40,
      photographyLocation: 'Beach of your choice',
      photographyDelivery: 'Delivery in 3 weeks',
      photographyPhotoCount_bad: 1,
    });
    expect(parsed.photographyBestSeller).toBe(true);
    expect(parsed.photographyPhotoCount).toBe(40);
    expect(parsed.photographyLocation).toBe('Beach of your choice');
    expect(parsed.photographyDelivery).toBe('Delivery in 3 weeks');
  });

  it('reads the package’s own inspiration photo urls in order, defensively', () => {
    expect(
      photographyInspirationIds({
        photographyInspiration: ['https://x/b.jpg', ' /a.jpg ', 'https://x/b.jpg', 3, ''],
      }),
    ).toEqual(['https://x/b.jpg', '/a.jpg']);
    expect(photographyInspirationIds({ photographyInspiration: 'a' })).toEqual([]);
    expect(photographyInspirationIds(null)).toEqual([]);
    expect(
      activityExtraSchema.parse({ photographyInspiration: ['https://x/b.jpg'] })
        .photographyInspiration,
    ).toEqual(['https://x/b.jpg']);
  });

  it('prefers the package’s own inspiration photos, falling back to the tag filter', () => {
    const t = (key: string) => key;
    const photos: PhotographyPhoto[] = [
      {
        id: 'p1',
        slot: 'gallery',
        url: 'https://x/1.jpg',
        alt: 'One',
        tags: ['couples'],
        position: 0,
        mediaType: 'image',
        posterUrl: null,
      },
      {
        id: 'p2',
        slot: 'gallery',
        url: 'https://x/2.jpg',
        alt: 'Two',
        tags: ['weddings'],
        position: 1,
        mediaType: 'image',
        posterUrl: null,
      },
    ];
    const act = { title: 'Couples session', summary: null };
    const picked = buildInspirationItems(t, photos, act, 'shoots', 6, [
      'https://own/2.jpg',
      'https://own/1.jpg',
    ]);
    expect(picked.items.map((i) => i.src)).toEqual(['https://own/2.jpg', 'https://own/1.jpg']);
    expect(picked.items.every((i) => i.kind === 'image')).toBe(true);
    // Non-urls resolve to nothing → the tag filter (couples → p1).
    expect(
      buildInspirationItems(t, photos, act, 'shoots', 6, ['gone']).items.map((i) => i.key),
    ).toEqual(['p1']);
    expect(buildInspirationItems(t, photos, act, 'shoots').items.map((i) => i.key)).toEqual(['p1']);
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

  it('turns each add-on into a supplement, prices surcharged locations as Location: rows, and drops blank included items', () => {
    expect(v.supplements.slice(0, PHOTOGRAPHY_ADD_ON_PRESETS.length).map((s) => s.name)).toEqual(
      PHOTOGRAPHY_ADD_ON_PRESETS.map((a) => a.name),
    );
    expect(v.supplements.every((s) => s.priceEur != null && s.priceEur > 0)).toBe(true);
    expect(v.inclusions).toEqual(['Edited photos', 'Online gallery']);
    // The two priced default locations become supplements (api_book prices only that table);
    // the included ones (€0) stay out.
    expect(v.supplements).toContainEqual({
      name: 'Location: Le Morne',
      nameFr: 'Lieu : Le Morne',
      priceEur: 40,
    });
    expect(v.supplements).toContainEqual({
      name: 'Location: Île aux Cerfs',
      nameFr: 'Lieu : Île aux Cerfs',
      priceEur: 60,
    });
    expect(v.supplements.filter((s) => s.name.startsWith('Location:'))).toHaveLength(2);
  });

  it('saves the chosen Type, and states the deposit terms the platform enforces', () => {
    const w = photographyPackageValues({
      ...INPUT,
      kind: 'weddings',
      title: 'Beach ceremony',
      summary: 'Stills',
    });
    expect(w.photographyGroup).toBe('weddings');
    expect((activityRow(w, 'op') as { extra: Record<string, unknown> }).extra).toMatchObject({
      photographyGroup: 'weddings',
    });
    // A saved group beats the title guess ("Beach ceremony" has no wedding keyword).
    expect(photographyGroup({ title: w.title }, 'weddings')).toBe('weddings');
    expect(photographyGroup({ title: w.title })).toBe('shoots');
    for (const kind of ['weddings', 'shoots'] as const) {
      expect(photographyPackageValues({ ...INPUT, kind }).cancellationPolicy).toMatch(
        /50% deposit .* non-refundable/,
      );
    }
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
    // The v3 package keys are photography-only — a tour keeps them out of its extra entirely.
    for (const key of ['photographyLocations', 'photographySlots', 'photographyOccasions']) {
      expect(none.extra).not.toHaveProperty(key);
    }
  });

  it('writes the price-card specs to extra, and omits them when unset', () => {
    const spec = photographyPackageValues({
      ...INPUT,
      bestSeller: true,
      photoCount: 40,
      locationLine: 'Beach of your choice',
      deliveryLine: 'Delivery in 3 weeks',
      inspiration: ['https://own/2.jpg', 'https://own/1.jpg'],
    });
    expect((activityRow(spec, 'op') as { extra: Record<string, unknown> }).extra).toMatchObject({
      photographyBestSeller: true,
      photographyPhotoCount: 40,
      photographyLocation: 'Beach of your choice',
      photographyDelivery: 'Delivery in 3 weeks',
      photographyInspiration: ['https://own/2.jpg', 'https://own/1.jpg'],
    });
    const plain = activityRow(v, 'op') as { extra: Record<string, unknown> };
    for (const key of [
      'photographyBestSeller',
      'photographyPhotoCount',
      'photographyLocation',
      'photographyDelivery',
      'photographyShowDuration',
      'photographyShowGuests',
      'photographyShowAddOns',
      'photographyShowDeposit',
      'photographyShowDetails',
      'photographyInspiration',
    ]) {
      expect(plain.extra).not.toHaveProperty(key);
    }
    // Unticking a box writes an explicit false; ticked boxes stay out of extra entirely.
    const hidden = activityRow(
      photographyPackageValues({ ...INPUT, showGuests: false, showDeposit: false }),
      'op',
    ) as { extra: Record<string, unknown> };
    expect(hidden.extra).toMatchObject({
      photographyShowGuests: false,
      photographyShowDeposit: false,
    });
    expect(hidden.extra).not.toHaveProperty('photographyShowDuration');
    expect(hidden.extra).not.toHaveProperty('photographyShowAddOns');
    // The details section hides the same way.
    const noDetails = activityRow(
      photographyPackageValues({ ...INPUT, showDetails: false }),
      'op',
    ) as { extra: Record<string, unknown> };
    expect(noDetails.extra).toMatchObject({ photographyShowDetails: false });
    // The edit form reads them back, and a save carries them through unchanged.
    const row = activityRow(spec, 'op') as { extra: Record<string, unknown> };
    const input = packageInputFromValues({ ...spec, sourceExtra: row.extra }, 2);
    expect(input).toMatchObject({
      bestSeller: true,
      photoCount: 40,
      locationLine: 'Beach of your choice',
      deliveryLine: 'Delivery in 3 weeks',
      inspiration: ['https://own/2.jpg', 'https://own/1.jpg'],
      showDetails: true,
    });
    const next = applyPackageInput({ ...spec, sourceExtra: row.extra }, input);
    expect((activityRow(next, 'op') as { extra: Record<string, unknown> }).extra).toMatchObject(
      row.extra,
    );
  });

  it('tracks the cover photo in extra, and reads it back into the form', () => {
    expect(photographyCover({ photographyCover: ' https://x/cover.jpg ' })).toBe(
      'https://x/cover.jpg',
    );
    expect(photographyCover(null)).toBeNull();
    expect(
      activityExtraSchema.parse({ photographyCover: 'https://x/cover.jpg' }).photographyCover,
    ).toBe('https://x/cover.jpg');
    // The template writes the cover URL to extra; an empty cover writes nothing.
    const withCover = activityRow(
      photographyPackageValues({ ...INPUT, imageUrl: 'https://x/cover.jpg' }),
      'op',
    ) as { extra: Record<string, unknown> };
    expect(withCover.extra).toMatchObject({ photographyCover: 'https://x/cover.jpg' });
    const withoutCover = activityRow(photographyPackageValues(INPUT), 'op') as {
      extra: Record<string, unknown>;
    };
    expect(withoutCover.extra).not.toHaveProperty('photographyCover');
    // The edit form prefers the stored cover over the first image.
    const input = packageInputFromValues(
      {
        ...photographyPackageValues({ ...INPUT, imageUrl: 'https://x/cover.jpg' }),
        sourceExtra: withCover.extra,
      },
      2,
    );
    expect(input.imageUrl).toBe('https://x/cover.jpg');
  });
});

describe('v3 locations, light slots & occasions', () => {
  const extraOf = (values: ReturnType<typeof photographyPackageValues>) =>
    (activityRow(values, 'op') as { extra: Record<string, unknown> }).extra;

  it('round-trips locations through input → values → input', () => {
    const v = photographyPackageValues(INPUT);
    const input = packageInputFromValues(v, 2);
    expect(input.locations).toEqual(INPUT.locations);
    expect(input.slots).toEqual(INPUT.slots);
    expect(input.occasions).toEqual(['couple']);
    // The full location list lands in extra (defaults included), and the schema keeps it.
    const extra = extraOf(v);
    expect(extra.photographyLocations).toEqual(INPUT.locations);
    expect(activityExtraSchema.parse(extra).photographyLocations).toEqual(INPUT.locations);
    // …and reads back through the shared reader for the customer side.
    expect(photographyLocations(extra)).toEqual(INPUT.locations);
  });

  it('serializes slot overrides sparsely — the key stays out while everything is default', () => {
    expect(extraOf(photographyPackageValues(INPUT))).not.toHaveProperty('photographySlots');
    const reworded = photographyPackageValues({
      ...INPUT,
      slots: INPUT.slots.map((s) =>
        s.id === 'golden' ? { ...s, enabled: false, note: 'Only in summer' } : s,
      ),
    });
    const extra = extraOf(reworded);
    expect(extra.photographySlots).toEqual([
      { id: 'golden', label: 'Golden hour', note: 'Only in summer', enabled: false },
    ]);
    // The reader resolves the override back onto the defaults.
    expect(photographySlots(extra, 'shoots').find((s) => s.id === 'golden')).toMatchObject({
      enabled: false,
      note: 'Only in summer',
    });
    expect(photographySlots(extra, 'shoots').find((s) => s.id === 'sunrise')).toMatchObject({
      enabled: true,
    });
  });

  it('diffs wedding slots against the WEDDING defaults', () => {
    const wedding = photographyPackageValues({
      ...INPUT,
      kind: 'weddings',
      slots: PHOTOGRAPHY_WEDDING_SLOTS.map((s) => ({ ...s, enabled: false })),
      occasions: [],
    });
    expect(extraOf(wedding).photographySlots).toEqual(
      PHOTOGRAPHY_WEDDING_SLOTS.map((s) => ({
        id: s.id,
        label: s.label,
        note: s.note,
        enabled: false,
      })),
    );
    // Loading a wedding package gives the wedding slots and no occasions section.
    const input = packageInputFromValues(wedding, 2);
    expect(input.slots.map((s) => s.id)).toEqual(PHOTOGRAPHY_WEDDING_SLOTS.map((s) => s.id));
    expect(input.occasions).toEqual([]);
  });

  it('saves occasions for shoots only', () => {
    const shoot = photographyPackageValues({ ...INPUT, occasions: ['couple', 'proposal'] });
    expect(extraOf(shoot).photographyOccasions).toEqual(['couple', 'proposal']);
    expect(photographyOccasions(shoot, extraOf(shoot))).toEqual(['couple', 'proposal']);
    // Weddings ignore occasions entirely — the key stays out of extra.
    const wedding = photographyPackageValues({
      ...INPUT,
      kind: 'weddings',
      slots: PHOTOGRAPHY_WEDDING_SLOTS.map((s) => ({ ...s })),
      occasions: ['couple'],
    });
    expect(extraOf(wedding)).not.toHaveProperty('photographyOccasions');
    // A wedding guessed as a shoot by title still guesses its occasions on load.
    expect(
      packageInputFromValues(
        photographyPackageValues({ ...INPUT, title: 'Family & kids', occasions: ['family'] }),
        2,
      ).occasions,
    ).toEqual(['family']);
  });
});

describe('page photos (photography_photos)', () => {
  const rows = [
    {
      id: '1',
      slot: 'gallery',
      url: 'https://x/b.jpg',
      alt: '',
      tags: ['films', 'pets'],
      position: 1,
    },
    {
      id: '2',
      slot: 'gallery',
      url: 'https://x/a.jpg',
      alt: 'Vows',
      tags: ['weddings'],
      position: 0,
    },
    { id: '3', slot: 'hero', url: 'https://x/hero.jpg', alt: null, tags: [], position: 0 },
    { id: '4', slot: 'footer', url: 'https://x/nope.jpg', alt: null, tags: [], position: 0 },
    { id: '5', slot: 'why', url: '  ', alt: null, tags: [], position: 0 },
  ];
  const photos = rows.map(toPhotographyPhoto).filter((p): p is PhotographyPhoto => p !== null);

  it('drops rows it cannot place and unknown tags', () => {
    expect(photos.map((p) => p.id)).toEqual(['1', '2', '3']);
    expect(photos.find((p) => p.id === '1')?.tags).toEqual(['films']);
    expect(photos.find((p) => p.id === '1')?.alt).toBeNull();
  });

  it('orders a slot by position', () => {
    expect(photosIn(photos, 'gallery').map((p) => p.id)).toEqual(['2', '1']);
  });

  it("uses the owner's photo, else the built-in stand-in", () => {
    expect(slotUrl(photos, 'hero')).toBe('https://x/hero.jpg');
    expect(slotUrl(photos, 'why')).toBe(PHOTO_SLOTS.find((s) => s.id === 'why')?.standIn);
  });

  it('lists exactly the slots the migration allows', () => {
    expect(PHOTO_SLOTS.map((s) => s.id).sort()).toEqual(
      [
        'cta',
        'gallery',
        'gallery-hero',
        'hero',
        'pricing-hero',
        'service-couples',
        'service-family',
        'service-films',
        'service-weddings',
        'why',
      ].sort(),
    );
  });
});

describe('photography SEO', () => {
  it('leads both page titles with the search term, inside the ~60-char budget', () => {
    for (const path of ['/photography', '/photography/packages']) {
      const page = SEO_PAGES.find((p) => p.path === path);
      expect(page?.defaultTitle.startsWith('Mauritius Photographer')).toBe(true);
      expect(page!.defaultTitle.length).toBeLessThanOrEqual(60);
      expect(page!.defaultDescription.length).toBeLessThanOrEqual(160);
    }
  });

  it('gives a new package a search title only when it fits', () => {
    expect(packageSeo('Couples session', 'Golden-hour photos on the beach')).toEqual({
      seoTitle: 'Couples session — Photographer in Mauritius',
      seoDescription:
        'Golden-hour photos on the beach. Book online with a local photographer in Mauritius.',
    });
    expect(packageSeo('A very long package name that will not fit the budget', '').seoTitle).toBe(
      '',
    );
    expect(packageSeo('X', '').seoDescription).toBe('');
    expect(photographyPackageValues(INPUT).seoTitle).toBe(
      'Couples session — Belle Mare — Photographer in Mauritius',
    );
  });

  it('lists packages as an offer catalogue, and omits it when there are none', () => {
    const base = { serviceType: 'Photographer', name: 'P', description: 'D', path: '/photography' };
    const json = serviceJsonLd({
      ...base,
      offers: [
        { name: 'Couples', path: '/activities/couples', priceEur: 150 },
        { name: 'Wedding', path: '/activities/wedding', priceEur: null },
      ],
    }) as { hasOfferCatalog: { itemListElement: Record<string, unknown>[] } };
    expect(json.hasOfferCatalog.itemListElement).toHaveLength(2);
    expect(json.hasOfferCatalog.itemListElement[0]).toMatchObject({
      price: 150,
      priceCurrency: 'EUR',
    });
    expect(json.hasOfferCatalog.itemListElement[1]).not.toHaveProperty('price');
    expect(serviceJsonLd(base)).not.toHaveProperty('hasOfferCatalog');
  });
});

describe('the "photos delivered" balance email', () => {
  const base = {
    ref: 'BMTABC123',
    customerName: 'Anna Smith',
    packageTitle: 'Couples session',
    currency: 'EUR',
    balanceDueMinor: 14750,
    locale: 'en',
  };

  it('links to the guest’s own booking page and states the balance', () => {
    const e = renderPhotoBalanceEmail(base);
    expect(e.subject).toContain('BMTABC123');
    expect(e.html).toContain(`${SITE.url}/bookings/BMTABC123`);
    expect(e.text).toContain('EUR 147.50');
    expect(e.text).toContain('Hi Anna,');
  });

  it('writes French for a French booking', () => {
    expect(renderPhotoBalanceEmail({ ...base, locale: 'fr' }).subject).toMatch(
      /Vos photos sont prêtes/,
    );
  });

  it('refuses to email a balance of nothing', () => {
    expect(() => renderPhotoBalanceEmail({ ...base, balanceDueMinor: 0 })).toThrow();
  });
});

describe('the "gallery ready" email', () => {
  const base = {
    ref: 'BMTABC123',
    customerName: 'Anna Smith',
    packageTitle: 'Couples session',
    photoCount: 40,
    locale: 'en',
  };

  it('links to the guest’s private gallery and states the photo count', () => {
    const e = renderGalleryReadyEmail(base);
    expect(e.subject).toContain('BMTABC123');
    expect(e.html).toContain(`${SITE.url}/bookings/BMTABC123#gallery`);
    expect(e.text).toContain('40');
    expect(e.text).toContain('Hi Anna,');
  });

  it('writes French for a French booking', () => {
    expect(renderGalleryReadyEmail({ ...base, locale: 'fr' }).subject).toMatch(
      /Votre galerie est prête/,
    );
  });

  it('refuses to email a gallery with no photos', () => {
    expect(() => renderGalleryReadyEmail({ ...base, photoCount: 0 })).toThrow();
  });
});

describe('the six example packages', () => {
  it('each becomes a valid draft package, matching the card shown on the site', () => {
    expect(PHOTOGRAPHY_STARTER_PACKAGES).toHaveLength(6);
    for (const p of PHOTOGRAPHY_STARTER_PACKAGES) {
      const v = photographyPackageValues(starterPackageInput(p.key));
      expect(v.status).toBe('draft');
      expect(v.title).toBe(p.title);
      expect(v.summary).toBe(p.summary);
      expect(v.inclusions).toEqual(p.features);
      expect(v.images[0]?.url).toBe(p.image);
      expect(v.photographyGroup).toBe(p.kind);
      expect(() => assertPricingValid(v)).not.toThrow();
    }
    expect(new Set(PHOTOGRAPHY_STARTER_PACKAGES.map((p) => p.key)).size).toBe(6);
  });
});

describe('editing an existing package', () => {
  // A package as saved, then touched in the full tour editor (longer description, more photos,
  // an itinerary stop, a separately curated highlight, saved add-on/location-supplement ids).
  const saved = {
    ...photographyPackageValues(INPUT),
    description: 'A much longer description written in the tour editor.',
    images: [
      { url: '/a.jpg', alt: 'A' },
      { url: '/b.jpg', alt: 'B' },
    ],
    // As saved through the package form: the cover is explicit in extra, not just images[0].
    photographyCover: '/a.jpg',
    highlights: ['Hand-picked highlight'],
    supplements: [
      { id: 'sup-1', name: 'Drone aerials', nameFr: 'Drone', priceEur: 120 },
      { id: 'sup-lm', name: 'Location: Le Morne', nameFr: 'Lieu : Le Morne', priceEur: 40 },
      {
        id: 'sup-ile',
        name: 'Location: Île aux Cerfs',
        nameFr: 'Lieu : Île aux Cerfs',
        priceEur: 60,
      },
    ],
    // The save recorded each priced location's supplement row id back onto its extra entry.
    photographyLocations: photographyPackageValues(INPUT).photographyLocations.map((l) =>
      l.name === 'Le Morne'
        ? { ...l, supplementId: 'sup-lm' }
        : l.name === 'Île aux Cerfs'
          ? { ...l, supplementId: 'sup-ile' }
          : l,
    ),
    options: photographyPackageValues(INPUT).options.map((o) => ({ ...o, id: 'opt-1' })),
  };

  it('loads into the form and saves back unchanged when nothing is edited', () => {
    const input = packageInputFromValues(saved, 2);
    expect(input).toMatchObject({
      baseEur: 150,
      included: 2,
      extraEur: 25,
      maxGuests: 8,
      shootsPerDay: 2,
    });
    expect(input.addOns).toEqual([
      { id: 'sup-1', name: 'Drone aerials', nameFr: 'Drone', priceEur: 120 },
    ]);
    // The Location: rows are not generic add-ons; their ids attach to the locations.
    expect(input.addOns.every((a) => !a.name.startsWith('Location:'))).toBe(true);
    expect(input.locations.find((l) => l.name === 'Le Morne')).toMatchObject({
      extraEur: 40,
      supplementId: 'sup-lm',
    });
    expect(input.locations.find((l) => l.name === 'Belle Mare beach')).not.toHaveProperty(
      'supplementId',
    );
    expect(input.slots.map((s) => s.id)).toEqual(PHOTOGRAPHY_SHOOT_SLOTS.map((s) => s.id));
    expect(input.occasions).toEqual(['couple']);
    expect(applyPackageInput(saved, input)).toEqual(saved);
  });

  it('changes only what the form shows, keeping ids and everything from the full editor', () => {
    const input = packageInputFromValues(saved, 2);
    const next = applyPackageInput(saved, {
      ...input,
      baseEur: 175,
      imageUrl: '/new-cover.jpg',
      addOns: [
        { ...input.addOns[0]!, priceEur: 140 },
        { name: 'Album', nameFr: '', priceEur: 180 },
      ],
      locations: input.locations.map((l) => (l.name === 'Le Morne' ? { ...l, extraEur: 50 } : l)),
      status: 'published',
    });
    expect(next.options[0]).toMatchObject({ id: 'opt-1', privateBaseEur: 175 });
    expect(next.supplements).toEqual([
      { id: 'sup-1', name: 'Drone aerials', nameFr: 'Drone', priceEur: 140 },
      { name: 'Album', nameFr: '', priceEur: 180 },
      // The priced locations stay as rows, updated in place by id, in list order.
      { id: 'sup-lm', name: 'Location: Le Morne', nameFr: 'Lieu : Le Morne', priceEur: 50 },
      {
        id: 'sup-ile',
        name: 'Location: Île aux Cerfs',
        nameFr: 'Lieu : Île aux Cerfs',
        priceEur: 60,
      },
    ]);
    expect(next.images.map((i) => i.url)).toEqual(['/new-cover.jpg', '/b.jpg']);
    expect(next.description).toBe(saved.description);
    expect(next.highlights).toEqual(['Hand-picked highlight']);
    expect(next.slug).toBe(saved.slug);
    expect(next.status).toBe('published');
    expect(() => assertPricingValid(next)).not.toThrow();
  });

  it('drops a location’s supplement row when the location goes away or the surcharge hits 0', () => {
    const input = packageInputFromValues(saved, 2);
    const renamed = applyPackageInput(saved, {
      ...input,
      locations: input.locations.map((l) =>
        l.name === 'Le Morne' ? { ...l, name: 'Black River' } : l,
      ),
    });
    // A rename keeps the row's id (it is updated in place, like a renamed add-on)…
    expect(renamed.supplements.some((s) => s.name === 'Location: Le Morne')).toBe(false);
    expect(renamed.supplements).toContainEqual({
      id: 'sup-lm',
      name: 'Location: Black River',
      nameFr: 'Lieu : Black River',
      priceEur: 40,
    });
    const free = applyPackageInput(saved, {
      ...input,
      locations: input.locations.map((l) => (l.name === 'Le Morne' ? { ...l, extraEur: 0 } : l)),
    });
    expect(free.supplements.some((s) => s.name === 'Location: Le Morne')).toBe(false);
    expect(free.supplements).toContainEqual({
      id: 'sup-ile',
      name: 'Location: Île aux Cerfs',
      nameFr: 'Lieu : Île aux Cerfs',
      priceEur: 60,
    });
  });
});
