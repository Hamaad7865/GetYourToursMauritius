import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { pgliteRpc } from '../db/rpc';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import { drainNotifications } from '@/lib/services/notifications';
import { SITE } from '@/lib/seo/site';
import type { ServiceContext } from '@/lib/services/context';
import type { NotificationMessage, NotificationProvider } from '@/lib/notifications/types';

/**
 * The gallery-ready flow (20261013000000). The studio uploads the shoot and presses "Confirm gallery
 * complete" (which stamps bookings.gallery_ready_at); the guest pays the balance; only THEN does
 * notify_balance_paid's settled-in-full branch enqueue ONE 'gallery_ready' outbox row, keyed per
 * booking so a retried settlement cannot double-send.
 *
 * Every gate is pinned here, because each one is a way to email or show a guest something wrong:
 *  - the studio's confirmation — photos merely being uploaded must NOT trigger the email (a guest who
 *    pays mid-upload would be told, and shown, half a shoot);
 *  - at least one photo — a confirmed gallery whose photos are gone promises nothing;
 *  - the photography category — a settled tour booking gets nothing.
 * The other settled-in-full emails (booking_confirmation, owner_balance_paid) are unaffected.
 */
const CUSTOMER = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

interface BookingRow {
  id: string;
  ref: string;
  balance_due_minor: number;
  status: string;
}

async function booking(db: TestDb, ref: string): Promise<BookingRow> {
  await db.asOwner();
  const { rows } = await db.pg.query<BookingRow>(
    `select id, ref, balance_due_minor::int, status::text from bookings where ref = $1`,
    [ref],
  );
  return rows[0]!;
}

async function payment(db: TestDb, bookingId: string, purpose: string) {
  await db.asOwner();
  const { rows } = await db.pg.query<{ id: string; amount_minor: number }>(
    `select id, amount_minor::int from payments where booking_id = $1 and purpose = $2
      order by created_at desc limit 1`,
    [bookingId, purpose],
  );
  return rows[0]!;
}

async function settle(db: TestDb, paymentId: string, amount: number, evt: string) {
  await db.asOwner();
  await db.pg.query(`select append_payment_event($1, 'paid', $2, $3, now(), '{}'::jsonb)`, [
    paymentId,
    evt,
    amount,
  ]);
}

interface OutboxRow {
  channel: string;
  recipient: string;
  template: string;
  idempotency_key: string;
  payload: {
    ref?: string;
    customerName?: string;
    packageTitle?: string | null;
    photoCount?: number;
    locale?: string;
    galleryUrl?: string;
  };
}

async function outbox(db: TestDb, bookingId: string, template: string): Promise<OutboxRow[]> {
  await db.asOwner();
  const { rows } = await db.pg.query<OutboxRow>(
    `select channel, recipient, template, idempotency_key, payload
       from notification_outbox where booking_id = $1 and template = $2`,
    [bookingId, template],
  );
  return rows;
}

/** Open + settle the deposit (booking purpose). */
async function payDeposit(db: TestDb, ref: string, key: string, evt: string): Promise<void> {
  const b = await booking(db, ref);
  await db.as({ sub: CUSTOMER, role: 'authenticated' });
  await call(db, 'api_create_payment', { bookingRef: ref, idempotencyKey: key });
  const dep = await payment(db, b.id, 'booking');
  await settle(db, dep.id, dep.amount_minor, `${evt}-dep`);
}

/** Open + settle the balance; returns the balance payment id. */
async function payBalance(
  db: TestDb,
  ref: string,
  key: string,
  evt: string,
): Promise<{ bookingId: string; balancePaymentId: string }> {
  const b = await booking(db, ref);
  await db.as({ sub: CUSTOMER, role: 'authenticated' });
  await call(db, 'api_create_payment', {
    bookingRef: ref,
    idempotencyKey: key,
    purpose: 'balance',
  });
  const bal = await payment(db, b.id, 'balance');
  await settle(db, bal.id, bal.amount_minor, `${evt}-bal`);
  return { bookingId: b.id, balancePaymentId: bal.id };
}

/** Captures what the drain hands the provider (never throws). */
class CapturingProvider implements NotificationProvider {
  readonly name = 'capture';
  messages: NotificationMessage[] = [];
  async send(message: NotificationMessage): Promise<void> {
    this.messages.push(JSON.parse(JSON.stringify(message)) as NotificationMessage);
  }
}

describe('gallery-ready flow: full payment delivers the gallery', () => {
  let db: TestDb;
  let photoOcc: string;
  let tourOcc: string;
  /** The booking the first test settles — the one the drain test reads back. */
  let deliveredRef: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    const op = (
      await db.pg.query<{ id: string }>(
        `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours') returning id`,
      )
    ).rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);

    const occ = async (optionId: string) =>
      (
        await db.pg.query<{ id: string }>(
          `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
           values ($1, $2, now() + interval '5 days', now() + interval '5 days 2 hours', 4) returning id`,
          [optionId, op],
        )
      ).rows[0]!.id;

    const photo = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'couples-shoot', 'activity', 'Couples shoot', 'Photography', 'published') returning id`,
        [op],
      )
    ).rows[0]!.id;
    const photoOpt = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name, private_base_minor, private_included,
                                       private_extra_minor, private_max_guests)
         values ($1, 'Private shoot', 15000, 2, 2500, 8) returning id`,
        [photo],
      )
    ).rows[0]!.id;
    photoOcc = await occ(photoOpt);

    const tour = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, type, title, category, status)
         values ($1, 'plain-tour', 'activity', 'Plain tour', 'Sightseeing tours', 'published') returning id`,
        [op],
      )
    ).rows[0]!.id;
    const tourOpt = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name) values ($1, 'Standard') returning id`,
        [tour],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 7001)`,
      [tourOpt],
    );
    tourOcc = await occ(tourOpt);
  });

  afterAll(async () => {
    await db.close();
  });

  it('a confirmed gallery with photos enqueues exactly one gallery_ready row when the balance clears', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId: photoOcc,
      party: { 'Private shoot': 2 },
      customerName: 'Photo Guest',
      customerEmail: 'photo@example.com',
      source: 'web',
      idempotencyKey: 'gal-ready-0001',
    });
    deliveredRef = booked.ref;
    const b = await booking(db, booked.ref);
    expect(b.status).toBe('payment_pending');

    // Settle the deposit — confirmed, other half owed, no delivery email yet.
    await payDeposit(db, booked.ref, 'gal-ready-d1', 'gal-ready-evt1');
    expect(await outbox(db, b.id, 'gallery_ready')).toHaveLength(0);
    // The stored figure the API, the RLS policy and the admin "Confirm" all read: without a balance
    // owed after the deposit, the gallery would unlock (and the Confirm email would skip the balance
    // link) the moment the deposit cleared.
    expect((await booking(db, booked.ref)).balance_due_minor).toBeGreaterThan(0);

    // The studio uploads the finished shoot (two photos and one film) and presses "Confirm gallery
    // complete" — the stamp is what the settlement branch keys off.
    await db.asOwner();
    await db.pg.query(
      `insert into booking_photos (booking_id, url, position) values
        ($1, 'https://cdn.example/shoot-1.jpg', 1),
        ($1, 'https://cdn.example/shoot-2.jpg', 2),
        ($1, 'https://cdn.example/shoot-film.mp4', 3)`,
      [b.id],
    );
    await db.pg.query(`update bookings set gallery_ready_at = now() where id = $1`, [b.id]);
    expect(await outbox(db, b.id, 'gallery_ready')).toHaveLength(0);

    const { balancePaymentId } = await payBalance(db, booked.ref, 'gal-ready-b1', 'gal-ready-evt1');
    const settled = await booking(db, booked.ref);
    expect(settled.balance_due_minor).toBe(0);

    // Exactly one gallery_ready row, with the payload the drain renderer reads.
    const rows = await outbox(db, b.id, 'gallery_ready');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      channel: 'email',
      recipient: 'photo@example.com',
      template: 'gallery_ready',
      idempotency_key: `gallery_ready:${b.id}`,
    });
    expect(rows[0]!.payload).toEqual({
      ref: booked.ref,
      customerName: 'Photo Guest',
      packageTitle: 'Couples shoot',
      photoCount: 3,
      locale: 'en',
      galleryUrl: `/bookings/${booked.ref}#gallery`,
    });

    // The settled-in-full branch's other two emails still fired.
    expect(await outbox(db, b.id, 'booking_confirmation')).toHaveLength(1);
    expect(await outbox(db, b.id, 'owner_balance_paid')).toHaveLength(1);

    // Idempotent: re-running the trigger for the same payment adds nothing.
    await db.asOwner();
    await db.pg.query(`select notify_balance_paid($1)`, [balancePaymentId]);
    expect(await outbox(db, b.id, 'gallery_ready')).toHaveLength(1);
  });

  it('photos uploaded but NOT confirmed by the studio: paying the balance sends no gallery_ready row', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId: photoOcc,
      party: { 'Private shoot': 2 },
      customerName: 'Mid Upload Guest',
      customerEmail: 'midupload@example.com',
      source: 'web',
      idempotencyKey: 'gal-ready-0004',
    });
    const b = await booking(db, booked.ref);
    await payDeposit(db, booked.ref, 'gal-ready-d4', 'gal-ready-evt4');

    // The studio is part-way through uploading — photos exist, but nobody pressed Confirm.
    await db.asOwner();
    await db.pg.query(
      `insert into booking_photos (booking_id, url, position) values ($1, 'https://cdn.example/part-1.jpg', 1)`,
      [b.id],
    );

    // The guest pays the balance anyway (the booking page lets them, any time after the deposit).
    await payBalance(db, booked.ref, 'gal-ready-b4', 'gal-ready-evt4');
    const settled = await booking(db, booked.ref);
    expect(settled.balance_due_minor).toBe(0);
    // The settled branch ran (the invoice went out) — only the confirmation gate blocked the email.
    // The studio's own confirmation later finds a zero balance and sends the gallery link directly,
    // so this guest gets exactly one gallery email, not one for half a shoot plus one for the rest.
    expect(await outbox(db, b.id, 'booking_confirmation')).toHaveLength(1);
    expect(await outbox(db, b.id, 'gallery_ready')).toHaveLength(0);
  });

  it('a confirmed gallery WITHOUT photos gets no gallery_ready row', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId: photoOcc,
      party: { 'Private shoot': 2 },
      customerName: 'No Photos Guest',
      customerEmail: 'nophotos@example.com',
      source: 'web',
      idempotencyKey: 'gal-ready-0002',
    });
    const b = await booking(db, booked.ref);
    await payDeposit(db, booked.ref, 'gal-ready-d2', 'gal-ready-evt2');
    // Confirmed, but the photos were never uploaded (or were all removed again).
    await db.asOwner();
    await db.pg.query(`update bookings set gallery_ready_at = now() where id = $1`, [b.id]);
    await payBalance(db, booked.ref, 'gal-ready-b2', 'gal-ready-evt2');
    const settled = await booking(db, booked.ref);
    expect(settled.balance_due_minor).toBe(0);
    expect(await outbox(db, b.id, 'booking_confirmation')).toHaveLength(1);
    expect(await outbox(db, b.id, 'gallery_ready')).toHaveLength(0);
  });

  it('a tour booking does not get a gallery_ready row', async () => {
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId: tourOcc,
      party: { Adult: 1 },
      customerName: 'Tour Guest',
      customerEmail: 'tour@example.com',
      source: 'web',
      idempotencyKey: 'gal-ready-0003',
    });
    const b = await booking(db, booked.ref);
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    await call(db, 'api_create_payment', {
      bookingRef: booked.ref,
      idempotencyKey: 'gal-ready-t1',
    });
    const pay = await payment(db, b.id, 'booking');
    await settle(db, pay.id, pay.amount_minor, 'gal-ready-evtt');
    expect(await outbox(db, b.id, 'gallery_ready')).toHaveLength(0);
  });

  it('the service role can stamp gallery_ready_at and reads the live balance back from the same statement', async () => {
    // What markGalleryReady does: UPDATE … RETURNING through the service-role client. Run against the
    // real schema so the bookings guard trigger and grants are in the picture, not a fake client.
    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    const booked = await apiBook<{ ref: string }>(db, {
      occurrenceId: photoOcc,
      party: { 'Private shoot': 2 },
      customerName: 'Stamp Guest',
      customerEmail: 'stamp@example.com',
      source: 'web',
      idempotencyKey: 'gal-ready-0005',
    });
    const b = await booking(db, booked.ref);
    await payDeposit(db, booked.ref, 'gal-ready-d5', 'gal-ready-evt5');
    const owed = (await booking(db, booked.ref)).balance_due_minor;
    expect(owed).toBeGreaterThan(0);

    await db.as({ role: 'service_role' });
    const stamped = await db.pg.query<{ id: string; balance_due_minor: number }>(
      `update bookings set gallery_ready_at = now() where id = $1 returning id, balance_due_minor::int`,
      [b.id],
    );
    expect(stamped.rows).toHaveLength(1);
    expect(stamped.rows[0]!.balance_due_minor).toBe(owed);

    await db.asOwner();
    const { rows } = await db.pg.query<{ gallery_ready_at: string | null }>(
      `select gallery_ready_at from bookings where id = $1`,
      [b.id],
    );
    expect(rows[0]!.gallery_ready_at).not.toBeNull();
  });

  it('a guest cannot stamp their own gallery from the browser', async () => {
    // The stamp is what makes the gallery exist for the guest — it must stay a staff action. A
    // customer holds no UPDATE policy on bookings, so the write matches no rows.
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string; gallery_ready_at: string | null }>(
      `select id, gallery_ready_at from bookings where customer_email = 'midupload@example.com'`,
    );
    const target = rows[0]!;
    expect(target.gallery_ready_at).toBeNull();

    await db.as({ sub: CUSTOMER, role: 'authenticated' });
    // Refused either way — a permission error or a write that matches no rows; what matters is the
    // stamp not moving.
    await db.pg
      .query(`update bookings set gallery_ready_at = now() where id = $1`, [target.id])
      .catch(() => undefined);

    await db.asOwner();
    const after = await db.pg.query<{ gallery_ready_at: string | null }>(
      `select gallery_ready_at from bookings where id = $1`,
      [target.id],
    );
    expect(after.rows[0]!.gallery_ready_at).toBeNull();
  });

  it('the drain sends the guest the gallery link — the last hop of pay → gallery', async () => {
    // Everything upstream is proven by the tests above (the trigger enqueues the row); this proves the
    // row turns into the email the guest actually receives: rendered from the persisted payload, sent
    // to the booking's own address, carrying an ABSOLUTE link to their private gallery. Other rows are
    // marked sent first so the drain (which would otherwise render every invoice PDF above) stays
    // focused on the one row under test.
    await db.asOwner();
    await db.pg.query(
      `update notification_outbox set status = 'sent' where template <> 'gallery_ready'`,
    );
    const ctx: ServiceContext = {
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date('2026-06-20T12:00:00Z'),
      locale: 'en',
    };
    await db.as({ sub: 'service', role: 'service_role' });
    const provider = new CapturingProvider();
    const result = await drainNotifications(ctx, provider);
    expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });

    const msg = provider.messages.find((m) => m.template === 'gallery_ready')!;
    expect(msg).toBeTruthy();
    expect(msg.channel).toBe('email');
    expect(msg.recipient).toBe('photo@example.com');
    expect(msg.subject).toBe(`Your gallery is ready — booking ${deliveredRef}`);
    const link = `${SITE.url}/bookings/${deliveredRef}#gallery`;
    expect(msg.html).toContain(link);
    expect(msg.text).toContain(link);
    expect(msg.html).toContain('Couples shoot');
    expect(msg.html).toContain('3 photos');

    await db.asOwner();
    const row = (
      await db.pg.query<{ status: string }>(
        `select status from notification_outbox where template = 'gallery_ready'`,
      )
    ).rows[0]!;
    expect(row.status).toBe('sent');
  });

  it('carries the gallery_ready_at column, null until the studio confirms', async () => {
    await db.asOwner();
    const { rows } = await db.pg.query<{ gallery_ready_at: string | null }>(
      `select gallery_ready_at from bookings where customer_email = 'midupload@example.com'`,
    );
    expect(rows[0]).toBeDefined();
    expect(rows[0]!.gallery_ready_at).toBeNull();
  });
});
