import { describe, expect, it } from 'vitest';
import { placeLabel, type LabeledPlace } from '@/lib/maps/place-label';
import { toWinAnsi } from '@/lib/invoice/pdf';

/* The checkout pickup / drop-off text a driver reads on the voucher. Google keeps a hotel's NAME
 * ("Crystals Beach Resort Belle Mare") apart from its civic address ("Coastal Rd, Quatre Cocos…");
 * the checkout maps used to keep only the address. placeLabel joins them, but must not double up a
 * plain-address pick or plant a name the voucher PDF would strip to nothing. */

const place = (name: string | null, formatted_address: string | null): LabeledPlace => ({
  name,
  formatted_address,
});

describe('placeLabel', () => {
  it('prepends the hotel name to its civic address', () => {
    expect(
      placeLabel(
        place('Crystals Beach Resort Belle Mare', 'Coastal Rd, Quatre Cocos 41601, Mauritius'),
      ),
    ).toBe('Crystals Beach Resort Belle Mare, Coastal Rd, Quatre Cocos 41601, Mauritius');
  });

  it('does not double up when the name already begins the address (a plain-address pick)', () => {
    // Google returns name = the first line of the address for a non-establishment result.
    expect(placeLabel(place('Coastal Rd', 'Coastal Rd, Quatre Cocos, Mauritius'))).toBe(
      'Coastal Rd, Quatre Cocos, Mauritius',
    );
  });

  it('is case-insensitive when de-duplicating the name against the address', () => {
    expect(placeLabel(place('coastal rd', 'Coastal Rd, Quatre Cocos, Mauritius'))).toBe(
      'Coastal Rd, Quatre Cocos, Mauritius',
    );
  });

  it('keeps just the name when there is no civic address', () => {
    expect(placeLabel(place('Le Touessrok', ''))).toBe('Le Touessrok');
    expect(placeLabel(place('Le Touessrok', null))).toBe('Le Touessrok');
  });

  it('keeps just the address when there is no name', () => {
    expect(placeLabel(place('', 'Coastal Rd, Quatre Cocos, Mauritius'))).toBe(
      'Coastal Rd, Quatre Cocos, Mauritius',
    );
  });

  it('keeps accented French names — Latin-1 prints fine and Mauritius is full of them', () => {
    expect(placeLabel(place('Café Möka', 'Curepipe, Mauritius'))).toBe(
      'Café Möka, Curepipe, Mauritius',
    );
  });

  it('drops a foreign-script name the voucher PDF would delete, keeping the printable address', () => {
    expect(placeLabel(place('香格里拉酒店', 'Coastal Rd, Mauritius'))).toBe(
      'Coastal Rd, Mauritius',
    );
    expect(placeLabel(place('Пляж Бель Мар', 'Belle Mare, Mauritius'))).toBe(
      'Belle Mare, Mauritius',
    );
  });

  it('falls back to the typed value when the name is unprintable and there is no address', () => {
    expect(placeLabel(place('香格里拉酒店', ''), 'shangri')).toBe('shangri');
  });

  it('returns the fallback when the place carries nothing usable', () => {
    expect(placeLabel(place('', ''), 'typed text')).toBe('typed text');
    expect(placeLabel(place(null, null))).toBe('');
  });

  it('truncates to 160 chars so the driver sees what the customer saw', () => {
    const longName = 'A'.repeat(120);
    const longAddr = 'B'.repeat(120);
    expect(placeLabel(place(longName, longAddr))).toHaveLength(160);
  });

  it('every label it emits survives the real voucher PDF encoder intact', () => {
    // A label that reaches the driver mangled or blank is worse than a bare address. Cross-check the
    // combined output against the actual WinAnsi encoder, not just the address half.
    const samples: LabeledPlace[] = [
      place('Crystals Beach Resort Belle Mare', 'Coastal Rd, Quatre Cocos 41601, Mauritius'),
      place('Café Möka', 'Curepipe, Mauritius'),
      place('香格里拉酒店', 'Coastal Rd, Mauritius'),
      place("Trou d'Eau Douce", 'Île Maurice'),
    ];
    for (const s of samples) {
      const label = placeLabel(s);
      const encoded = toWinAnsi(label);
      expect(encoded.trim().length, `expected "${label}" to survive encoding`).toBeGreaterThan(0);
      // No character silently deleted (WinAnsi drops unmapped code points outright).
      expect(encoded.length, `expected "${label}" to lose no characters`).toBe(label.length);
    }
  });
});
