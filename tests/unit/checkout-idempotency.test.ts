import { describe, expect, it } from 'vitest';
import { resolveIdemKey } from '@/lib/checkout/idempotency';

describe('resolveIdemKey', () => {
  it('prefers the persisted key over a hold key and a fresh key', () => {
    expect(resolveIdemKey({ persisted: 'persisted', fromHold: 'hold', fresh: 'fresh' })).toBe(
      'persisted',
    );
  });

  it('falls back to the hold key when there is no persisted key', () => {
    expect(resolveIdemKey({ persisted: null, fromHold: 'hold', fresh: 'fresh' })).toBe('hold');
    expect(resolveIdemKey({ fromHold: 'hold', fresh: 'fresh' })).toBe('hold');
  });

  it('falls back to the fresh key when neither persisted nor hold is present', () => {
    expect(resolveIdemKey({ persisted: null, fromHold: null, fresh: 'fresh' })).toBe('fresh');
    expect(resolveIdemKey({ fresh: 'fresh' })).toBe('fresh');
  });

  it('ignores a whitespace-only persisted key and falls through to the hold key', () => {
    expect(resolveIdemKey({ persisted: '   ', fromHold: 'hold', fresh: 'fresh' })).toBe('hold');
  });

  it('ignores a whitespace-only hold key and falls through to the fresh key', () => {
    expect(resolveIdemKey({ persisted: '', fromHold: '  \t ', fresh: 'fresh' })).toBe('fresh');
  });

  it('trims a surviving persisted key so a stray space cannot break server-side dedup', () => {
    expect(resolveIdemKey({ persisted: '  abc-123  ', fromHold: 'hold', fresh: 'fresh' })).toBe(
      'abc-123',
    );
  });
});
