import { describe, expect, it } from 'vitest';
import { canAdvanceStep1, defaultWantsPickup } from '@/lib/checkout/pickup';

describe('defaultWantsPickup', () => {
  it('defaults to yes when the activity is pickup-capable, even with no fee hint or prefill', () => {
    expect(defaultWantsPickup({ pickupCapable: true, hasTransportHint: false, hasPickupPrefill: false })).toBe(true);
  });
  it('defaults to no for a fixed-location activity (not capable, no hint, no prefill)', () => {
    expect(defaultWantsPickup({ pickupCapable: false, hasTransportHint: false, hasPickupPrefill: false })).toBe(false);
  });
  it('defaults to yes when a transport fee was already computed', () => {
    expect(defaultWantsPickup({ pickupCapable: false, hasTransportHint: true, hasPickupPrefill: false })).toBe(true);
  });
  it('defaults to yes when an upstream entry point pre-filled a pickup address', () => {
    expect(defaultWantsPickup({ pickupCapable: false, hasTransportHint: false, hasPickupPrefill: true })).toBe(true);
  });
});

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
