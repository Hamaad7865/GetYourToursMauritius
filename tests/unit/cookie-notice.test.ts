import { describe, expect, it } from 'vitest';
import { NOTICE_VERSION, shouldShowNotice, serializeAck } from '@/lib/consent/notice';

describe('shouldShowNotice', () => {
  it('shows when nothing is stored', () => {
    expect(shouldShowNotice(null)).toBe(true);
  });
  it('shows when the stored value is malformed', () => {
    expect(shouldShowNotice('not json')).toBe(true);
    expect(shouldShowNotice('{}')).toBe(true);
  });
  it('hides when acknowledged at the current version', () => {
    expect(
      shouldShowNotice(JSON.stringify({ acknowledged: true, version: NOTICE_VERSION, ts: 1 })),
    ).toBe(false);
  });
  it('shows again when the stored version is older', () => {
    expect(
      shouldShowNotice(JSON.stringify({ acknowledged: true, version: NOTICE_VERSION - 1, ts: 1 })),
    ).toBe(true);
  });
});
describe('serializeAck', () => {
  it('serializes the current version + the given timestamp', () => {
    expect(JSON.parse(serializeAck(123))).toEqual({
      acknowledged: true,
      version: NOTICE_VERSION,
      ts: 123,
    });
  });
});
