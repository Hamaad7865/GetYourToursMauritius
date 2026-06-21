import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

/**
 * GDPR right-to-erasure engine. api_erase_user implements anonymize-WITH-RETENTION: data with no
 * retention obligation (unpaid/abandoned bookings, leads, chat, the profile) is hard-deleted; data that
 * must survive for tax/audit (PAID + terminal bookings) is retained but stripped of PII (customer_name +
 * customer_email are NOT NULL in the schema, so they are redacted to placeholders, not nulled). Correctness on
 * that split is the whole point: hard-deleting a paid booking would destroy a financial record; leaving
 * PII on a retained booking would defeat the erasure. The function is guarded (staff, or a user erasing
 * THEMSELVES), idempotent, and operates by user_id AND/OR customer_email (so a logged-in user's pre-account
 * guest bookings are swept, and staff can erase a pure-guest booking by email).
 */

const ITEMS = JSON.stringify([{ price_label: 'Adult', quantity: 1 }]);
const U = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const U_EMAIL = 'erase-me@example.com';
const OTHER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STAFF = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const GUEST_EMAIL = 'guest-erase@example.com';

/** Seed a booking owned by a given user (or guest), at a chosen status/payment_state + customer email. */
async function seedBooking(
  db: TestDb,
  key: string,
  opts: {
    userId: string | null;
    email: string;
    status: string;
    paymentState: string;
    name?: string;
  },
): Promise<string> {
  await db.asOwner();
  const { occurrenceId } = await seedOccurrence(db, 5);
  const { rows: h } = await db.pg.query<{ id: string }>(`select * from create_hold($1, 1, $2)`, [
    occurrenceId,
    `${key}-h`,
  ]);
  const { rows: b } = await db.pg.query<{ id: string }>(
    `select * from create_booking($1, $2, $3, $4, '+23012345', 'web'::booking_source, $5::jsonb)`,
    [`${key}-bk`, h[0]!.id, opts.name ?? 'Erase Me', opts.email, ITEMS],
  );
  const id = b[0]!.id;
  // create_booking lands the row in payment_pending with user_id = auth.uid() (owner = null here);
  // force the exact status / payment_state / ownership the test needs (owner context bypasses guards).
  await db.pg.query(
    `update bookings set user_id = $2, status = $3::booking_status, payment_state = $4::payment_state where id = $1`,
    [id, opts.userId, opts.status, opts.paymentState],
  );
  return id;
}

const callErase = (db: TestDb, p: Record<string, unknown>) =>
  db.pg.query(`select api_erase_user($1::jsonb)`, [JSON.stringify(p)]);

const bookingRow = async (db: TestDb, id: string) =>
  (
    await db.pg.query<{
      id: string;
      customer_name: string;
      customer_email: string | null;
      customer_phone: string | null;
      status: string;
      total_minor: number | string;
    }>(
      `select id, customer_name, customer_email, customer_phone, status, total_minor from bookings where id = $1`,
      [id],
    )
  ).rows[0];

describe('api_erase_user — anonymize-with-retention', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    for (const [id, role] of [
      [U, 'customer'],
      [OTHER, 'customer'],
      [STAFF, 'staff'],
    ] as const) {
      await db.pg.query(`insert into auth.users (id) values ($1)`, [id]);
      await db.pg.query(`insert into profiles (id, role) values ($1, $2)`, [id, role]);
    }
  });

  afterAll(async () => {
    await db.close();
  });

  it('hard-deletes unpaid data, anonymizes paid bookings (keeping financials), redacts outbox', async () => {
    // A CONFIRMED + paid booking (must be retained + anonymized) and a DRAFT unpaid booking (deletable).
    const confirmedId = await seedBooking(db, 'u-confirmed', {
      userId: U,
      email: U_EMAIL,
      status: 'confirmed',
      paymentState: 'paid',
      name: 'Real Name',
    });
    const draftId = await seedBooking(db, 'u-draft', {
      userId: U,
      email: U_EMAIL,
      status: 'draft',
      paymentState: 'pending',
    });

    await db.asOwner();
    const totalBefore = Number((await bookingRow(db, confirmedId))!.total_minor);

    // A lead carrying U's email (PII to hard-delete).
    await db.pg.query(`insert into leads (name, contact) values ('Erase Me', $1)`, [U_EMAIL]);
    // An outbox row for U's confirmed booking, mirroring the real booking_confirmation payload.
    await db.pg.query(
      `insert into notification_outbox (channel, recipient, template, payload, booking_id)
       values ('email', $1, 'booking_confirmation',
               jsonb_build_object('ref', 'BMT-X', 'customerName', 'Real Name', 'totalMinor', 7500), $2)`,
      [U_EMAIL, confirmedId],
    );

    await db.as({ sub: U, role: 'authenticated' });
    const { rows } = await callErase(db, { userId: U, email: U_EMAIL });
    expect(rows[0]).toBeTruthy();

    await db.asOwner();

    // Profile + the unpaid draft booking + the lead are GONE.
    expect((await db.pg.query(`select 1 from profiles where id = $1`, [U])).rows).toHaveLength(0);
    expect(await bookingRow(db, draftId)).toBeUndefined();
    expect((await db.pg.query(`select 1 from leads where lower(contact) = $1`, [U_EMAIL])).rows).toHaveLength(0);

    // The CONFIRMED booking still exists but is anonymized — financials untouched. customer_email is
    // NOT NULL in the schema, so it is redacted to a non-routable sentinel rather than nulled.
    const conf = (await bookingRow(db, confirmedId))!;
    expect(conf.customer_name).toBe('(Deleted user)');
    expect(conf.customer_email).toBe('deleted@privacy.invalid');
    expect(conf.customer_email).not.toBe(U_EMAIL); // real PII gone
    expect(conf.customer_phone).toBeNull();
    expect(conf.status).toBe('confirmed'); // UNCHANGED
    expect(Number(conf.total_minor)).toBe(totalBefore); // UNCHANGED

    // The outbox row is redacted: no customerName in payload, recipient stripped of the real email
    // (recipient is NOT NULL in the schema → redacted to the sentinel, not nulled).
    const outbox = (
      await db.pg.query<{ recipient: string | null; payload: Record<string, unknown> }>(
        `select recipient, payload from notification_outbox where booking_id = $1`,
        [confirmedId],
      )
    ).rows[0]!;
    expect(outbox.recipient).not.toBe(U_EMAIL);
    expect(outbox.recipient).toBe('deleted@privacy.invalid');
    expect(outbox.payload.customerName).toBeUndefined();

    // An audit row was written with NO PII (counts only).
    const audit = (
      await db.pg.query<{ action: string; summary: string; diff: unknown }>(
        `select action, summary, diff from audit_logs where action = 'erase_user' and entity_id = $1`,
        [U],
      )
    ).rows[0]!;
    expect(audit).toBeTruthy();
    expect(audit.summary).not.toContain(U_EMAIL);
    expect(audit.summary).not.toContain('Real Name');
  });

  it('is idempotent — a second call is a no-op, no throw', async () => {
    await db.as({ sub: U, role: 'authenticated' });
    await expect(callErase(db, { userId: U, email: U_EMAIL })).resolves.toBeTruthy();
    await db.asOwner();
  });

  it('rejects a different non-staff user (forbidden)', async () => {
    await db.as({ sub: OTHER, role: 'authenticated' });
    await expect(callErase(db, { userId: U, email: U_EMAIL })).rejects.toThrow(/forbidden/);
    await db.asOwner();
  });

  it('lets STAFF erase a pure-guest booking by email (user_id null)', async () => {
    const guestConfirmed = await seedBooking(db, 'g-confirmed', {
      userId: null,
      email: GUEST_EMAIL,
      status: 'confirmed',
      paymentState: 'paid',
      name: 'Guest Person',
    });
    const guestDraft = await seedBooking(db, 'g-draft', {
      userId: null,
      email: GUEST_EMAIL,
      status: 'draft',
      paymentState: 'pending',
    });
    await db.asOwner();
    await db.pg.query(`insert into leads (name, contact) values ('Guest', $1)`, [GUEST_EMAIL]);

    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(callErase(db, { email: GUEST_EMAIL })).resolves.toBeTruthy();

    await db.asOwner();
    // Guest draft + lead deleted; the paid guest booking anonymized by email.
    expect(await bookingRow(db, guestDraft)).toBeUndefined();
    expect(
      (await db.pg.query(`select 1 from leads where lower(contact) = $1`, [GUEST_EMAIL])).rows,
    ).toHaveLength(0);
    const g = (await bookingRow(db, guestConfirmed))!;
    expect(g.customer_name).toBe('(Deleted user)');
    expect(g.customer_email).toBe('deleted@privacy.invalid');
    expect(g.customer_email).not.toBe(GUEST_EMAIL);
    expect(g.status).toBe('confirmed');
  });
});
