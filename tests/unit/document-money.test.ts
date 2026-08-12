import { describe, it, expect } from 'vitest';
import {
  CURRENCY_SYMBOL,
  formatMinor,
  isCurrency,
  minorToMajor,
  parseAmountToMinor,
} from '@/lib/documents/money';

describe('parseAmountToMinor', () => {
  it('parses a grouped amount to minor units', () => {
    expect(parseAmountToMinor('58,000')).toBe(5800000);
    expect(parseAmountToMinor('58000')).toBe(5800000);
    expect(parseAmountToMinor(' 1 234.5 ')).toBe(123450);
    expect(parseAmountToMinor('58000.50')).toBe(5800050);
    expect(parseAmountToMinor('0')).toBe(0);
  });

  it('throws on a blank, non-numeric, negative or over-precise amount', () => {
    expect(() => parseAmountToMinor('')).toThrow();
    expect(() => parseAmountToMinor('   ')).toThrow();
    expect(() => parseAmountToMinor('abc')).toThrow();
    expect(() => parseAmountToMinor('-1')).toThrow();
    expect(() => parseAmountToMinor('1.234')).toThrow();
    expect(() => parseAmountToMinor('.5')).toThrow();
    expect(() => parseAmountToMinor('5.')).toThrow();
  });
});

describe('formatMinor / minorToMajor', () => {
  it('formats minor units as a grouped 2-dp string', () => {
    expect(formatMinor(5800000)).toBe('58,000.00');
    expect(formatMinor(756522)).toBe('7,565.22');
    expect(formatMinor(0)).toBe('0.00');
    expect(formatMinor(50)).toBe('0.50');
  });

  it('round-trips major and minor', () => {
    expect(minorToMajor(5800000)).toBe(58000);
    expect(parseAmountToMinor(String(minorToMajor(5800050)))).toBe(5800050);
  });
});

describe('currency', () => {
  it('knows the three supported currencies and their WinAnsi-safe symbols', () => {
    expect(isCurrency('MUR')).toBe(true);
    expect(isCurrency('EUR')).toBe(true);
    expect(isCurrency('USD')).toBe(true);
    expect(isCurrency('GBP')).toBe(false);
    expect(CURRENCY_SYMBOL.MUR).toBe('Rs');
    // No non-ASCII glyphs — the PDF renderer draws these directly.
    for (const symbol of Object.values(CURRENCY_SYMBOL)) {
      expect(symbol).toMatch(/^[\x20-\x7E]+$/);
    }
  });
});
