import { describe, expect, it } from 'vitest';
import { buildAccountExport, type ExportBookingInput } from '@/lib/account/export';

const profile = { full_name: 'Asha Ramdin', phone: '+230 5 123 4567' };

const bookings: ExportBookingInput[] = [
  {
    ref: 'BMT-1001',
    status: 'confirmed',
    total_minor: 12000,
    currency: 'EUR',
    created_at: '2026-01-10T08:00:00.000Z',
    pickup_location: 'Belle Mare Plage',
    dropoff_location: 'SSR Airport',
    items: [
      { price_label: 'Adult', quantity: 2, starts_at: '2026-02-01T05:30:00.000Z', title: 'Catamaran cruise' },
      { price_label: 'Child', quantity: 1, starts_at: '2026-02-01T05:30:00.000Z', title: 'Catamaran cruise' },
    ],
  },
  {
    ref: 'BMT-1002',
    status: 'draft',
    total_minor: 4500,
    currency: 'EUR',
    created_at: '2026-03-15T10:00:00.000Z',
    items: [{ price_label: 'Per group', quantity: 1 }],
  },
];

describe('buildAccountExport', () => {
  it('shapes profile + bookings into clean portable JSON', () => {
    const out = buildAccountExport(profile, 'asha@example.com', bookings, '2026-06-21T00:00:00.000Z');

    expect(out).toEqual({
      exportedAt: '2026-06-21T00:00:00.000Z',
      profile: { fullName: 'Asha Ramdin', phone: '+230 5 123 4567', email: 'asha@example.com' },
      bookings: [
        {
          ref: 'BMT-1001',
          status: 'confirmed',
          date: '2026-02-01T05:30:00.000Z',
          total: 120,
          currency: 'EUR',
          items: [
            { label: 'Catamaran cruise', qty: 2 },
            { label: 'Catamaran cruise', qty: 1 },
          ],
          pickup: 'Belle Mare Plage',
          dropoff: 'SSR Airport',
        },
        {
          ref: 'BMT-1002',
          status: 'draft',
          // No item start → falls back to the booking's created_at.
          date: '2026-03-15T10:00:00.000Z',
          total: 45,
          currency: 'EUR',
          items: [{ label: 'Per group', qty: 1 }],
        },
      ],
    });
  });

  it('omits exportedAt when not supplied (pure, stable shape)', () => {
    const out = buildAccountExport(profile, 'asha@example.com', []);
    expect(out).not.toHaveProperty('exportedAt');
    expect(out.bookings).toEqual([]);
  });

  it('carries no foreign/internal ids and no other-user data', () => {
    const out = buildAccountExport(profile, 'asha@example.com', bookings, '2026-06-21T00:00:00.000Z');
    const json = JSON.stringify(out);
    // Only the booking ref is an identifier; no row/user/occurrence/payment ids leak through.
    expect(json).not.toMatch(/booking_id|user_id|session_occurrence|activity_option|"id"/);
  });

  it('handles a null profile (export still produced)', () => {
    const out = buildAccountExport(null, null, []);
    expect(out.profile).toEqual({ fullName: null, phone: null, email: null });
  });

  it('omits pickup/dropoff keys when absent', () => {
    const [, draft] = buildAccountExport(profile, 'a@b.co', bookings).bookings;
    expect(draft).not.toHaveProperty('pickup');
    expect(draft).not.toHaveProperty('dropoff');
  });
});
