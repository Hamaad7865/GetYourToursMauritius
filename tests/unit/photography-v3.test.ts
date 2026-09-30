import { describe, expect, it } from 'vitest';
import {
  PHOTOGRAPHY_LOCATION_DEFAULTS,
  PHOTOGRAPHY_SHOOT_SLOTS,
  PHOTOGRAPHY_WEDDING_SLOTS,
  photographyHm,
  photographyLightTip,
  photographyLocations,
  photographyOccasions,
  photographySlotMinutes,
  photographySlots,
  photographySunTimes,
} from '@/lib/catalogue/photography';

describe('photographySlots', () => {
  it('defaults to the group slot set', () => {
    expect(photographySlots(null, 'shoots').map((s) => s.id)).toEqual(
      PHOTOGRAPHY_SHOOT_SLOTS.map((s) => s.id),
    );
    expect(photographySlots(undefined, 'weddings').map((s) => s.id)).toEqual(
      PHOTOGRAPHY_WEDDING_SLOTS.map((s) => s.id),
    );
  });

  it('applies saved overrides by id (disable, reword) without reordering', () => {
    const slots = photographySlots(
      { photographySlots: [{ id: 'morning', enabled: false, label: 'Late morning' }] },
      'shoots',
    );
    const morning = slots.find((s) => s.id === 'morning')!;
    expect(morning.enabled).toBe(false);
    expect(morning.label).toBe('Late morning');
    expect(slots.find((s) => s.id === 'sunrise')!.enabled).toBe(true);
    expect(slots.map((s) => s.id)).toEqual(['sunrise', 'morning', 'golden']);
  });

  it('ignores unknown slot ids and junk', () => {
    const slots = photographySlots(
      { photographySlots: [{ id: 'nope', enabled: false }, 'junk', { enabled: false }] },
      'shoots',
    );
    expect(slots.every((s) => s.enabled)).toBe(true);
  });
});

describe('photographyLocations', () => {
  it('defaults to the island list', () => {
    expect(photographyLocations(null)).toEqual(PHOTOGRAPHY_LOCATION_DEFAULTS);
  });

  it('reads a saved list, dropping invalid rows and clamping extras', () => {
    const list = photographyLocations({
      photographyLocations: [
        {
          name: ' Flic en Flac ',
          coast: 'west',
          extraEur: 25.5,
          best: 'Sunsets',
          mapQuery: 'Flic en Flac, Mauritius',
        },
        { name: '', coast: 'east' },
        { name: 'Hotel', coast: 'middle', extraEur: -5 },
        'junk',
      ],
    });
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ name: 'Flic en Flac', coast: 'west', extraEur: 25.5 });
    expect(list[1]).toMatchObject({ name: 'Hotel', coast: 'any', extraEur: 0 });
  });

  it('falls back to defaults when the saved list is empty after cleaning', () => {
    expect(photographyLocations({ photographyLocations: [] })).toEqual(
      PHOTOGRAPHY_LOCATION_DEFAULTS,
    );
  });
});

describe('photographyOccasions', () => {
  it('uses saved tags when present', () => {
    expect(
      photographyOccasions({ title: 'Beach day' }, { photographyOccasions: ['family', 'couple'] }),
    ).toEqual(['family', 'couple']);
  });

  it('guesses from the title and summary when nothing is saved', () => {
    expect(photographyOccasions({ title: 'Secret Proposal at the beach' }, null)).toEqual([
      'proposal',
    ]);
    expect(photographyOccasions({ title: 'Family holiday shoot' }, null)).toEqual(['family']);
    expect(photographyOccasions({ title: 'Golden hour couples session' }, null)).toEqual([
      'couple',
    ]);
    expect(photographyOccasions({ title: 'Just photos' }, null)).toEqual(['couple']);
  });

  it('drops unknown tags from the saved list', () => {
    expect(
      photographyOccasions({ title: 'x' }, { photographyOccasions: ['family', 'nope'] }),
    ).toEqual(['family']);
  });
});

describe('sun times & slot minutes', () => {
  it('computes plausible Mauritius sun times all year', () => {
    for (const day of ['2026-01-15', '2026-06-15', '2026-09-29', '2026-12-15']) {
      const s = photographySunTimes(new Date(`${day}T12:00:00`));
      expect(s.rise).toBeGreaterThan(300); // after 05:00
      expect(s.rise).toBeLessThan(430); // before ~07:10
      expect(s.set).toBeGreaterThan(1040); // after ~17:20
      expect(s.set).toBeLessThan(1150); // before ~19:10
    }
  });

  it('maps slots to minutes (fixed slots independent of the day)', () => {
    const d = new Date('2026-09-29T12:00:00');
    expect(photographySlotMinutes('morning', d)).toBe(540);
    expect(photographySlotMinutes('wmorning', null)).toBe(600);
    const golden = photographySlotMinutes('golden', d);
    const set = photographySunTimes(d).set;
    expect(golden).toBe(set - 75);
    expect(photographySlotMinutes('sunrise', d)).toBe(photographySunTimes(d).rise - 15);
  });

  it('formats minutes as HH:MM', () => {
    expect(photographyHm(372)).toBe('06:10');
    expect(photographyHm(0)).toBe('00:00');
  });
});

describe('photographyLightTip', () => {
  const east = PHOTOGRAPHY_LOCATION_DEFAULTS.find((l) => l.coast === 'east')!;
  const west = PHOTOGRAPHY_LOCATION_DEFAULTS.find((l) => l.coast === 'west')!;
  const any = PHOTOGRAPHY_LOCATION_DEFAULTS.find((l) => l.coast === 'any')!;

  it('warns for a sunset slot on the east coast and offers the west fix', () => {
    const tip = photographyLightTip(east, 'sunset', PHOTOGRAPHY_LOCATION_DEFAULTS);
    expect(tip.warn).toBe(true);
    expect(tip.fixTo).toBe('Le Morne');
  });

  it('warns for a sunrise slot on the west coast and offers the east fix', () => {
    const tip = photographyLightTip(west, 'sunrise', PHOTOGRAPHY_LOCATION_DEFAULTS);
    expect(tip.warn).toBe(true);
    expect(tip.fixTo).toBe('Belle Mare beach');
  });

  it('reassures when coast and light match', () => {
    expect(photographyLightTip(west, 'sunset', PHOTOGRAPHY_LOCATION_DEFAULTS).warn).toBe(false);
    expect(photographyLightTip(east, 'sunrise', PHOTOGRAPHY_LOCATION_DEFAULTS).warn).toBe(false);
  });

  it('has no fix suggestion when the list lacks the other coast', () => {
    const tip = photographyLightTip(east, 'sunset', [east, any]);
    expect(tip.warn).toBe(true);
    expect(tip.fixTo).toBeNull();
  });

  it('gives the venue note for anywhere-locations', () => {
    const tip = photographyLightTip(any, 'day', PHOTOGRAPHY_LOCATION_DEFAULTS);
    expect(tip.warn).toBe(false);
    expect(tip.text).toContain('hotel');
  });
});
