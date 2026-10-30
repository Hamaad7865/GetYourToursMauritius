import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { pgliteRpc } from '../db/rpc';
import { seedOccurrence, type SeedResult } from '../db/seed';

/**
 * api_home_picks (20261030140000) — the shared data behind the homepage's first row
 * (docs/superpowers/specs/2026-10-17-first-visit-home-row-design.md):
 *   * mostBooked   — published tours ranked by confirmed/completed bookings made in the last 90 days,
 *                    test bookings by staff/admin/seo accounts excluded, ties in catalogue order;
 *   * freeTomorrow — tours with an open slot TOMORROW (Mauritius date) that still has a seat, under the
 *                    same rules as api_list_availability.
 * Assertions are relative (order between, or membership of, this file's own tours): the migrations seed
 * catalogue rows of their own.
 */

const STAFF = 'd2d2d2d2-d2d2-4d2d-8d2d-d2d2d2d2d2d2';
const SEO = 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3';

interface Tour extends SeedResult {
  slug: string;
}
interface Picks {
  date: string;
  mostBooked: string[];
  freeTomorrow: string[];
}
interface Target {
  occ: string;
  opt: string;
}

describe('api_home_picks', () => {
  let db: TestDb;
  let picks: Picks;
  let tomorrow: string;
  const t: Record<string, Tour> = {};

  /** A published tour with no slots yet. */
  async function tour(
    over: { minAdvance?: number; status?: string; sort?: number; extra?: object } = {},
  ): Promise<Tour> {
    const seeded = await seedOccurrence(db, 50);
    await db.pg.query(`delete from session_occurrences where id = $1`, [seeded.occurrenceId]);
    const { rows } = await db.pg.query<{ slug: string }>(
      `update activities
          set min_advance_days = $2, status = $3, sort = $4,
              extra = coalesce(extra, '{}'::jsonb) || $5::jsonb
        where id = $1
        returning slug`,
      [
        seeded.activityId,
        over.minAdvance ?? 1,
        over.status ?? 'published',
        over.sort ?? 0,
        JSON.stringify(over.extra ?? {}),
      ],
    );
    return { ...seeded, slug: rows[0]!.slug };
  }

  /** A slot on (Mauritius today + dayOffset) at a Mauritius wall-clock time. */
  async function slot(
    x: Tour,
    dayOffset: number,
    time: string,
    capacity = 50,
    status = 'open',
  ): Promise<string> {
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity, status)
       values ($1, $2,
         (((now() at time zone 'Indian/Mauritius')::date + $3::int) + $4::time) at time zone 'Indian/Mauritius',
         (((now() at time zone 'Indian/Mauritius')::date + $3::int) + $4::time + interval '4 hours') at time zone 'Indian/Mauritius',
         $5, $6::occurrence_status)
       returning id`,
      [x.optionId, x.operatorId, dayOffset, time, capacity, status],
    );
    return rows[0]!.id;
  }

  async function book(
    target: Target,
    opts: {
      status?: string;
      userId?: string | null;
      daysAgo?: number;
      items?: number;
      quantity?: number;
    } = {},
  ): Promise<void> {
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into bookings (user_id, customer_name, customer_email, total_minor, status, created_at)
       values ($1, 'Guest', 'guest@example.com', 7500, $2::booking_status,
               now() - make_interval(days => $3::int))
       returning id`,
      [opts.userId ?? null, opts.status ?? 'confirmed', opts.daysAgo ?? 1],
    );
    for (let i = 0; i < (opts.items ?? 1); i++) {
      await db.pg.query(
        `insert into booking_items
           (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, unit_amount_minor, subtotal_minor)
         values ($1, $2, $3, 'Adult', $4, 7500, 7500)`,
        [rows[0]!.id, target.occ, target.opt, opts.quantity ?? 1],
      );
    }
  }

  /** One slot five days out, to hang bookings on. */
  async function bookable(x: Tour): Promise<Target> {
    return { occ: await slot(x, 5, '10:00'), opt: x.optionId };
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    for (const [id, role] of [
      [STAFF, 'staff'],
      [SEO, 'seo'],
    ] as const) {
      await db.pg.query(`insert into auth.users (id) values ($1)`, [id]);
      await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Team', $2)`, [
        id,
        role,
      ]);
    }

    // ── Ranking ──
    t.top = await tour();
    t.second = await tour();
    t.tieLow = await tour({ sort: 1 });
    t.tieHigh = await tour({ sort: 2 });
    t.multiItem = await tour({ sort: 3 });
    t.cancelledOnly = await tour();
    t.oldOnly = await tour();
    t.staffOnly = await tour();
    t.draft = await tour({ status: 'draft' });

    const top = await bookable(t.top);
    for (let i = 0; i < 3; i++) await book(top);
    const second = await bookable(t.second);
    await book(second);
    await book(second, { status: 'completed' });
    await book(await bookable(t.tieLow));
    await book(await bookable(t.tieHigh));
    // ONE booking with three lines: it counts once, not three times.
    await book(await bookable(t.multiItem), { items: 3 });
    const cancelled = await bookable(t.cancelledOnly);
    for (const status of ['cancelled', 'expired', 'payment_pending', 'refunded']) {
      await book(cancelled, { status });
    }
    const old = await bookable(t.oldOnly);
    for (let i = 0; i < 4; i++) await book(old, { daysAgo: 100 });
    const staff = await bookable(t.staffOnly);
    for (let i = 0; i < 3; i++) await book(staff, { userId: STAFF });
    for (let i = 0; i < 3; i++) await book(staff, { userId: SEO });
    const draft = await bookable(t.draft);
    for (let i = 0; i < 4; i++) await book(draft);

    // ── Free tomorrow ──
    t.open = await tour();
    await slot(t.open, 1, '10:00');
    t.full = await tour();
    await book({ occ: await slot(t.full, 1, '10:00', 2), opt: t.full.optionId }, { quantity: 2 });
    t.closed = await tour();
    await slot(t.closed, 1, '10:00', 50, 'closed');
    t.notice = await tour({ minAdvance: 2 });
    await slot(t.notice, 1, '10:00');
    t.inquiry = await tour({ extra: { inquiryOnly: true } });
    await slot(t.inquiry, 1, '10:00');
    t.draftSlot = await tour({ status: 'draft' });
    await slot(t.draftSlot, 1, '10:00');
    t.earlyTomorrow = await tour();
    await slot(t.earlyTomorrow, 1, '00:30');
    t.dayAfter = await tour();
    await slot(t.dayAfter, 2, '00:30');
    t.today = await tour({ minAdvance: 0 });
    await slot(t.today, 0, '23:30');

    tomorrow = (
      await db.pg.query<{ d: string }>(
        `select to_char((now() at time zone 'Indian/Mauritius')::date + 1, 'YYYY-MM-DD') as d`,
      )
    ).rows[0]!.d;

    // Called as an anonymous visitor, like the homepage does.
    await db.as(null);
    picks = await pgliteRpc(db.pg).rpc<Picks>('api_home_picks', {});
    await db.asOwner();
  });

  afterAll(async () => {
    await db.close();
  });

  it('is callable by anonymous visitors', async () => {
    const { rows } = await db.pg.query<{ ok: boolean }>(
      `select has_function_privilege('anon', 'public.api_home_picks(jsonb)', 'EXECUTE') as ok`,
    );
    expect(rows[0]!.ok).toBe(true);
  });

  it('names the Mauritius date its free-tomorrow list is about', () => {
    expect(picks.date).toBe(tomorrow);
  });

  it('ranks by distinct confirmed + completed bookings, ties in catalogue order', () => {
    const at = (x: Tour) => picks.mostBooked.indexOf(x.slug);
    for (const x of [t.top, t.second, t.tieLow, t.tieHigh, t.multiItem]) {
      expect(at(x), x.slug).toBeGreaterThanOrEqual(0);
    }
    expect(at(t.top)).toBeLessThan(at(t.second));
    expect(at(t.second)).toBeLessThan(at(t.tieLow));
    expect(at(t.tieLow)).toBeLessThan(at(t.tieHigh));
    // A booking with three lines counts once: multiItem ties the one-booking tours, on sort 3.
    expect(at(t.tieHigh)).toBeLessThan(at(t.multiItem));
  });

  it('leaves out unpaid or reversed bookings, old ones, team test bookings and unpublished tours', () => {
    for (const x of [t.cancelledOnly, t.oldOnly, t.staffOnly, t.draft]) {
      expect(picks.mostBooked, x.slug).not.toContain(x.slug);
    }
  });

  it('returns at most 24 ranked tours', () => {
    expect(picks.mostBooked.length).toBeLessThanOrEqual(24);
  });

  it('lists tours with a free seat tomorrow, Mauritius time', () => {
    expect(picks.freeTomorrow).toContain(t.open.slug);
    expect(picks.freeTomorrow).toContain(t.earlyTomorrow.slug); // 00:30 tomorrow
  });

  it('leaves out full, closed, too-short-notice, inquiry-only and unpublished tours, and other days', () => {
    for (const x of [
      t.full,
      t.closed,
      t.notice,
      t.inquiry,
      t.draftSlot,
      t.dayAfter, // 00:30 the day after tomorrow
      t.today, // 23:30 today
    ]) {
      expect(picks.freeTomorrow, x.slug).not.toContain(x.slug);
    }
  });
});
