import { describe, expect, it } from 'vitest';
import { canAdvanceStep1 } from '@/lib/checkout/pickup';

describe('canAdvanceStep1', () => {
  it('blocks when pickup is wanted but address is empty and not TBD', () => {
    expect(canAdvanceStep1({ wantsPickup: true, address: '', tbd: false })).toBe(false);
  });
  it('allows when pickup is wanted and an address is set', () => {
    expect(canAdvanceStep1({ wantsPickup: true, address: 'Hotel X', tbd: false })).toBe(true);
  });
  it('allows when pickup is wanted but TBD', () => {
    expect(canAdvanceStep1({ wantsPickup: true, address: '', tbd: true })).toBe(true);
  });
  it('allows when no pickup is wanted', () => {
    expect(canAdvanceStep1({ wantsPickup: false, address: '', tbd: false })).toBe(true);
  });
});
