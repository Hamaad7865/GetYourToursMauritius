import { describe, expect, it } from 'vitest';
import { guestHotelQuery, parseGuestHotel } from '@/lib/content/guest-hotel';

/**
 * A guest who searches a hotel we don't list is sent to the nearest listed hotel's transfer page
 * with THEIR hotel carried in the URL (?hotel=&hlat=&hlng=), so the page and the booking can keep
 * saying the hotel the guest actually chose. The params are guest-controlled text that ends up in
 * an H1, a map pin and a booking's dropoff field — this module is the single gate they pass
 * through, so its edges are pinned here.
 */
describe('parseGuestHotel', () => {
  it('accepts a plain hotel name with coordinates', () => {
    expect(
      parseGuestHotel({ hotel: 'Veranda Palmar Beach Hotel', hlat: '-20.20074', hlng: '57.78339' }),
    ).toEqual({ name: 'Veranda Palmar Beach Hotel', lat: -20.20074, lng: 57.78339 });
  });

  it('returns null when no hotel param is present', () => {
    expect(parseGuestHotel({})).toBeNull();
    expect(parseGuestHotel({ hlat: '-20.2', hlng: '57.78' })).toBeNull();
  });

  it('keeps the name but drops coordinates that are not plausibly in Mauritius', () => {
    // A tampered or truncated URL must not move the map pin to the wrong hemisphere.
    expect(parseGuestHotel({ hotel: 'X Resort', hlat: '48.85', hlng: '2.35' })).toEqual({
      name: 'X Resort',
    });
    expect(parseGuestHotel({ hotel: 'X Resort', hlat: 'abc', hlng: '57.7' })).toEqual({
      name: 'X Resort',
    });
    // One coordinate without the other is useless — drop both.
    expect(parseGuestHotel({ hotel: 'X Resort', hlat: '-20.2' })).toEqual({ name: 'X Resort' });
  });

  it('normalises whitespace and caps the length', () => {
    expect(parseGuestHotel({ hotel: '  Villa   Mer \t Bleue  ' })?.name).toBe('Villa Mer Bleue');
    const long = parseGuestHotel({ hotel: 'A'.repeat(300) });
    expect(long?.name).toHaveLength(80);
  });

  it('strips markup-significant and control characters from the name', () => {
    // React escapes on render, but the name also travels into a booking payload and a maps query —
    // keep the gate strict rather than trusting every consumer.
    expect(parseGuestHotel({ hotel: '<script>x</script> Hotel' })?.name).toBe(
      'scriptx/script Hotel',
    );
    expect(parseGuestHotel({ hotel: 'Bad' + String.fromCharCode(0, 7) + 'name' })?.name).toBe(
      'Badname',
    );
  });

  it('rejects a name that is empty once cleaned', () => {
    expect(parseGuestHotel({ hotel: '   ' })).toBeNull();
    expect(parseGuestHotel({ hotel: '<>' })).toBeNull();
  });

  it('takes the first value when a param is repeated', () => {
    expect(parseGuestHotel({ hotel: ['First Hotel', 'Second'] })?.name).toBe('First Hotel');
  });
});

describe('guestHotelQuery', () => {
  it('round-trips through parseGuestHotel', () => {
    const q = guestHotelQuery('Veranda Palmar Beach Hotel', -20.200743, 57.783386);
    const parsed = parseGuestHotel(Object.fromEntries(new URLSearchParams(q)));
    expect(parsed).toEqual({ name: 'Veranda Palmar Beach Hotel', lat: -20.20074, lng: 57.78339 });
  });

  it('omits coordinates when not given', () => {
    const q = guestHotelQuery('Some Villa');
    expect(q).toBe('hotel=Some+Villa');
  });
});
