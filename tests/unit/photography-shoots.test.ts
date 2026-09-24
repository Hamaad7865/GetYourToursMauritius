import { describe, expect, it, vi } from 'vitest';
import { PHOTOGRAPHY_SHOOTS, matchesPhotographyShoot } from '@/lib/catalogue/photography-shoots';
import { buildPackageCards } from '@/components/photography/packages-data';
import { tourSummarySchema } from '@/lib/validation/tours';
import { fr } from '@/lib/i18n/messages';

vi.mock('@/lib/http/context', () => ({ publicServiceContext: vi.fn() }));
vi.mock('@/lib/services/activities', () => ({ searchActivities: vi.fn() }));
vi.mock('@/lib/i18n/server', () => ({ getLocale: async () => 'en' }));
vi.mock('@/lib/supabase/client', () => ({ createUserClient: vi.fn() }));

const t = (key: string) => key;
const activity = (id: string, title: string, slug: string) =>
  tourSummarySchema.parse({
    id,
    title,
    slug,
    type: 'activity',
    summary: 'Owner description',
    category: 'Photography',
    location: null,
    durationMinutes: 60,
    fromPriceEur: 325,
    pricingMode: 'per_person',
    ratingAvg: null,
    ratingCount: 0,
    heroImage: { id: 'cover', position: 0, url: '/owner.jpg', alt: 'Owner photo' },
  });

describe('eight photography shoot types', () => {
  it('offers all eight as honest enquiries when not configured', () => {
    const cards = buildPackageCards(t, [], '23057729919');
    expect(cards.map((card) => card.title)).toEqual([
      'Holiday',
      'Beach shoot',
      'Trip explorer',
      'Babymoon',
      'Proposal',
      'Family & kids',
      'Boat row',
      'Fashion',
    ]);
    expect(
      cards.every(
        (card) => card.external && card.priceEur === null && card.href.startsWith('https://wa.me/'),
      ),
    ).toBe(true);
  });

  it('uses real published data even when the owner renamed an older package', () => {
    const holiday = activity('existing', 'Holiday', 'ceremony-photo');
    const wedding = activity('wedding', 'Full wedding day', 'full-day');
    const cards = buildPackageCards(t, [holiday, wedding], '23057729919');
    expect(cards).toHaveLength(9);
    expect(cards[0]).toMatchObject({
      key: 'existing',
      title: 'Holiday',
      priceEur: 325,
      image: '/owner.jpg',
      href: '/activities/ceremony-photo',
      external: false,
      summary: 'Owner description',
    });
    expect(cards.filter((card) => card.title === 'Holiday')).toHaveLength(1);
    expect(cards.find((card) => card.key === 'wedding')?.href).toBe('/activities/full-day');
  });

  it('recognizes family aliases without losing other published packages', () => {
    expect(
      matchesPhotographyShoot(PHOTOGRAPHY_SHOOTS[5], { title: 'Famille', slug: 'family' }),
    ).toBe(true);
    expect(
      matchesPhotographyShoot(PHOTOGRAPHY_SHOOTS[0], {
        title: 'Not a holiday package',
        slug: 'custom',
      }),
    ).toBe(false);
  });

  it('does not duplicate a translated package with a legacy slug', () => {
    const cards = buildPackageCards(
      (key) => fr[key] ?? key,
      [activity('existing', 'Vacances', 'ceremony-photo')],
      '23057729919',
    );
    expect(cards).toHaveLength(8);
    expect(cards[0]).toMatchObject({ title: 'Vacances', external: false, priceEur: 325 });
  });

  it('translates every new title and description', () => {
    for (const shoot of PHOTOGRAPHY_SHOOTS) {
      expect(fr[shoot.title], shoot.title).toBeTruthy();
      expect(fr[shoot.summary], shoot.summary).toBeTruthy();
    }
  });
});
