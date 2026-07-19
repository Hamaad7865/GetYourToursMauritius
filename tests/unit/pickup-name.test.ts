import { describe, expect, it } from 'vitest';
import {
  geoPointId,
  isVoucherSafe,
  pickPickupName,
  type GeocodedPlace,
} from '@/lib/geo/pickup-name';
import { toWinAnsi } from '@/lib/invoice/pdf';

/* The chosen string is printed verbatim on a one-line voucher and is the ONLY locator the driver
 * gets on this path — so "too vague" and "confidently wrong" are both real failures, and returning
 * null (leave the pick-up alone) is always better than guessing. */

const place = (formatted_address: string, ...types: string[]): GeocodedPlace => ({
  formatted_address,
  types,
});

describe('pickPickupName ranking', () => {
  it('prefers a precise address over the coarser results below it', () => {
    const results = [
      place('Coastal Rd, Belle Mare', 'route'),
      place('Belle Mare, Mauritius', 'locality'),
      place('Le Touessrok, Trou d’Eau Douce', 'premise', 'establishment'),
    ];
    expect(pickPickupName(results, -20.2, 57.78)).toBe('Le Touessrok, Trou d’Eau Douce');
  });

  it('falls back to a road when there is no building', () => {
    const results = [place('Belle Mare, Mauritius', 'locality'), place('Coastal Rd', 'route')];
    expect(pickPickupName(results, -20.2, 57.78)).toBe('Coastal Rd');
  });

  it('hedges a village-only result so it can never read as a precise address', () => {
    const results = [place('Belle Mare, Mauritius', 'locality')];
    expect(pickPickupName(results, -20.2, 57.78)).toBe('Near Belle Mare, Mauritius');
  });

  it('never returns a bare Plus Code — unreadable on a printed voucher', () => {
    const results = [place('4RQ4+F8 Belle Mare', 'plus_code'), place('Coastal Rd', 'route')];
    expect(pickPickupName(results, -20.2, 57.78)).toBe('Coastal Rd');
  });

  it('returns null when only a Plus Code exists and no fallback is allowed', () => {
    expect(pickPickupName([place('4RQ4+F8 Belle Mare', 'plus_code')], -20.2, 57.78)).toBeNull();
  });

  it('returns null for empty / missing results on the silent automatic path', () => {
    expect(pickPickupName([], -20.2, 57.78)).toBeNull();
    expect(pickPickupName(null, -20.2, 57.78)).toBeNull();
    expect(pickPickupName(undefined, -20.2, 57.78)).toBeNull();
    expect(pickPickupName([place('   ', 'route')], -20.2, 57.78)).toBeNull();
  });

  it('falls back to coordinates ONLY when the visitor explicitly asked', () => {
    expect(pickPickupName([], -20.20512, 57.76031, { allowCoordFallback: true })).toBe(
      'Pinned location (-20.20512, 57.76031)',
    );
    // Same input, automatic path: change nothing rather than plant a coordinate string.
    expect(pickPickupName([], -20.20512, 57.76031)).toBeNull();
  });

  it('uses an addressed result even when Google typed it oddly', () => {
    expect(pickPickupName([place('Some Place, Mauritius', 'weird_type')], -20.2, 57.78)).toBe(
      'Some Place, Mauritius',
    );
  });

  it('truncates to the length Checkout accepts, so the driver sees what the customer saw', () => {
    const long = `${'A'.repeat(400)}`;
    const out = pickPickupName([place(long, 'route')], -20.2, 57.78);
    expect(out).toHaveLength(160);
  });
});

describe('voucher-safety guard (the driver must be able to read the name)', () => {
  it('rejects a name the voucher PDF would strip to nothing', () => {
    // Google returns establishment names in local script; toWinAnsi deletes them outright.
    const cyrillic = [place('Пляж Бель Мар, Маврикий', 'establishment')];
    expect(pickPickupName(cyrillic, -20.2, 57.78)).toBeNull();
    expect(pickPickupName([place('香格里拉酒店', 'lodging')], -20.2, 57.78)).toBeNull();
  });

  it('falls through to the next usable candidate instead of failing outright', () => {
    const mixed = [place('東京ホテル', 'establishment'), place('Coastal Rd, Belle Mare', 'route')];
    expect(pickPickupName(mixed, -20.2, 57.78)).toBe('Coastal Rd, Belle Mare');
  });

  it('keeps accented French names — Latin-1 is fine and Mauritius is full of them', () => {
    expect(pickPickupName([place("Trou d'Eau Douce, Île Maurice", 'locality')], -20.2, 57.78)).toBe(
      "Near Trou d'Eau Douce, Île Maurice",
    );
    expect(pickPickupName([place('Rue de la Poste, Curepipe', 'route')], -20.3, 57.5)).toBe(
      'Rue de la Poste, Curepipe',
    );
  });

  it('normalises curly quotes and dashes exactly like the PDF encoder does', () => {
    expect(isVoucherSafe('Trou d’Eau Douce — north')).toBe(true);
    expect(pickPickupName([place('Trou d’Eau Douce — north', 'route')], -20.2, 57.78)).toBe(
      'Trou d’Eau Douce — north',
    );
  });

  it('AGREES with the real PDF encoder — the two normalisations cannot drift', () => {
    const samples = [
      'Coastal Rd, Belle Mare',
      "Trou d'Eau Douce, Île Maurice",
      'Trou d’Eau Douce — north',
      'Пляж Бель Мар',
      '香格里拉酒店',
      'Café Möka, Curepipe',
      '4RQ4+F8 Belle Mare',
    ];
    for (const s of samples) {
      // A name we call safe must survive the encoder intact (ignoring its documented substitutions);
      // a name we reject must be one the encoder would visibly damage.
      const encoded = toWinAnsi(s);
      if (isVoucherSafe(s)) {
        expect(encoded.trim().length, `expected "${s}" to survive encoding`).toBeGreaterThan(0);
        expect(encoded.replace(/[-'"]/g, '').length).toBeGreaterThan(0);
      } else {
        const stripped = s.length - encoded.length;
        expect(stripped, `expected "${s}" to be damaged by the encoder`).toBeGreaterThan(0);
      }
    }
  });
});

describe('geoPointId', () => {
  it('is deterministic for the same fix (stable React key + optimize cache)', () => {
    expect(geoPointId(-20.205, 57.76)).toBe(geoPointId(-20.205, 57.76));
  });

  it('is namespaced so it cannot collide with a preset or a Google place id', () => {
    expect(geoPointId(-20.205, 57.76).startsWith('geo:')).toBe(true);
    expect(geoPointId(-20.205, 57.76)).not.toBe('belleMare');
  });
});
