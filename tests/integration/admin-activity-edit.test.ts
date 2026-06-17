import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';

/**
 * Regression: editing an activity must NOT recreate its booking options.
 *
 * updateActivity used to insert fresh activity_options (new UUIDs) and delete the old ones.
 * That broke two ways, both reproduced here against the REAL schema (PGlite enforces the
 * actual FK actions):
 *   (a) booking_items.activity_option_id is ON DELETE RESTRICT — deleting a booked option
 *       throws, leaving the activity with duplicate options and a failed save.
 *   (b) session_occurrences.activity_option_id (and booking_holds → occurrence) are ON DELETE
 *       CASCADE — recreating an option wipes every materialised slot and its active holds.
 *
 * The fix diffs options by their stable id, so these run the REAL updateActivity through a
 * Supabase-shaped shim over PGlite.
 */

const STAFF = 'a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5';

const hoisted = vi.hoisted(() => ({ shim: null as SupabaseShim | null }));
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => {
    if (!hoisted.shim) throw new Error('shim not initialised');
    return hoisted.shim;
  },
}));

const { EMPTY_ACTIVITY, updateActivity } = await import('@/lib/admin/activity-write');

describe('updateActivity preserves option ids on edit', () => {
  let db: TestDb;
  let operatorId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`);
    operatorId = (
      await db.pg.query<{ id: string }>(`select id from operators where slug = 'belle-mare-tours'`)
    ).rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [STAFF]);
    hoisted.shim = makeSupabaseShim(db.pg);
  });

  afterAll(async () => {
    await db.close();
  });

  /** Seed an activity + one option (+ price) + one materialised future occurrence. */
  async function seedActivity(slug: string): Promise<{ activityId: string; optionId: string; occurrenceId: string }> {
    await db.asOwner();
    const activityId = (
      await db.pg.query<{ id: string }>(
        `insert into activities (operator_id, slug, title, category, status)
         values ($1, $2, 'Seed Activity', 'Island tours', 'published') returning id`,
        [operatorId, slug],
      )
    ).rows[0]!.id;
    const optionId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name, position) values ($1, 'Private group', 0) returning id`,
        [activityId],
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, position)
       values ($1, 'Adult', 7000, 0)`,
      [optionId],
    );
    const occurrenceId = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '10 days', now() + interval '10 days' + interval '5 hours', 10)
         returning id`,
        [optionId, operatorId],
      )
    ).rows[0]!.id;
    return { activityId, optionId, occurrenceId };
  }

  it('editing an activity with a confirmed booking succeeds, makes no duplicate options, keeps the option id', async () => {
    const { activityId, optionId, occurrenceId } = await seedActivity('booked-activity');
    // A confirmed booking pins the option via booking_items (ON DELETE RESTRICT).
    const bookingId = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (customer_name, customer_email, status, total_minor, operator_payout_minor)
         values ('Test Customer', 't@example.com', 'confirmed', 7000, 7000) returning id`,
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into booking_items
         (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, unit_amount_minor, subtotal_minor)
       values ($1, $2, $3, 'Adult', 1, 7000, 7000)`,
      [bookingId, occurrenceId, optionId],
    );

    // The admin edits the activity (renames title + the existing option), keeping the option's id —
    // exactly what loadActivityForEdit round-trips.
    const form = {
      ...EMPTY_ACTIVITY,
      slug: 'booked-activity',
      title: 'Edited Title',
      options: [{ id: optionId, name: 'Renamed Option', prices: [{ label: 'Adult', amountEur: 70, maxGuests: null }] }],
    };

    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(updateActivity(activityId, form)).resolves.toBeUndefined();

    await db.asOwner();
    const opts = (
      await db.pg.query<{ id: string; name: string }>(
        `select id, name from activity_options where activity_id = $1 order by position`,
        [activityId],
      )
    ).rows;
    expect(opts, 'no duplicate options after the edit').toHaveLength(1);
    expect(opts[0]!.id, 'the booked option keeps its id').toBe(optionId);
    expect(opts[0]!.name, 'the in-place update applied').toBe('Renamed Option');

    // The booking still points at the same, still-present option.
    const items = (
      await db.pg.query<{ activity_option_id: string }>(
        `select activity_option_id from booking_items where booking_id = $1`,
        [bookingId],
      )
    ).rows;
    expect(items[0]!.activity_option_id).toBe(optionId);
  });

  it('an active hold on a materialised slot survives an unrelated activity edit', async () => {
    const { activityId, optionId, occurrenceId } = await seedActivity('held-activity');
    // An active hold on the materialised occurrence (no confirmed booking).
    await db.pg.query(
      `insert into booking_holds (session_occurrence_id, quantity, idempotency_key)
       values ($1, 2, 'hold-survives-edit')`,
      [occurrenceId],
    );

    const form = {
      ...EMPTY_ACTIVITY,
      slug: 'held-activity',
      title: 'A different title',
      options: [{ id: optionId, name: 'Kept Option', prices: [{ label: 'Adult', amountEur: 70, maxGuests: null }] }],
    };

    await db.as({ sub: STAFF, role: 'authenticated' });
    await updateActivity(activityId, form);

    await db.asOwner();
    const occ = (
      await db.pg.query<{ id: string }>(`select id from session_occurrences where id = $1`, [occurrenceId])
    ).rows;
    expect(occ, 'the materialised slot is not cascade-deleted').toHaveLength(1);
    const holds = (
      await db.pg.query<{ status: string }>(
        `select status from booking_holds where session_occurrence_id = $1`,
        [occurrenceId],
      )
    ).rows;
    expect(holds, 'the hold is not cascade-deleted').toHaveLength(1);
    expect(holds[0]!.status, 'the hold is still active').toBe('active');
  });

  it('removing an unbooked option from the form deletes it (no orphan options accrue)', async () => {
    const { activityId, optionId } = await seedActivity('removable-activity');
    // A second, unbooked option that the admin then removes in the form.
    const removableId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name, position) values ($1, 'Shared', 1) returning id`,
        [activityId],
      )
    ).rows[0]!.id;

    const form = {
      ...EMPTY_ACTIVITY,
      slug: 'removable-activity',
      title: 'Trimmed',
      options: [{ id: optionId, name: 'Private group', prices: [{ label: 'Adult', amountEur: 70, maxGuests: null }] }],
    };

    await db.as({ sub: STAFF, role: 'authenticated' });
    await updateActivity(activityId, form);

    await db.asOwner();
    const opts = (
      await db.pg.query<{ id: string }>(`select id from activity_options where activity_id = $1`, [activityId])
    ).rows;
    expect(opts.map((o) => o.id)).toEqual([optionId]);
    expect(opts.some((o) => o.id === removableId), 'the removed unbooked option is gone').toBe(false);
  });
});
