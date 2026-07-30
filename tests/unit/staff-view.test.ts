import { describe, expect, it } from 'vitest';
import { isStaffViewing } from '@/lib/booking/staff-view';

describe('isStaffViewing', () => {
  it('is true only for an explicit isOwn === false (a staff account on another guest’s booking)', () => {
    expect(isStaffViewing({ isOwn: false })).toBe(true);
  });

  it('is false for the booking owner', () => {
    expect(isStaffViewing({ isOwn: true })).toBe(false);
  });

  it('fails quiet when the DTO predates the field — an absent/null isOwn must never show the banner', () => {
    expect(isStaffViewing({})).toBe(false);
    expect(isStaffViewing({ isOwn: null })).toBe(false);
    expect(isStaffViewing({ isOwn: undefined })).toBe(false);
  });
});
