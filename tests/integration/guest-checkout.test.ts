import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { seedOccurrence } from '../db/seed';
import { makeAuthAdminShim, makeSupabaseShim } from '../db/supabase-pglite';
import { pgliteRpc } from '../db/rpc';
import { drainNotifications } from '@/lib/services/notifications';
import type { NotificationMessage, NotificationProvider } from '@/lib/notifications/types';
import type { ServiceContext } from '@/lib/services/context';
import type { Database } from '@/lib/supabase/types';
import {
  GUEST_LIMITS,
  adoptGuestBooking,
  assertGuestBookingAllowed,
  claimGuestBookings,
  guestBookingUrl,
  guestLinkTarget,
  purgeAnonymousUsers,
  requestGuestLink,
  resetGuestLink,
} from '@/lib/services/guest';
import { mintGuestLinkToken } from '@/lib/guest/link-token';
import { RateLimitError } from '@/lib/services/errors';

/**
 * The guest checkout logic (src/lib/services/guest.ts) against the real schema: real foreign keys, the
 * real api_book and create_payment, and the auth.users rows the service reads through the admin API.
 */
describe('guest checkout', () => {
  let db: TestDb;
  let ctx: ServiceContext;
  let occurrenceId: string;
  let n = 0;
  let now = new Date();

  const uid = () => {
    n += 1;
    return `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
  };

  async function guest(createdDaysAgo = 0): Promise<string> {
    const id = uid();
    await db.asOwner();
    await db.pg.query(
      `insert into auth.users (id, is_anonymous, created_at)
       values ($1, true, now() - make_interval(days => $2))`,
      [id, createdDaysAgo],
    );
    return id;
  }

  async function account(email: string, confirmed = true): Promise<string> {
    const id = uid();
    await db.asOwner();
    await db.pg.query(
      `insert into auth.users (id, email, email_confirmed_at) values ($1, $2, $3)`,
      [id, email, confirmed ? new Date().toISOString() : null],
    );
    return id;
  }

  async function book(
    owner: string | null,
    email: string,
    source: 'web' | 'quote' = 'web',
  ): Promise<{ ref: string; id: string; key: string }> {
    const key = `guest-${uid()}`;
    await db.asOwner();
    const booking = await apiBook<{ ref: string }>(db, {
      actorUserId: owner,
      occurrenceId,
      party: { Adult: 1 },
      customerName: 'Guest Person',
      customerEmail: email,
      source,
      idempotencyKey: key,
    });
    await db.asOwner();
    const { rows } = await db.pg.query<{ id: string }>(`select id from bookings where ref = $1`, [
      booking.ref,
    ]);
    return { ref: booking.ref, id: rows[0]!.id, key };
  }

  async function setBooking(ref: string, set: string): Promise<void> {
    await db.asOwner();
    await db.pg.query(`update bookings set ${set} where ref = $1`, [ref]);
  }

  async function ownerOf(ref: string): Promise<string | null> {
    await db.asOwner();
    const { rows } = await db.pg.query<{ user_id: string | null }>(
      `select user_id from bookings where ref = $1`,
      [ref],
    );
    return rows[0]!.user_id;
  }

  async function tokenFor(bookingId: string, version = 1): Promise<string> {
    return mintGuestLinkToken(bookingId, version);
  }

  beforeAll(async () => {
    db = await createTestDb();
    ({ occurrenceId } = await seedOccurrence(db, 1000));
    ctx = {
      admin: {
        ...makeSupabaseShim(db.pg),
        auth: makeAuthAdminShim(db.pg),
      } as unknown as SupabaseClient<Database>,
      now: () => now,
      locale: 'en',
    } as unknown as ServiceContext;
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    now = new Date();
    await db.asOwner();
  });

  describe('the money path sees an ordinary owner', () => {
    it('lets the anonymous owner pay, and nobody else', async () => {
      const owner = await guest();
      const stranger = await guest();
      const booking = await book(owner, 'owner@example.com');

      await db.as({ sub: stranger, role: 'authenticated', is_anonymous: true });
      await expect(
        db.pg.query(`select api_create_payment($1::jsonb)`, [
          JSON.stringify({ bookingRef: booking.ref, idempotencyKey: `${booking.key}-x` }),
        ]),
      ).rejects.toThrow(/forbidden/);

      await db.as({ sub: owner, role: 'authenticated', is_anonymous: true });
      const paid = await db.pg.query<{ data: { paymentId?: string } }>(
        `select api_create_payment($1::jsonb) as data`,
        [JSON.stringify({ bookingRef: booking.ref, idempotencyKey: `${booking.key}-pay` })],
      );
      expect(paid.rows[0]!.data).toBeTruthy();
      await db.asOwner();
    });

    it('keeps api_book out of reach of every browser role', async () => {
      const { rows } = await db.pg.query<{ anon: boolean; authed: boolean }>(
        `select has_function_privilege('anon', 'api_book(jsonb)', 'execute') as anon,
                has_function_privilege('authenticated', 'api_book(jsonb)', 'execute') as authed`,
      );
      expect(rows[0]).toEqual({ anon: false, authed: false });
    });

    it('still refuses a replay of a guest booking from a different guest (F23)', async () => {
      const owner = await guest();
      const thief = await guest();
      const booking = await book(owner, 'f23@example.com');
      await expect(
        apiBook(db, {
          actorUserId: thief,
          occurrenceId,
          party: { Adult: 1 },
          customerName: 'Thief',
          customerEmail: 'f23@example.com',
          source: 'web',
          idempotencyKey: booking.key,
        }),
      ).rejects.toThrow(/forbidden/);
      await db.asOwner();
    });

    it('shows a guest their own booking and cannot change it', async () => {
      const owner = await guest();
      const booking = await book(owner, 'rls@example.com');

      await db.as({ sub: owner, role: 'authenticated', is_anonymous: true });
      const seen = await db.pg.query(`select ref from bookings where ref = $1`, [booking.ref]);
      expect(seen.rows).toHaveLength(1);
      const write = await db.pg.query(
        `update bookings set customer_email = 'victim@example.com' where ref = $1`,
        [booking.ref],
      );
      expect(write.affectedRows ?? 0).toBe(0);

      const stranger = await guest();
      await db.as({ sub: stranger, role: 'authenticated', is_anonymous: true });
      const hidden = await db.pg.query(`select ref from bookings where ref = $1`, [booking.ref]);
      expect(hidden.rows).toHaveLength(0);
      await db.asOwner();
    });
  });

  describe('assertGuestBookingAllowed', () => {
    it('caps live unpaid bookings per identity', async () => {
      const owner = await guest();
      for (let i = 0; i < GUEST_LIMITS.liveUnpaidPerIdentity; i += 1) {
        await book(owner, `identity-${i}@example.com`);
      }
      await expect(
        assertGuestBookingAllowed(ctx, { userId: owner, email: 'fresh@example.com' }),
      ).rejects.toBeInstanceOf(RateLimitError);
    });

    it('never counts a retry of the same booking', async () => {
      const owner = await guest();
      let key = '';
      for (let i = 0; i < GUEST_LIMITS.liveUnpaidPerIdentity; i += 1) {
        ({ key } = await book(owner, `retry-${i}@example.com`));
      }
      await expect(
        assertGuestBookingAllowed(ctx, {
          userId: owner,
          email: 'retry-0@example.com',
          idempotencyKey: key,
        }),
      ).resolves.toBeUndefined();
    });

    it('caps bookings per identity per day, paid or not', async () => {
      const owner = await guest();
      for (let i = 0; i < GUEST_LIMITS.bookingsPerIdentityPerDay; i += 1) {
        const { ref } = await book(owner, `daily-${i}@example.com`);
        await setBooking(ref, `status = 'confirmed'`);
      }
      await expect(
        assertGuestBookingAllowed(ctx, { userId: owner, email: 'daily-new@example.com' }),
      ).rejects.toBeInstanceOf(RateLimitError);
    });

    it('caps live unpaid bookings per email across identities, ignoring case and +tags', async () => {
      await book(await guest(), 'Shared@Example.com');
      await book(await guest(), 'shared+one@example.com');
      await book(await guest(), 'shared+two@example.com');
      await expect(
        assertGuestBookingAllowed(ctx, {
          userId: await guest(),
          email: 'SHARED+three@example.com',
        }),
      ).rejects.toBeInstanceOf(RateLimitError);
    });

    it('lets a guest book again once their unpaid bookings have expired', async () => {
      const owner = await guest();
      for (let i = 0; i < GUEST_LIMITS.liveUnpaidPerIdentity; i += 1) {
        const { ref } = await book(owner, `expired-${i}@example.com`);
        await setBooking(ref, `status = 'expired'`);
      }
      await expect(
        assertGuestBookingAllowed(ctx, { userId: owner, email: 'expired-0@example.com' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('adoptGuestBooking', () => {
    it('moves a booking between guest sessions, and the link keeps working', async () => {
      const first = await guest();
      const second = await guest();
      const booking = await book(first, 'adopt@example.com');
      const token = await tokenFor(booking.id);

      expect(await adoptGuestBooking(ctx, { ref: booking.ref, userId: second, token })).toBe(true);
      expect(await ownerOf(booking.ref)).toBe(second);

      // "Latest device wins", and the first device can take it straight back.
      expect(await adoptGuestBooking(ctx, { ref: booking.ref, userId: first, token })).toBe(true);
      expect(await ownerOf(booking.ref)).toBe(first);
    });

    it('is a no-op for the current owner', async () => {
      const owner = await guest();
      const booking = await book(owner, 'same@example.com');
      const token = await tokenFor(booking.id);
      expect(await adoptGuestBooking(ctx, { ref: booking.ref, userId: owner, token })).toBe(true);
      expect(await ownerOf(booking.ref)).toBe(owner);
    });

    it('refuses a bad token, and the token of another booking', async () => {
      const owner = await guest();
      const other = await book(await guest(), 'other@example.com');
      const booking = await book(owner, 'badtoken@example.com');
      const thief = await guest();

      expect(
        await adoptGuestBooking(ctx, { ref: booking.ref, userId: thief, token: 'f'.repeat(64) }),
      ).toBe(false);
      expect(
        await adoptGuestBooking(ctx, {
          ref: booking.ref,
          userId: thief,
          token: await tokenFor(other.id),
        }),
      ).toBe(false);
      expect(await ownerOf(booking.ref)).toBe(owner);
    });

    it('never takes a booking from a real account', async () => {
      const real = await account('real@example.com');
      const booking = await book(real, 'real@example.com');
      const thief = await guest();
      const token = await tokenFor(booking.id);
      expect(await adoptGuestBooking(ctx, { ref: booking.ref, userId: thief, token })).toBe(false);
      expect(await ownerOf(booking.ref)).toBe(real);
    });

    it('refuses a quote booking and an erased booking', async () => {
      const quote = await book(null, 'quote@example.com', 'quote');
      const erased = await book(await guest(), 'erased@example.com');
      await setBooking(erased.ref, `customer_email = 'deleted@privacy.invalid'`);
      const thief = await guest();

      for (const b of [quote, erased]) {
        expect(
          await adoptGuestBooking(ctx, {
            ref: b.ref,
            userId: thief,
            token: await tokenFor(b.id),
          }),
        ).toBe(false);
      }
    });

    it('stops honouring a link once staff reset it', async () => {
      const owner = await guest();
      const staff = await account('staff@example.com');
      const booking = await book(owner, 'reset@example.com');
      const oldToken = await tokenFor(booking.id);

      expect(await resetGuestLink(ctx, { ref: booking.ref, staffId: staff })).toBe(2);
      const thief = await guest();
      expect(
        await adoptGuestBooking(ctx, { ref: booking.ref, userId: thief, token: oldToken }),
      ).toBe(false);
      expect(
        await adoptGuestBooking(ctx, {
          ref: booking.ref,
          userId: thief,
          token: await tokenFor(booking.id, 2),
        }),
      ).toBe(true);
      expect(await resetGuestLink(ctx, { ref: booking.ref, staffId: staff })).toBe(3);
    });
  });

  describe('claimGuestBookings', () => {
    it('hands a confirmed account its paid guest bookings, whatever the case of the address', async () => {
      const paid = await book(await guest(), 'Claim.Me@Example.com');
      await setBooking(paid.ref, `status = 'confirmed', payment_state = 'paid'`);
      const user = await account('claim.me@example.com');

      expect(await claimGuestBookings(ctx, user)).toBe(1);
      expect(await ownerOf(paid.ref)).toBe(user);
      expect(await claimGuestBookings(ctx, user)).toBe(0); // idempotent
    });

    it('leaves anything without money on it, so no one can plant a "Pay now"', async () => {
      const email = 'nomoney@example.com';
      const pending = await book(await guest(), email);
      const expired = await book(await guest(), email);
      await setBooking(expired.ref, `status = 'expired'`);
      const unpaidCancel = await book(await guest(), email);
      await setBooking(unpaidCancel.ref, `status = 'cancelled'`);
      const user = await account(email);

      expect(await claimGuestBookings(ctx, user)).toBe(0);
      for (const b of [pending, expired, unpaidCancel]) {
        expect(await ownerOf(b.ref)).not.toBe(user);
      }
    });

    it('claims a cancelled booking that had money on it', async () => {
      const email = 'refunded@example.com';
      const booking = await book(await guest(), email);
      await setBooking(booking.ref, `status = 'cancelled', payment_state = 'refunded'`);
      const user = await account(email);
      expect(await claimGuestBookings(ctx, user)).toBe(1);
    });

    it('needs a confirmed address, and exactly one account on it', async () => {
      const unconfirmed = 'unconfirmed@example.com';
      const a = await book(await guest(), unconfirmed);
      await setBooking(a.ref, `status = 'confirmed', payment_state = 'paid'`);
      expect(await claimGuestBookings(ctx, await account(unconfirmed, false))).toBe(0);

      const twice = 'twice@example.com';
      const b = await book(await guest(), twice);
      await setBooking(b.ref, `status = 'confirmed', payment_state = 'paid'`);
      const first = await account(twice);
      await account(twice);
      expect(await claimGuestBookings(ctx, first)).toBe(0);
    });

    it('does nothing for an anonymous caller', async () => {
      expect(await claimGuestBookings(ctx, await guest())).toBe(0);
    });

    it('never moves a booking owned by another real account, or a quote', async () => {
      const email = 'taken@example.com';
      const other = await account('someone-else@example.com');
      const owned = await book(other, email);
      await setBooking(owned.ref, `status = 'confirmed', payment_state = 'paid'`);
      const quote = await book(null, email, 'quote');
      await setBooking(quote.ref, `status = 'confirmed', payment_state = 'paid'`);

      expect(await claimGuestBookings(ctx, await account(email))).toBe(0);
      expect(await ownerOf(owned.ref)).toBe(other);
      expect(await ownerOf(quote.ref)).toBeNull();
    });

    it('treats _ in an address literally', async () => {
      const lookalike = await book(await guest(), 'aXb@example.com');
      await setBooking(lookalike.ref, `status = 'confirmed', payment_state = 'paid'`);
      expect(await claimGuestBookings(ctx, await account('a_b@example.com'))).toBe(0);
    });
  });

  describe('find my booking', () => {
    const outboxFor = async (bookingId: string) => {
      await db.asOwner();
      const { rows } = await db.pg.query<{ recipient: string; payload: Record<string, unknown> }>(
        `select recipient, payload from notification_outbox
          where booking_id = $1 and template = 'guest_booking_link'`,
        [bookingId],
      );
      return rows;
    };

    it('queues one link to the address on the booking, with no token in the outbox', async () => {
      const booking = await book(await guest(), 'Find@Example.com');
      await requestGuestLink(ctx, { ref: booking.ref, email: ' find@example.com ' });
      await requestGuestLink(ctx, { ref: booking.ref, email: 'find@example.com' });

      const rows = await outboxFor(booking.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.recipient).toBe('Find@Example.com');
      expect(JSON.stringify(rows[0]!.payload)).not.toMatch(/[0-9a-f]{64}/);
    });

    it('sends again in the next window', async () => {
      const booking = await book(await guest(), 'window@example.com');
      await requestGuestLink(ctx, { ref: booking.ref, email: 'window@example.com' });
      now = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      await requestGuestLink(ctx, { ref: booking.ref, email: 'window@example.com' });
      expect(await outboxFor(booking.id)).toHaveLength(2);
    });

    it('sends nothing for a wrong address, a real account or an unknown ref', async () => {
      const wrong = await book(await guest(), 'right@example.com');
      await requestGuestLink(ctx, { ref: wrong.ref, email: 'wrong@example.com' });
      expect(await outboxFor(wrong.id)).toHaveLength(0);

      const owned = await book(await account('owned@example.com'), 'owned@example.com');
      await requestGuestLink(ctx, { ref: owned.ref, email: 'owned@example.com' });
      expect(await outboxFor(owned.id)).toHaveLength(0);

      await expect(
        requestGuestLink(ctx, { ref: 'BMTNOPE', email: 'x@example.com' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('guestBookingUrl', () => {
    it('gives a guest the signed link, in the booking’s language', async () => {
      const booking = await book(await guest(), 'url@example.com');
      await setBooking(booking.ref, `locale = 'fr'`);
      const url = await guestBookingUrl(ctx, booking.ref);
      expect(url).toContain(`/api/v1/bookings/${booking.ref}/open?t=`);
      expect(url).toMatch(/[?&]t=[0-9a-f]{64}&l=fr$/);
      expect((await guestLinkTarget(ctx, booking.ref))?.locale).toBe('fr');
    });

    it('gives a real account no link at all', async () => {
      const booking = await book(await account('plain@example.com'), 'plain@example.com');
      expect(await guestBookingUrl(ctx, booking.ref)).toBeNull();
    });

    it('stays out of the way of a context with no admin client', async () => {
      const booking = await book(await guest(), 'noadmin@example.com');
      expect(await guestBookingUrl({ ...ctx, admin: undefined }, booking.ref)).toBeNull();
    });
  });

  describe('emails sent later, from the drain', () => {
    class Capturing implements NotificationProvider {
      readonly name = 'capture';
      messages: NotificationMessage[] = [];
      async send(message: NotificationMessage): Promise<void> {
        this.messages.push(message);
      }
    }

    const queue = async (template: string, ref: string, bookingId: string, email: string) => {
      await db.asOwner();
      await db.pg.query(`update notification_outbox set status = 'sent' where status = 'pending'`);
      await db.pg.query(
        `insert into notification_outbox (channel, recipient, template, payload, booking_id)
         values ('email', $1, $2, $3::jsonb, $4)`,
        [
          email,
          template,
          JSON.stringify({
            ref,
            customerName: 'Guest',
            activityTitle: 'Catamaran',
            hoursBefore: 48,
          }),
          bookingId,
        ],
      );
    };

    const drain = async () => {
      const provider = new Capturing();
      await db.asOwner();
      const result = await drainNotifications({ ...ctx, db: pgliteRpc(db.pg) }, provider);
      return { provider, result };
    };

    it('a pickup reminder carries the signed link, and no token reaches the outbox', async () => {
      const booking = await book(await guest(), 'drain@example.com');
      await queue('pickup_reminder', booking.ref, booking.id, 'drain@example.com');
      const { provider, result } = await drain();

      expect(result).toMatchObject({ sent: 1, failed: 0 });
      expect(provider.messages[0]!.text).toMatch(/\/open\?t=[0-9a-f]{64}/);

      const { rows } = await db.pg.query<{ payload: unknown }>(
        `select payload from notification_outbox where booking_id = $1`,
        [booking.id],
      );
      expect(JSON.stringify(rows)).not.toMatch(/[0-9a-f]{64}/);
    });

    it('a weather notice to a guest links the signed page too', async () => {
      const booking = await book(await guest(), 'weather@example.com');
      await queue('booking_weather_disrupted', booking.ref, booking.id, 'weather@example.com');
      const { provider } = await drain();
      // This template renders inside the provider, from the payload (tests/unit/guest-link.test.ts).
      expect(provider.messages[0]!.payload.bookingUrl).toMatch(/\/open\?t=[0-9a-f]{64}/);
    });

    it('an account holder keeps the plain booking page', async () => {
      const booking = await book(await account('plainlink@example.com'), 'plainlink@example.com');
      await queue('pickup_reminder', booking.ref, booking.id, 'plainlink@example.com');
      const { provider } = await drain();
      expect(provider.messages[0]!.text).toContain(`/bookings/${booking.ref}`);
      expect(provider.messages[0]!.text).not.toContain('/open?t=');
    });

    it('answers find-my-booking with the link', async () => {
      const booking = await book(await guest(), 'answer@example.com');
      await queue('guest_booking_link', booking.ref, booking.id, 'answer@example.com');
      const { provider } = await drain();
      expect(provider.messages[0]!.subject).toContain(booking.ref);
      expect(provider.messages[0]!.html).toMatch(/\/open\?t=[0-9a-f]{64}/);
    });
  });

  describe('purgeAnonymousUsers', () => {
    const exists = async (id: string) => {
      await db.asOwner();
      const { rows } = await db.pg.query(`select 1 from auth.users where id = $1`, [id]);
      return rows.length === 1;
    };

    it('deletes old anonymous users with nothing, and only those', async () => {
      const stale = await guest(31);
      const recent = await guest(29);
      const withBooking = await guest(31);
      await book(withBooking, 'keep@example.com');
      const real = await account('old-account@example.com');
      await db.pg.query(
        `update auth.users set created_at = now() - interval '90 days' where id = $1`,
        [real],
      );

      const { deleted } = await purgeAnonymousUsers(ctx);
      expect(deleted).toBeGreaterThanOrEqual(1);
      expect(await exists(stale)).toBe(false);
      expect(await exists(recent)).toBe(true);
      expect(await exists(withBooking)).toBe(true);
      expect(await exists(real)).toBe(true);
    });
  });

  describe('purgeAnonymousUsers batching', () => {
    it('deletes a small batch per run and clears the rest on the next', async () => {
      const stale: string[] = [];
      for (let i = 0; i < 17; i += 1) stale.push(await guest(40));

      expect((await purgeAnonymousUsers(ctx)).deleted).toBe(15);
      expect((await purgeAnonymousUsers(ctx)).deleted).toBe(2);
      expect((await purgeAnonymousUsers(ctx)).deleted).toBe(0);
    });
  });

  describe('booking_guest_links', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261030120000_guest_checkout_schema.sql'),
      'utf8',
    );

    // PGlite has no default table grants, so a privilege check here would pass with or without the
    // revoke. Production's default privileges hand every new table to anon and authenticated, so start
    // from that, run the migration's own statements, and prove they close it.
    it('closes production’s default grants', async () => {
      await db.pg.exec(`grant all on booking_guest_links to anon, authenticated;`);
      await db.pg.exec(migration);
      const { rows } = await db.pg.query<{ authed: boolean; anon: boolean; service: boolean }>(
        `select has_table_privilege('authenticated', 'booking_guest_links', 'select') as authed,
                has_table_privilege('anon', 'booking_guest_links', 'insert') as anon,
                has_table_privilege('service_role', 'booking_guest_links', 'update') as service`,
      );
      expect(rows[0]).toEqual({ authed: false, anon: false, service: true });
    });

    it('holds no plpgsql: the logic stays in TypeScript', () => {
      expect(migration).not.toMatch(/create (or replace )?function/i);
    });
  });
});
