import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { catalogueSchema } from '@/lib/seed/schema';
import { catalogueToSeedSql } from '@/lib/seed/sql';
import type { ServiceContext } from '@/lib/services/context';
import { ServiceError } from '@/lib/services/errors';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { getActivity, searchActivities } from '@/lib/services/activities';
import { checkAvailability } from '@/lib/services/availability';
import { createBooking, getBookingStatus } from '@/lib/services/bookings';
import { createPaymentLink } from '@/lib/services/payments';
import { captureLead } from '@/lib/services/leads';

const catalogue = catalogueSchema.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'seed', 'catalogue.json'), 'utf8')),
);

const USER = 'a9a9a9a9-a9a9-a9a9-a9a9-a9a9a9a9a9a9';

describe('service layer (via PGlite rpc)', () => {
  let db: TestDb;
  let ctx: ServiceContext;
  let occurrenceId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.exec(catalogueToSeedSql(catalogue));
    ctx = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
    };
    const { rows } = await db.pg.query<{ id: string }>(
      `select so.id from session_occurrences so
       join activity_options o on o.id = so.activity_option_id
       join activities a on a.id = o.activity_id
       where a.slug = 'private-south-tour-with-pickup' limit 1`,
    );
    occurrenceId = rows[0]!.id;
    // Run the suite as a logged-in customer so bookings are owned (payment requires ownership).
    await db.pg.query(`insert into auth.users (id) values ($1)`, [USER]);
    await db.as({ sub: USER, role: 'authenticated' });
  });

  afterAll(async () => {
    await db.close();
  });

  it('searchActivities returns a paginated catalogue', async () => {
    const result = await searchActivities(ctx, { page: 1, pageSize: 5 });
    expect(result.total).toBe(catalogue.activities.length);
    expect(result.items).toHaveLength(5);
    expect(result.items[0]!.slug).toBeTruthy();
  });

  it('getActivity returns detail and 404s on unknown slug', async () => {
    const detail = await getActivity(ctx, 'private-south-tour-with-pickup');
    expect(detail.options[0]!.prices[0]!.amountEur).toBe(110);
    await expect(getActivity(ctx, 'does-not-exist')).rejects.toBeInstanceOf(ServiceError);
  });

  it('checkAvailability returns occurrences with seats_left', async () => {
    const slots = await checkAvailability(ctx, { slug: 'private-south-tour-with-pickup' });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0]!.seatsLeft).toBeLessThanOrEqual(slots[0]!.capacity);
  });

  it('createBooking → createPaymentLink → getBookingStatus end to end', async () => {
    const booking = await createBooking(ctx, {
      occurrenceId,
      party: { 'Private group': 2 },
      customer: { name: 'Léa', email: 'lea@example.com' },
      idempotencyKey: 'svc-book-1',
    });
    expect(booking.status).toBe('payment_pending');
    expect(booking.totalEur).toBe(220); // 2 × €110, from the DB

    const link = await createPaymentLink(ctx, {
      bookingRef: booking.ref,
      returnUrl: 'https://example.com/return',
      idempotencyKey: 'svc-pay-1',
    });
    expect(link.provider).toBe('stub');
    expect(link.redirectUrl).toContain('https://example.com/return');

    const status = await getBookingStatus(ctx, booking.ref);
    expect(status.ref).toBe(booking.ref);
    expect(status.items).toHaveLength(1);
  });

  it('books a vehicle tour at the SUV flat price when suv is set (service path)', async () => {
    // Flip the seeded south tour into a vehicle-priced sightseeing tour just for this case, then
    // restore its original mode so later tests are unaffected.
    await db.asOwner();
    const orig = (
      await db.pg.query<{ pricing_mode: string }>(
        `select pricing_mode from activities where slug = 'private-south-tour-with-pickup'`,
      )
    ).rows[0]!.pricing_mode;
    await db.pg.query(`update activities set pricing_mode = 'vehicle' where slug = 'private-south-tour-with-pickup'`);
    await db.as({ sub: USER, role: 'authenticated' });

    const booking = await createBooking(ctx, {
      occurrenceId,
      expectedSlug: 'private-south-tour-with-pickup',
      party: { Vehicle: 3 },
      suv: true,
      customer: { name: 'A', email: 'suv@example.com' },
      idempotencyKey: 'svc-suv-1',
    });
    expect(booking.totalEur).toBe(85); // flat SUV price, not 3 × anything
    expect(booking.items[0]!.priceLabel).toBe('SUV');
    expect(booking.items[0]!.pax).toBe(3);
    expect(booking.items[0]!.quantity).toBe(1); // one vehicle slot

    await db.asOwner();
    await db.pg.query(`update activities set pricing_mode = $1 where slug = 'private-south-tour-with-pickup'`, [orig]);
    await db.as({ sub: USER, role: 'authenticated' });
  });

  it('maps a DB exception to a ServiceError (unknown occurrence)', async () => {
    await expect(
      createBooking(ctx, {
        occurrenceId: '00000000-0000-0000-0000-000000000000',
        party: { Adult: 1 },
        customer: { name: 'X', email: 'x@example.com' },
        idempotencyKey: 'svc-bad-1',
      }),
    ).rejects.toBeInstanceOf(ServiceError);
  });

  it('captureLead records a lead', async () => {
    const lead = await captureLead(ctx, { name: 'Walk-in', contact: 'walkin@example.com' });
    expect(lead.status).toBe('new');
  });
});
