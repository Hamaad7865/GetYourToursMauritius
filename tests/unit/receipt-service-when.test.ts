import { describe, expect, it } from 'vitest';
import type { ServiceContext } from '@/lib/services/context';
import { loadBookingForReceipt } from '@/lib/services/receipt';

/**
 * The receipt loader carries the guest's pickup time to the invoice/email "Date" line. An airport
 * transfer brings it inside its `transfer` block; a hotel-to-hotel transfer has no airport
 * direction (so no block) and must carry `arrival_time` as `pickupTime`, or its document reverts to
 * the placeholder noon day-slot.
 */
function ctxReturning(receipt: Record<string, unknown>): ServiceContext {
  return { db: { rpc: async () => receipt } } as unknown as ServiceContext;
}

const base = {
  ref: 'BMT-HT1',
  customerName: 'Ada',
  customerEmail: 'ada@example.com',
  currency: 'EUR',
  totalEur: 40,
  activityTitle: 'Hotel transfer',
  when: '2026-10-07T08:00:00+00:00',
  items: [{ priceLabel: 'Sedan', quantity: 1, subtotalEur: 40 }],
  payment: null,
};

describe('loadBookingForReceipt — pickup time', () => {
  it('carries a hotel-to-hotel transfer’s arrival_time as pickupTime', async () => {
    const { booking } = await loadBookingForReceipt(
      ctxReturning({ ...base, tripDirection: null, arrivalTime: '07:15' }),
      'b-1',
    );
    expect(booking.transfer).toBeNull();
    expect(booking.pickupTime).toBe('07:15');
  });

  it('leaves pickupTime empty for an airport transfer — its time rides in the transfer block', async () => {
    const { booking } = await loadBookingForReceipt(
      ctxReturning({ ...base, tripDirection: 'arrival', arrivalTime: '16:00' }),
      'b-2',
    );
    expect(booking.transfer?.arrivalTime).toBe('16:00');
    expect(booking.pickupTime).toBeNull();
  });
});
