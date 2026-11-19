import { describe, expect, it } from 'vitest';
import { missingDetail } from '@/lib/checkout/details-gate';

const guest = { guestMode: true, phoneRequired: true };
const filled = { name: 'Ana Rose', email: 'ana@example.com', phone: '+230 5123 4567' };

describe('missingDetail (checkout step ②)', () => {
  it('lets a complete guest through', () => {
    expect(missingDetail({ ...guest, ...filled })).toBeNull();
  });

  it('names the first missing field, in form order', () => {
    expect(missingDetail({ ...guest, ...filled, name: '  ' })).toBe('name');
    expect(missingDetail({ ...guest, ...filled, name: '', email: '' })).toBe('name');
    expect(missingDetail({ ...guest, ...filled, email: 'ana@example' })).toBe('email');
    expect(missingDetail({ ...guest, ...filled, phone: '' })).toBe('phone');
  });

  it('asks a signed-in customer only for the phone a pickup needs', () => {
    const signedIn = { guestMode: false, phoneRequired: true, name: '', email: '', phone: '' };
    expect(missingDetail(signedIn)).toBe('phone');
    expect(missingDetail({ ...signedIn, phone: '+230 5123 4567' })).toBeNull();
  });

  it('needs no phone when the booking has no pickup', () => {
    expect(missingDetail({ ...guest, phoneRequired: false, ...filled, phone: '' })).toBeNull();
  });
});
