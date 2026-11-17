import type { SupabaseClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { seedOccurrence } from '../db/seed';
import { makeSupabaseShim } from '../db/supabase-pglite';
import { pgliteRpc } from '../db/rpc';
import { drainNotifications } from '@/lib/services/notifications';
import type { NotificationMessage, NotificationProvider } from '@/lib/notifications/types';
import type { ServiceContext } from '@/lib/services/context';
import type { Database } from '@/lib/supabase/types';

/**
 * Leaving the payment step releases the booking, and the expiry trigger queues "your reservation
 * wasn't paid in time". For someone who has already booked again that is the wrong email, so the drain
 * drops it. The rule is the one api_enqueue_checkout_recovery uses: any later booking at this address.
 */
describe('booking_expired, once the customer has booked again', () => {
  let db: TestDb;
  let ctx: ServiceContext;
  let occurrenceId: string;
  let n = 0;

  class Capturing implements NotificationProvider {
    readonly name = 'capture';
    messages: NotificationMessage[] = [];
    async send(message: NotificationMessage): Promise<void> {
      this.messages.push(message);
    }
  }

  async function book(email: string): Promise<{ ref: string; id: string }> {
    n += 1;
    const { ref } = await apiBook<{ ref: string }>(db, {
      occurrenceId,
      party: { Adult: 1 },
      customerName: 'Cust',
      customerEmail: email,
      source: 'web',
      idempotencyKey: `rebooked-${n}`,
    });
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(`select id from bookings where ref = $1`, [
      ref,
    ]);
    return { ref, id: rows[0]!.id };
  }

  async function expire(id: string): Promise<void> {
    await db.asOwner();
    await db.pg.query(`update bookings set status = 'expired' where id = $1`, [id]);
  }

  async function drain(): Promise<{ provider: Capturing; processed: number; sent: number }> {
    const provider = new Capturing();
    await db.asOwner();
    const { processed, sent } = await drainNotifications(ctx, provider);
    return { provider, processed, sent };
  }

  async function expiryRow(bookingId: string): Promise<{ status: string; sent_at: string | null }> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ status: string; sent_at: string | null }>(
      `select status, sent_at from notification_outbox
        where booking_id = $1 and template = 'booking_expired'`,
      [bookingId],
    );
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  beforeAll(async () => {
    db = await createTestDb();
    ({ occurrenceId } = await seedOccurrence(db, 1000));
    ctx = {
      db: pgliteRpc(db.pg),
      admin: makeSupabaseShim(db.pg) as unknown as SupabaseClient<Database>,
      now: () => new Date(),
      locale: 'en',
    } as unknown as ServiceContext;
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.asOwner();
    await db.pg.query(`update notification_outbox set status = 'sent' where status = 'pending'`);
  });

  it('drops the email, and leaves the row cancelled rather than sent', async () => {
    const first = await book('again@example.com');
    await expire(first.id);
    await book('again@example.com');

    const { provider, processed, sent } = await drain();

    expect(provider.messages).toHaveLength(0);
    expect({ processed, sent }).toEqual({ processed: 1, sent: 0 });
    expect(await expiryRow(first.id)).toEqual({ status: 'cancelled', sent_at: null });
  });

  it('never retries a dropped email', async () => {
    const first = await book('once@example.com');
    await expire(first.id);
    await book('once@example.com');
    await drain();

    const { processed } = await drain();

    expect(processed).toBe(0);
  });

  it('matches the address whatever its case', async () => {
    const first = await book('Case.Mix@Example.com');
    await expire(first.id);
    await book('case.mix@example.com');

    const { provider } = await drain();

    expect(provider.messages).toHaveLength(0);
  });

  it('sends it when the customer has not booked again', async () => {
    const only = await book('gone@example.com');
    await expire(only.id);

    const { provider, sent } = await drain();

    expect(sent).toBe(1);
    expect(provider.messages.map((m) => m.template)).toEqual(['booking_expired']);
    expect((await expiryRow(only.id)).status).toBe('sent');
  });

  it('still emails the last attempt, so someone who abandons both hears once', async () => {
    const first = await book('twice@example.com');
    await expire(first.id);
    const second = await book('twice@example.com');
    await expire(second.id);

    const { provider } = await drain();

    expect(provider.messages).toHaveLength(1);
    expect(provider.messages[0]!.payload.ref).toBe(second.ref);
    expect((await expiryRow(first.id)).status).toBe('cancelled');
  });

  it('ignores a booking made before this one', async () => {
    await book('order@example.com');
    const newest = await book('order@example.com');
    await expire(newest.id);

    const { provider } = await drain();

    expect(provider.messages).toHaveLength(1);
  });

  it('ignores someone else’s booking, even one the wildcard in `ilike` would match', async () => {
    const mine = await book('a_b@example.com');
    await expire(mine.id);
    await book('axb@example.com');

    const { provider } = await drain();

    expect(provider.messages).toHaveLength(1);
  });

  it('leaves every other template alone', async () => {
    const first = await book('other@example.com');
    await book('other@example.com');
    await db.asOwner();
    await db.pg.query(
      `insert into notification_outbox (channel, recipient, template, payload, booking_id)
       values ('email', 'other@example.com', 'booking_refunded', '{"ref":"X"}'::jsonb, $1)`,
      [first.id],
    );

    const { provider } = await drain();

    expect(provider.messages.map((m) => m.template)).toEqual(['booking_refunded']);
  });
});
