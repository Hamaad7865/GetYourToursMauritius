import { describe, expect, it } from 'vitest';
import {
  buildInquiryMessage,
  inquiryReady,
  packInquiryContact,
  type InquiryDetails,
} from '@/lib/catalogue/inquiry';

const FULL: InquiryDetails = {
  activityTitle: 'Skydiving',
  name: 'Jane Doe',
  email: 'jane@example.com',
  phone: '+230 5555 5555',
  date: '2026-09-01',
  people: 2,
};

describe('inquiryReady', () => {
  it('is true once name, email, phone, date and a people count are all present', () => {
    expect(inquiryReady(FULL)).toBe(true);
  });

  it('is false when any required field is missing', () => {
    expect(inquiryReady({ ...FULL, name: '' })).toBe(false);
    expect(inquiryReady({ ...FULL, name: '   ' })).toBe(false);
    expect(inquiryReady({ ...FULL, email: '' })).toBe(false);
    expect(inquiryReady({ ...FULL, phone: '' })).toBe(false);
    expect(inquiryReady({ ...FULL, date: '' })).toBe(false);
  });

  it('is false when the party size is zero or unset', () => {
    expect(inquiryReady({ ...FULL, people: 0 })).toBe(false);
    expect(inquiryReady({ name: 'Jane', email: 'a@b.com', phone: '123', date: '2026-09-01' })).toBe(
      false,
    );
  });
});

describe('buildInquiryMessage', () => {
  it('includes the activity title and every field', () => {
    const msg = buildInquiryMessage(FULL);
    expect(msg).toContain('Trip request: Skydiving');
    expect(msg).toContain('Name: Jane Doe');
    expect(msg).toContain('Preferred date: 2026-09-01');
    expect(msg).toContain('People: 2');
    expect(msg).toContain('Phone: +230 5555 5555');
    expect(msg).toContain('Email: jane@example.com');
  });

  it('falls back to "Flexible" when no date is chosen', () => {
    expect(buildInquiryMessage({ ...FULL, date: '' })).toContain('Preferred date: Flexible');
  });
});

describe('packInquiryContact', () => {
  it('joins phone, email, date and party size with " · "', () => {
    expect(packInquiryContact(FULL)).toBe(
      '+230 5555 5555 · jane@example.com · Date: 2026-09-01 · 2 people',
    );
  });

  it('omits the date segment when unset', () => {
    expect(packInquiryContact({ ...FULL, date: '' })).toBe(
      '+230 5555 5555 · jane@example.com · 2 people',
    );
  });

  it('uses singular "person" for a party of one', () => {
    const packed = packInquiryContact({ ...FULL, people: 1 });
    expect(packed).toContain('1 person');
    expect(packed).not.toContain('1 people');
  });

  it("stays within the leads schema's 200-char contact cap", () => {
    const long = { ...FULL, phone: 'x'.repeat(250) };
    expect(packInquiryContact(long).length).toBeLessThanOrEqual(200);
  });
});
