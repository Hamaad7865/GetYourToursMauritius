import { describe, expect, it } from 'vitest';
import { normalizeBadges } from '@/lib/catalogue/badges';

describe('normalizeBadges', () => {
  it('keeps complete rows and trims', () => {
    const out = normalizeBadges([
      { icon: 'bolt', title: '  Instant  ', subtitle: '  E-voucher  ' },
    ]);
    expect(out).toEqual([{ icon: 'bolt', title: 'Instant', subtitle: 'E-voucher' }]);
  });
  it('drops rows missing an icon or a title', () => {
    expect(
      normalizeBadges([
        { icon: '', title: 'X', subtitle: '' },
        { icon: 'pin', title: '', subtitle: '' },
      ]),
    ).toEqual([]);
  });
  it('caps the count at 8', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      icon: 'star',
      title: `T${i}`,
      subtitle: '',
    }));
    expect(normalizeBadges(many)).toHaveLength(8);
  });
});
