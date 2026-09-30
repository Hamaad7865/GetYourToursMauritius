import { describe, expect, it } from 'vitest';
import {
  assertDeliverable,
  galleryCompletionKind,
  markGalleryReady,
  type PhotoDeliveryClient,
  type PhotographyBookingDelivery,
} from '@/lib/admin/photography-mail';
import { ConflictError } from '@/lib/services/errors';

/**
 * Which email the "Confirm gallery complete" route sends. The ONLY input is the live
 * balance_due_minor read from the booking (never a client-sent amount): the photography deposit
 * flow owes the balance until the guest pays, so a remaining balance means the pay-balance email;
 * anything else — zero after a comped shoot, a manual full settlement, or the balance landing
 * before the studio confirmed — means the guest is only waiting for photos and gets the gallery
 * link directly. The guard exists so a settled booking is never emailed a payment page that says
 * "you owe €0.00".
 */
describe('galleryCompletionKind', () => {
  it('emails the balance request whenever a balance remains', () => {
    expect(galleryCompletionKind(1)).toBe('balance');
    expect(galleryCompletionKind(7500)).toBe('balance');
  });

  it('sends the gallery link directly when nothing is owed', () => {
    expect(galleryCompletionKind(0)).toBe('gallery');
    expect(galleryCompletionKind(-100)).toBe('gallery');
  });
});

/**
 * markGalleryReady is the one door every "your photos are ready" staff action goes through. It stamps
 * bookings.gallery_ready_at — which is what makes the gallery exist for the guest at all — and hands
 * back the balance from the SAME statement, so the email that follows is decided on a figure no older
 * than the stamp.
 */
type Call = { op: string; arg?: unknown };

function fakeDb(result: { data: Record<string, unknown>[] | null; error?: unknown }) {
  const calls: Call[] = [];
  const builder = {
    eq(column: string, value: string) {
      calls.push({ op: 'eq', arg: [column, value] });
      return builder;
    },
    select(columns: string) {
      calls.push({ op: 'select', arg: columns });
      return builder;
    },
    then<T>(
      resolve: (v: { data: Record<string, unknown>[] | null; error: unknown }) => T,
      reject?: (e: unknown) => T,
    ) {
      return Promise.resolve({ data: result.data, error: result.error ?? null }).then(
        resolve,
        reject,
      );
    },
  };
  const db = {
    from(table: string) {
      calls.push({ op: 'from', arg: table });
      return {
        select: () => builder,
        update(patch: Record<string, unknown>) {
          calls.push({ op: 'update', arg: patch });
          return builder;
        },
      };
    },
  } as unknown as PhotoDeliveryClient;
  return { db, calls };
}

describe('markGalleryReady', () => {
  it('stamps the booking and returns the balance from the same statement', async () => {
    const { db, calls } = fakeDb({ data: [{ id: 'b1', balance_due_minor: 7500 }] });
    const before = Date.now();
    const out = await markGalleryReady(db, 'b1');
    expect(out).toEqual({ balanceDueMinor: 7500 });

    expect(calls).toContainEqual({ op: 'from', arg: 'bookings' });
    expect(calls).toContainEqual({ op: 'eq', arg: ['id', 'b1'] });
    // The balance is asked back on the UPDATE itself, not from a separate earlier read.
    expect(calls).toContainEqual({ op: 'select', arg: 'id, balance_due_minor' });
    const patch = calls.find((c) => c.op === 'update')!.arg as { gallery_ready_at: string };
    expect(Object.keys(patch)).toEqual(['gallery_ready_at']);
    expect(Date.parse(patch.gallery_ready_at)).toBeGreaterThanOrEqual(before);
  });

  it('reports a zero balance for a booking that has already paid in full', async () => {
    const { db } = fakeDb({ data: [{ id: 'b1', balance_due_minor: 0 }] });
    expect(await markGalleryReady(db, 'b1')).toEqual({ balanceDueMinor: 0 });
  });

  it('is a conflict, not a silent success, when the booking vanished mid-request', async () => {
    const { db } = fakeDb({ data: [] });
    await expect(markGalleryReady(db, 'gone')).rejects.toBeInstanceOf(ConflictError);
  });

  it('surfaces a database failure', async () => {
    const { db } = fakeDb({ data: null, error: { message: 'boom' } });
    await expect(markGalleryReady(db, 'b1')).rejects.toThrow('boom');
  });
});

describe('assertDeliverable', () => {
  const booking = (status: string): PhotographyBookingDelivery => ({
    id: 'b1',
    ref: 'BMTABC123',
    customerName: 'Nina Guest',
    customerEmail: 'nina@example.com',
    currency: 'EUR',
    locale: null,
    status,
    balanceDueMinor: 0,
    packageTitle: 'Couples shoot',
  });

  it('admits a live booking', () => {
    expect(() => assertDeliverable(booking('confirmed'))).not.toThrow();
    expect(() => assertDeliverable(booking('completed'))).not.toThrow();
  });

  it('refuses a booking that is not live — no balance link for a refund, no stamp nobody can open', () => {
    for (const status of [
      'payment_pending',
      'cancelled',
      'refund_pending',
      'refunded',
      'expired',
    ]) {
      expect(() => assertDeliverable(booking(status))).toThrow(ConflictError);
    }
  });
});
