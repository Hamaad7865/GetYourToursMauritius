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
// A stranger's guest email — never the caller's own. Used to prove a non-staff caller cannot reach
// someone else's records by SUPPLYING their email: the function overrides the email to the caller's own.
const VICTIM_EMAIL = 'victim-guest@example.com';

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
      special_notes: string | null;
      pickup_location: string | null;
      dropoff_location: string | null;
    }>(
      `select id, customer_name, customer_email, customer_phone, status, total_minor, special_notes,
              pickup_location, dropoff_location
         from bookings where id = $1`,
      [id],
    )
  ).rows[0];

describe('api_erase_user — anonymize-with-retention', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    // Seed auth.users WITH the email claim. api_erase_user reads the caller's own email from auth.users
    // (the SECURITY DEFINER override path) for a non-staff self-erase, so U must carry U_EMAIL here.
    for (const [id, role, email] of [
      [U, 'customer', U_EMAIL],
      [OTHER, 'customer', 'other@example.com'],
      [STAFF, 'staff', 'staff@example.com'],
    ] as const) {
      await db.pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
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
    // A PRE-ACCOUNT guest booking U made under their OWN email before signing up (user_id null). The
    // override forces v_email to U's own email, so this must still be swept (anonymized) on self-erase.
    const preAccountId = await seedBooking(db, 'u-preaccount', {
      userId: null,
      email: U_EMAIL,
      status: 'confirmed',
      paymentState: 'paid',
      name: 'Pre Account',
    });

    await db.asOwner();
    const totalBefore = Number((await bookingRow(db, confirmedId))!.total_minor);
    // Stamp a transfer-PII field on the retained booking so we can assert it is nulled by erasure
    // (the airport-transfer columns must be stripped alongside name/email/phone).
    // pickup_location / dropoff_location are real addresses the customer typed — PII, and not part of
    // the retained money trail — so they must be nulled too. They were missed until 20260816000000.
    await db.pg.query(
      `update bookings
          set special_notes = 'Wheelchair access please',
              pickup_location = '12 Rue des Manguiers, Trou d''Eau Douce',
              dropoff_location = 'Ambre Mauritius, Palmar'
        where id = $1`,
      [confirmedId],
    );

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
    expect(
      (await db.pg.query(`select 1 from leads where lower(contact) = $1`, [U_EMAIL])).rows,
    ).toHaveLength(0);

    // The CONFIRMED booking still exists but is anonymized — financials untouched. customer_email is
    // NOT NULL in the schema, so it is redacted to a non-routable sentinel rather than nulled.
    const conf = (await bookingRow(db, confirmedId))!;
    expect(conf.customer_name).toBe('(Deleted user)');
    expect(conf.customer_email).toBe('deleted@privacy.invalid');
    expect(conf.customer_email).not.toBe(U_EMAIL); // real PII gone
    expect(conf.customer_phone).toBeNull();
    expect(conf.special_notes).toBeNull(); // transfer PII stripped alongside the contact fields
    // The customer's home/hotel address must not survive an erasure request.
    expect(conf.pickup_location).toBeNull();
    expect(conf.dropoff_location).toBeNull();
    expect(conf.status).toBe('confirmed'); // UNCHANGED
    expect(Number(conf.total_minor)).toBe(totalBefore); // UNCHANGED

    // The PRE-ACCOUNT guest booking (user_id null, U's own email) was caught by the email override and
    // anonymized — proving self-erase still sweeps the caller's own pre-account guest rows.
    const pre = (await bookingRow(db, preAccountId))!;
    expect(pre.customer_email).toBe('deleted@privacy.invalid');
    expect(pre.customer_name).toBe('(Deleted user)');

    // Customer-addressed outbox rows are redacted: recipient → sentinel (NOT NULL column), payload
    // loses customerName. Owner-addressed rows KEEP their recipient — the 'owner' sentinel must
    // survive an erasure or a pending owner alert for a real paid booking silently dies — but their
    // payload is scrubbed the same way.
    const outboxRows = (
      await db.pg.query<{ recipient: string; payload: Record<string, unknown> }>(
        `select recipient, payload from notification_outbox where booking_id = $1`,
        [confirmedId],
      )
    ).rows;
    expect(outboxRows.length).toBeGreaterThan(0);
    for (const row of outboxRows) {
      expect(row.recipient).not.toBe(U_EMAIL);
      expect(row.payload.customerName).toBeUndefined();
    }
    expect(outboxRows.some((r) => r.recipient === 'deleted@privacy.invalid')).toBe(true);
    // Staff bell rows are rebuilt without the customer's name (the erase's promise extends to the feed).
    const bell = (
      await db.pg.query<{ body: string }>(
        `select body from notifications where type = 'admin_new_booking' and data ->> 'bookingId' = $1`,
        [confirmedId],
      )
    ).rows;
    for (const row of bell) {
      expect(row.body).not.toContain('Pre Account');
      expect(row.body).toContain('(Deleted user)');
    }

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

  it('ignores a non-staff caller’s supplied email — cannot reach a stranger’s guest rows', async () => {
    // The victim is a pure guest (user_id null) U has no relationship to. Their data is keyed on an
    // email U does NOT own. U then calls erase with their OWN userId but SUPPLIES the victim's email.
    const victimConfirmed = await seedBooking(db, 'v-confirmed', {
      userId: null,
      email: VICTIM_EMAIL,
      status: 'confirmed',
      paymentState: 'paid',
      name: 'Victim Person',
    });
    const victimDraft = await seedBooking(db, 'v-draft', {
      userId: null,
      email: VICTIM_EMAIL,
      status: 'draft',
      paymentState: 'pending',
    });
    // U's OWN data, so we can confirm the call still erased the caller (the supplied email is ignored,
    // not the whole call rejected).
    const uOwnDraft = await seedBooking(db, 'u2-draft', {
      userId: U,
      email: U_EMAIL,
      status: 'draft',
      paymentState: 'pending',
    });
    await db.asOwner();
    await db.pg.query(`insert into leads (name, contact) values ('Victim', $1)`, [VICTIM_EMAIL]);

    // U (non-staff) supplies the victim's email. The guard passes on U's own userId; the override then
    // forces v_email back to U's own address, so the victim's email is never matched.
    await db.as({ sub: U, role: 'authenticated' });
    await expect(callErase(db, { userId: U, email: VICTIM_EMAIL })).resolves.toBeTruthy();

    await db.asOwner();
    // The victim's guest rows are UNTOUCHED — the supplied email was ignored.
    expect(await bookingRow(db, victimDraft)).toBeTruthy(); // draft NOT deleted
    const v = (await bookingRow(db, victimConfirmed))!;
    expect(v.customer_email).toBe(VICTIM_EMAIL); // NOT anonymized
    expect(v.customer_name).toBe('Victim Person');
    expect(
      (await db.pg.query(`select 1 from leads where lower(contact) = $1`, [VICTIM_EMAIL])).rows,
    ).toHaveLength(1); // victim's lead NOT deleted

    // U's own data WAS erased (the call ran, just scoped to U's identity).
    expect(await bookingRow(db, uOwnDraft)).toBeUndefined();
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
    // An OWNER-addressed outbox row for the guest booking (recipient 'owner', not the guest's email).
    // The recipient-match scrub can't touch it, so ONLY the booking-linked payload scrub cleans the name.
    // That scrub used to re-select the booking by email AFTER the anonymize had rewritten the email, so a
    // guest (email-only) booking fell out of scope and kept the name — this row is the regression guard.
    await db.pg.query(
      `insert into notification_outbox (channel, recipient, template, payload, booking_id)
       values ('email', 'owner', 'owner_new_booking',
               jsonb_build_object('ref', 'BMT-G', 'customerName', 'Guest Person', 'totalMinor', 5000), $1)`,
      [guestConfirmed],
    );
    // A staff bell row for the guest booking (embeds the customer's name in body).
    await db.pg.query(
      `insert into notifications (user_id, type, title, body, data)
       values ($1, 'admin_new_booking', 'New booking', 'Guest Person booked BMT-G',
               jsonb_build_object('ref', 'BMT-G', 'bookingId', $2::text))`,
      [STAFF, guestConfirmed],
    );

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

    // The owner-addressed outbox row KEEPS its recipient but the customer name is scrubbed from the
    // payload (the booking-linked scrub now matches guest bookings by pre-captured id, not by the
    // rewritten email).
    const ownerRow = (
      await db.pg.query<{ recipient: string; payload: Record<string, unknown> }>(
        `select recipient, payload from notification_outbox where booking_id = $1 and recipient = 'owner'`,
        [guestConfirmed],
      )
    ).rows[0]!;
    expect(ownerRow.recipient).toBe('owner'); // owner alert survives
    expect(ownerRow.payload.customerName).toBeUndefined(); // ...but the name is gone
    // The staff bell row for the guest booking is rebuilt anonymously.
    const bell = (
      await db.pg.query<{ body: string }>(
        `select body from notifications where type = 'admin_new_booking' and data ->> 'bookingId' = $1`,
        [guestConfirmed],
      )
    ).rows;
    for (const row of bell) {
      expect(row.body).not.toContain('Guest Person');
      expect(row.body).toContain('(Deleted user)');
    }
  });
});
