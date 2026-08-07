import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { makeSupabaseShim } from '../db/supabase-pglite';
import type { Database } from '@/lib/supabase/types';
import type { PaymentEvent } from '@/lib/payments/types';
import { reconcilePaymentEvent } from '@/lib/payments/reconcile';

/**
 * The tokenisation HARVEST: when a customer-present checkout the customer chose to save comes back with
 * a `registrationId` on the status payload, reconcilePaymentEvent stores it against the booking owner —
 * but ONLY after the credit has landed, and never as anything that can fail the confirmation.
 */
const CUSTOMER = 'c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1';
const CHARGED_MUR_MINOR = 530000; // 2 × €50 at the 53.00 fx floor (no fresh rate seeded)

describe('saved-card harvest (reconcilePaymentEvent)', () => {
  let db: TestDb;
  let optionId: string;
  let operatorId: string;
  let admin: SupabaseClient<Database>;

  async function seedPayable(key: string): Promise<string> {
    await db.asOwner();
    const occId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '5 days', now() + interval '5 days 3 hours', 20) returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booking = await apiBook<{ ref: string }>(db, {
      occurrenceId: occId,
      party: { Adult: 2 },
      customerName: 'Save Card Customer',
      customerEmail: 'save@example.com',
      source: 'web',
      idempotencyKey: `${key}-book`,
    });
    await db.pg.query(`select api_create_payment($1::jsonb) as data`, [
      JSON.stringify({ bookingRef: booking.ref, idempotencyKey: `${key}-pay` }),
    ]);
    return booking.ref;
  }

  function paidEvent(ref: string, ref2: string, withToken: boolean): PaymentEvent {
    return {
      outcome: 'paid',
      bookingRef: ref,
      providerReference: ref2,
      amountMinor: CHARGED_MUR_MINOR,
      currency: 'MUR',
      ...(withToken
        ? {
            registrationId: 'reg_live_123',
            cardBrand: 'VISA',
            cardLast4: '4242',
            cardExpMonth: 11,
            cardExpYear: 2029,
          }
        : {}),
      raw: { status: 'paid' },
    };
  }

  async function cardsFor(userId: string): Promise<Array<Record<string, unknown>>> {
    await db.as({ sub: userId, role: 'authenticated' });
    return (
      await db.pg.query<{ data: Array<Record<string, unknown>> }>(
        `select api_list_saved_cards('{}'::jsonb) as data`,
      )
    ).rows[0]!.data;
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`)).rows[0]!
      .id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
    const actId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'save-card-tour', 'activity', 'Save Card Tour', 'Sightseeing tours', 'published')
         returning id`,
        [operatorId],
      )
    ).rows[0]!.id;
    optionId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Standard') returning id`,
        [actId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 5000)`,
      [optionId],
    );
    admin = makeSupabaseShim(db.pg) as unknown as SupabaseClient<Database>;
  });

  afterAll(() => db.close());

  it('stores the card token against the owner when the paid status carries a registrationId', async () => {
    const ref = await seedPayable('harvest-yes');
    await db.as({ sub: 'service', role: 'service_role' });

    const result = await reconcilePaymentEvent(admin, paidEvent(ref, 'peach_1', true));
    expect(result).toMatchObject({ confirmed: true, outcome: 'paid' });

    const cards = await cardsFor(CUSTOMER);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ brand: 'VISA', last4: '4242', expMonth: 11, expYear: 2029 });
    // The token itself must never reach the account API.
    expect(JSON.stringify(cards)).not.toContain('reg_live_123');
  });

  it('stores nothing when the paid status carries no token (customer did not opt in)', async () => {
    const ref = await seedPayable('harvest-no');
    await db.as({ sub: 'service', role: 'service_role' });

    const result = await reconcilePaymentEvent(admin, paidEvent(ref, 'peach_2', false));
    expect(result.confirmed).toBe(true);

    // Still exactly the one card from the previous test — no new row for this tokenless confirmation.
    expect(await cardsFor(CUSTOMER)).toHaveLength(1);
  });
});
