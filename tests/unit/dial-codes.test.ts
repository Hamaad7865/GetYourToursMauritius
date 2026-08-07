import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DIAL_CODE,
  DIAL_CODES,
  composePhone,
  dialCodeForCountry,
  splitPhone,
} from '@/lib/phone/dial-codes';

/**
 * The checkout phone field's dial-code picker.
 *
 * The stored value stays ONE string (bookings.customer_phone) — the picker is a lens over it, so
 * every existing number (a profile prefill, a restored checkout draft) has to survive
 * split → edit → compose unchanged.
 */
describe('DIAL_CODES list', () => {
  it('has a unique code per row — a <select> cannot key two options the same', () => {
    const codes = DIAL_CODES.map((d) => d.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('leads with the home market', () => {
    expect(DIAL_CODES[0]!.code).toBe('+230');
    expect(DEFAULT_DIAL_CODE).toBe('+230');
  });

  it('gives every row a +-prefixed numeric code, a name and a flag', () => {
    for (const d of DIAL_CODES) {
      expect(d.code, `${d.name} has a malformed code`).toMatch(/^\+\d{1,4}$/);
      expect(d.name.trim().length).toBeGreaterThan(0);
      expect(d.flag.trim().length).toBeGreaterThan(0);
    }
  });

  it('covers every country the checkout Country select offers except "Other"', () => {
    // Mirrors COUNTRIES in src/components/checkout/Checkout.tsx — a traveller who picks their
    // country upstairs must get a dial code downstairs.
    const CHECKOUT_COUNTRIES = [
      'Mauritius',
      'United Kingdom',
      'France',
      'Germany',
      'India',
      'South Africa',
      'Réunion',
      'Italy',
      'Spain',
      'Switzerland',
      'Belgium',
      'Netherlands',
      'Austria',
      'Ireland',
      'Portugal',
      'Sweden',
      'Norway',
      'Denmark',
      'Poland',
      'Russia',
      'China',
      'Australia',
      'United States',
      'Canada',
      'United Arab Emirates',
      'Saudi Arabia',
      'Madagascar',
      'Seychelles',
      'Kenya',
    ];
    for (const country of CHECKOUT_COUNTRIES) {
      expect(dialCodeForCountry(country), `no dial code for ${country}`).not.toBeNull();
    }
  });
});

describe('dialCodeForCountry', () => {
  it('maps a checkout country name to its code', () => {
    expect(dialCodeForCountry('Mauritius')).toBe('+230');
    expect(dialCodeForCountry('United Kingdom')).toBe('+44');
  });

  it('matches either half of a shared row', () => {
    expect(dialCodeForCountry('United States')).toBe('+1');
    expect(dialCodeForCountry('Canada')).toBe('+1');
    expect(dialCodeForCountry('Réunion')).toBe('+262');
    expect(dialCodeForCountry('Mayotte')).toBe('+262');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(dialCodeForCountry('  france ')).toBe('+33');
  });

  it('returns null for "Other" and for anything unknown, so the caller leaves the code alone', () => {
    expect(dialCodeForCountry('Other')).toBeNull();
    expect(dialCodeForCountry('Atlantis')).toBeNull();
    expect(dialCodeForCountry('')).toBeNull();
    expect(dialCodeForCountry(null)).toBeNull();
  });
});

describe('splitPhone', () => {
  it('takes the LONGEST matching code — +230 is not +2 followed by 30', () => {
    expect(splitPhone('+230 5123 4567')).toEqual({ dialCode: '+230', national: '5123 4567' });
    expect(splitPhone('+27 82 123 4567')).toEqual({ dialCode: '+27', national: '82 123 4567' });
    expect(splitPhone('+262 692 000000')).toEqual({ dialCode: '+262', national: '692 000000' });
  });

  it('parses a code written with no space after it', () => {
    expect(splitPhone('+2305123456')).toEqual({ dialCode: '+230', national: '5123456' });
  });

  it('keeps the customer’s own punctuation in the national part', () => {
    expect(splitPhone('+44 (0)7700 900123')).toEqual({
      dialCode: '+44',
      national: '(0)7700 900123',
    });
  });

  it('leaves a bare national number untouched rather than guessing a country', () => {
    expect(splitPhone('07700 900123')).toEqual({ dialCode: null, national: '07700 900123' });
  });

  it('leaves an unlisted code alone instead of mangling it', () => {
    // +599 (Caribbean Netherlands) is not in the list; the whole string must survive.
    expect(splitPhone('+599 1234567')).toEqual({ dialCode: null, national: '+599 1234567' });
  });

  it('handles empty and missing input', () => {
    expect(splitPhone('')).toEqual({ dialCode: null, national: '' });
    expect(splitPhone(null)).toEqual({ dialCode: null, national: '' });
    expect(splitPhone(undefined)).toEqual({ dialCode: null, national: '' });
  });
});

describe('composePhone', () => {
  it('joins the code and the national part', () => {
    expect(composePhone('+230', '5123 4567')).toBe('+230 5123 4567');
  });

  it('drops a national trunk 0 — never dialled with a country code', () => {
    expect(composePhone('+44', '07700 900123')).toBe('+44 7700 900123');
    expect(composePhone('+33', '06 12 34 56 78')).toBe('+33 6 12 34 56 78');
  });

  it('KEEPS an Italian leading zero — there the 0 is the number, not a trunk prefix', () => {
    // Italy's 1998 reform folded the trunk zero into the landline number itself: +39 06 … is the
    // dialable form and '+39 6 …' does not connect. Stripping it handed the driver a dead number.
    expect(composePhone('+39', '06 1234 5678')).toBe('+39 06 1234 5678');
    // An Italian mobile carries no zero to begin with, so it is untouched either way.
    expect(composePhone('+39', '333 123 4567')).toBe('+39 333 123 4567');
  });

  it('returns empty when there are no digits, so a lone code cannot pass the phone gate', () => {
    // The pickup gate is `phone.trim().length > 0`; '+230' alone would satisfy it with a number no
    // driver can ring.
    expect(composePhone('+230', '')).toBe('');
    expect(composePhone('+230', '   ')).toBe('');
    expect(composePhone('+230', 'call me')).toBe('');
  });

  it('trusts a pasted full international number over the picker', () => {
    expect(composePhone('+230', '+44 7700 900123')).toBe('+44 7700 900123');
  });

  it('falls back to the national part alone when no code is selected', () => {
    expect(composePhone(null, '5123 4567')).toBe('5123 4567');
  });
});

describe('split → compose round-trip', () => {
  it.each([
    '+230 5123 4567',
    '+44 7700 900123',
    '+33 6 12 34 56 78',
    '+262 692 000000',
    '+1 415 555 0132',
    '+39 06 1234 5678',
  ])('leaves %s unchanged when nothing is edited', (stored) => {
    const { dialCode, national } = splitPhone(stored);
    expect(composePhone(dialCode, national)).toBe(stored);
  });
});
