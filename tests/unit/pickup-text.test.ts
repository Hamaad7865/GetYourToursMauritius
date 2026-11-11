import { describe, expect, it } from 'vitest';
import { parsePinnedLocation } from '@/components/admin/PickupText';

describe('parsePinnedLocation', () => {
  it('reads the coordinates a Google-less dropped pin was saved as', () => {
    expect(parsePinnedLocation('Pinned location (-20.20856, 57.78972)')).toEqual({
      lat: -20.20856,
      lng: 57.78972,
    });
  });

  it('leaves an ordinary pickup alone', () => {
    expect(parsePinnedLocation('LUX Belle Mare, Coastal Road, Quatre Cocos, Mauritius')).toBeNull();
    expect(parsePinnedLocation('Salt of Palmar')).toBeNull();
  });
});
