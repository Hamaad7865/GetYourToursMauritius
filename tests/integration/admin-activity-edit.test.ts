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

const { EMPTY_ACTIVITY, createActivity, loadActivityForEdit, updateActivity } =
  await import('@/lib/admin/activity-write');
const { seedTeamRole } = await import('../db/team');

describe('updateActivity preserves option ids on edit', () => {
  let db: TestDb;
  let operatorId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    operatorId = (
      await db.pg.query<{ id: string }>(`select id from operators where slug = 'belle-mare-tours'`)
    ).rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [
      STAFF,
    ]);
    hoisted.shim = makeSupabaseShim(db.pg);
  });

  afterAll(async () => {
    await db.close();
  });

  /** Seed an activity + one option (+ price) + one materialised future occurrence. */
  async function seedActivity(
    slug: string,
  ): Promise<{ activityId: string; optionId: string; occurrenceId: string }> {
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
      options: [
        {
          id: optionId,
          name: 'Renamed Option',
          prices: [{ label: 'Adult', amountEur: 70, maxGuests: null }],
        },
      ],
    };

    await db.as({ sub: STAFF, role: 'authenticated' });
    // The option is kept in the form (id present) → an in-place update, nothing removed.
    await expect(updateActivity(activityId, form)).resolves.toEqual({ keptWithBookings: [] });

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
      options: [
        {
          id: optionId,
          name: 'Kept Option',
          prices: [{ label: 'Adult', amountEur: 70, maxGuests: null }],
        },
      ],
    };

    await db.as({ sub: STAFF, role: 'authenticated' });
    await updateActivity(activityId, form);

    await db.asOwner();
    const occ = (
      await db.pg.query<{ id: string }>(`select id from session_occurrences where id = $1`, [
        occurrenceId,
      ])
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
      options: [
        {
          id: optionId,
          name: 'Private group',
          prices: [{ label: 'Adult', amountEur: 70, maxGuests: null }],
        },
      ],
    };

    await db.as({ sub: STAFF, role: 'authenticated' });
    await updateActivity(activityId, form);

    await db.asOwner();
    const opts = (
      await db.pg.query<{ id: string }>(`select id from activity_options where activity_id = $1`, [
        activityId,
      ])
    ).rows;
    expect(opts.map((o) => o.id)).toEqual([optionId]);
    expect(
      opts.some((o) => o.id === removableId),
      'the removed unbooked option is gone',
    ).toBe(false);
  });

  it('removing an option that has availability occurrences (but no bookings) deletes it — occurrences cascade', async () => {
    // The reported bug: an option with only auto-materialised availability (no bookings) kept coming back
    // on save. session_occurrences is ON DELETE CASCADE, so removing the option must take its slots with it.
    const { activityId, optionId } = await seedActivity('removable-with-availability');
    const removableId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name, position) values ($1, 'Standard', 1) returning id`,
        [activityId],
      )
    ).rows[0]!.id;
    const removableOcc = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '12 days', now() + interval '12 days' + interval '5 hours', 10)
         returning id`,
        [removableId, operatorId],
      )
    ).rows[0]!.id;

    const form = {
      ...EMPTY_ACTIVITY,
      slug: 'removable-with-availability',
      title: 'Trimmed',
      options: [
        {
          id: optionId,
          name: 'Private group',
          prices: [{ label: 'Adult', amountEur: 70, maxGuests: null }],
        },
      ],
    };

    await db.as({ sub: STAFF, role: 'authenticated' });
    await updateActivity(activityId, form);

    await db.asOwner();
    const opts = (
      await db.pg.query<{ id: string }>(`select id from activity_options where activity_id = $1`, [
        activityId,
      ])
    ).rows;
    expect(
      opts.some((o) => o.id === removableId),
      'the removed option (availability only) is gone',
    ).toBe(false);
    const occ = (
      await db.pg.query(`select id from session_occurrences where id = $1`, [removableOcc])
    ).rows;
    expect(occ, 'its availability occurrences cascade-deleted with the option').toHaveLength(0);
  });

  it('removing a BOOKED option reports it in keptWithBookings and keeps it (Discontinue, not delete)', async () => {
    const { activityId, optionId } = await seedActivity('booked-removal');
    // A second option WITH a confirmed booking that the admin then drops from the form.
    const soldId = (
      await db.pg.query<{ id: string }>(
        `insert into activity_options (activity_id, name, position) values ($1, 'Sunset dinner', 1) returning id`,
        [activityId],
      )
    ).rows[0]!.id;
    const soldOcc = (
      await db.pg.query<{ id: string }>(
        `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
         values ($1, $2, now() + interval '14 days', now() + interval '14 days' + interval '5 hours', 10)
         returning id`,
        [soldId, operatorId],
      )
    ).rows[0]!.id;
    const bookingId = (
      await db.pg.query<{ id: string }>(
        `insert into bookings (customer_name, customer_email, status, total_minor, operator_payout_minor)
         values ('Booked Guest', 'b@example.com', 'confirmed', 5000, 5000) returning id`,
      )
    ).rows[0]!.id;
    await db.pg.query(
      `insert into booking_items
         (booking_id, session_occurrence_id, activity_option_id, price_label, quantity, unit_amount_minor, subtotal_minor)
       values ($1, $2, $3, 'Adult', 1, 5000, 5000)`,
      [bookingId, soldOcc, soldId],
    );

    const form = {
      ...EMPTY_ACTIVITY,
      slug: 'booked-removal',
      title: 'Trimmed',
      // 'Sunset dinner' dropped from the form — but it has a booking, so it must be KEPT + reported.
      options: [
        {
          id: optionId,
          name: 'Private group',
          prices: [{ label: 'Adult', amountEur: 70, maxGuests: null }],
        },
      ],
    };

    await db.as({ sub: STAFF, role: 'authenticated' });
    const result = await updateActivity(activityId, form);

    expect(
      result.keptWithBookings,
      'the booked option is reported so the editor can guide to Discontinue',
    ).toEqual(['Sunset dinner']);
    await db.asOwner();
    const opts = (
      await db.pg.query<{ id: string }>(`select id from activity_options where activity_id = $1`, [
        activityId,
      ])
    ).rows;
    expect(
      opts.some((o) => o.id === soldId),
      'the booked option is kept, not deleted',
    ).toBe(true);
  });

  /** A signed-in worker with a team role holding exactly `permissions`. Leaves the session as owner. */
  async function seedWorker(id: string, permissions: Parameters<typeof seedTeamRole>[2]) {
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [id]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'staff')`, [id]);
    await seedTeamRole(db, id, permissions);
  }

  /** A signed-in member of a CONTENT role (profiles.role 'seo'). Leaves the session as owner. */
  async function seedContentWriter(id: string) {
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [id]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'seo')`, [id]);
    await seedTeamRole(db, id, ['section.tours'], 'content');
  }

  const priceRows = async (optionId: string) => {
    await db.asOwner();
    return (
      await db.pg.query<{ id: string; amount_minor: number }>(
        `select id, amount_minor from activity_option_prices where activity_option_id = $1`,
        [optionId],
      )
    ).rows;
  };

  it('a role without money.prices can save the description; prices, options and supplements are left untouched', async () => {
    const { activityId, optionId } = await seedActivity('locked-pricing');
    await db.pg.query(
      `insert into activity_supplements (activity_id, name, price_minor, position) values ($1, 'Lunch', 1500, 0)`,
      [activityId],
    );
    const LOCKED = 'a6a6a6a6-a6a6-a6a6-a6a6-a6a6a6a6a6a6';
    await seedWorker(LOCKED, ['section.tours']);
    const before = (await priceRows(optionId)).map((r) => r.id);

    await db.as({ sub: LOCKED, role: 'authenticated' });
    const form = {
      ...EMPTY_ACTIVITY,
      slug: 'locked-pricing',
      title: 'New words only',
      supplements: [], // a reconcile would delete the stored 'Lunch' supplement
      options: [
        {
          id: optionId,
          name: 'Renamed by a locked worker',
          prices: [{ label: 'Adult', amountEur: 1, maxGuests: null }],
        },
      ],
    };
    await updateActivity(activityId, form, { pricingLocked: true });

    const after = await priceRows(optionId);
    expect(after.map((r) => r.id)).toEqual(before); // not replaced
    expect(after[0]!.amount_minor).toBe(7000); // the form's €1 was ignored
    const optionName = (
      await db.pg.query<{ name: string }>(`select name from activity_options where id = $1`, [
        optionId,
      ])
    ).rows[0]!.name;
    expect(optionName).toBe('Private group'); // option rows are not rewritten either
    const supplements = (
      await db.pg.query<{ name: string }>(
        `select name from activity_supplements where activity_id = $1`,
        [activityId],
      )
    ).rows;
    expect(supplements.map((r) => r.name)).toEqual(['Lunch']);
    const title = (
      await db.pg.query<{ title: string }>(`select title from activities where id = $1`, [
        activityId,
      ])
    ).rows[0]!.title;
    expect(title).toBe('New words only');
  });

  it('a locked load-then-save never sends the pricing mode, so a mode changed meanwhile survives', async () => {
    const { activityId } = await seedActivity('locked-mode');
    await db.pg.query(`update activities set pricing_mode = 'per_group' where id = $1`, [
      activityId,
    ]);
    const LOCKED = 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7';
    await seedWorker(LOCKED, ['section.tours']);

    await db.as({ sub: LOCKED, role: 'authenticated' });
    const loaded = await loadActivityForEdit(activityId);
    expect(loaded!.pricingMode).toBe('per_group');
    // A stale form: the editor was opened when the mode was still per_person.
    const stale = {
      ...loaded!,
      title: 'Words from a stale form',
      pricingMode: 'per_person' as const,
    };
    await expect(updateActivity(activityId, stale, { pricingLocked: true })).resolves.toEqual({
      keptWithBookings: [],
    });

    await db.asOwner();
    const row = (
      await db.pg.query<{ pricing_mode: string; title: string }>(
        `select pricing_mode, title from activities where id = $1`,
        [activityId],
      )
    ).rows[0]!;
    expect(row.pricing_mode).toBe('per_group');
    expect(row.title).toBe('Words from a stale form');
  });

  it("a locked worker's new tour is created as a draft with no options", async () => {
    const LOCKED = 'a8a8a8a8-a8a8-a8a8-a8a8-a8a8a8a8a8a8';
    await seedWorker(LOCKED, ['section.tours']);
    await db.as({ sub: LOCKED, role: 'authenticated' });
    const id = await createActivity(
      {
        ...EMPTY_ACTIVITY,
        slug: 'locked-new-tour',
        title: 'Locked new tour',
        category: 'Island tours',
        status: 'published', // the form default — must not go live
        options: [{ name: 'Shared', prices: [{ label: 'Adult', amountEur: 1, maxGuests: null }] }],
      },
      { pricingLocked: true },
    );

    await db.asOwner();
    const act = (
      await db.pg.query<{ status: string; pricing_mode: string }>(
        `select status, pricing_mode from activities where id = $1`,
        [id],
      )
    ).rows[0]!;
    expect(act.status).toBe('draft');
    expect(act.pricing_mode).toBe('per_person'); // the column default
    const options = await db.pg.query(`select id from activity_options where activity_id = $1`, [
      id,
    ]);
    expect(options.rows).toHaveLength(0);
  });

  it('a locked worker cannot publish a tour that has no live option, but can once one exists', async () => {
    const LOCKED = 'a9a9a9a9-a9a9-a9a9-a9a9-a9a9a9a9a9a9';
    await seedWorker(LOCKED, ['section.tours']);
    const { activityId, optionId } = await seedActivity('locked-publish');
    await db.pg.query(`update activities set status = 'draft' where id = $1`, [activityId]);
    await db.pg.query(`update activity_options set status = 'archived' where id = $1`, [optionId]);
    const form = {
      ...EMPTY_ACTIVITY,
      slug: 'locked-publish',
      title: 'Go live',
      status: 'published' as const,
    };
    const storedStatus = async () => {
      await db.asOwner();
      return (
        await db.pg.query<{ status: string }>(`select status from activities where id = $1`, [
          activityId,
        ])
      ).rows[0]!.status;
    };

    await db.as({ sub: LOCKED, role: 'authenticated' });
    await expect(updateActivity(activityId, form, { pricingLocked: true })).rejects.toThrow(
      /Edit prices/,
    );
    expect(await storedStatus()).toBe('draft');

    await db.pg.query(`update activity_options set status = 'active' where id = $1`, [optionId]);
    await db.as({ sub: LOCKED, role: 'authenticated' });
    await updateActivity(activityId, form, { pricingLocked: true });
    expect(await storedStatus()).toBe('published');
  });

  it('a content-role member can save a tour’s copy; options and prices are left untouched', async () => {
    const { activityId, optionId } = await seedActivity('content-copy');
    const WRITER = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
    await seedContentWriter(WRITER);
    const before = (await priceRows(optionId)).map((r) => r.id);

    await db.as({ sub: WRITER, role: 'authenticated' });
    const loaded = await loadActivityForEdit(activityId);
    await updateActivity(
      activityId,
      { ...loaded!, title: 'Rewritten by the content role', summary: 'New summary' },
      { contentOnly: true, pricingLocked: true },
    );

    await db.asOwner();
    const row = (
      await db.pg.query<{ title: string; summary: string; status: string }>(
        `select title, summary, status from activities where id = $1`,
        [activityId],
      )
    ).rows[0]!;
    expect(row).toEqual({
      title: 'Rewritten by the content role',
      summary: 'New summary',
      status: 'published',
    });
    expect((await priceRows(optionId)).map((r) => r.id)).toEqual(before);
  });

  it('a content-role member creates a tour as a draft with no options, without reading operators', async () => {
    const WRITER = 'b3b3b3b3-b3b3-b3b3-b3b3-b3b3b3b3b3b3';
    await seedContentWriter(WRITER);

    await db.as({ sub: WRITER, role: 'authenticated' });
    // The precondition the fix rests on: operators (payout details) stays invisible to this role.
    expect((await db.pg.query(`select id from operators`)).rows).toHaveLength(0);
    const id = await createActivity(
      {
        ...EMPTY_ACTIVITY,
        slug: 'content-new-tour',
        title: 'Written by the content role',
        category: 'Island tours',
        status: 'published',
        options: [{ name: 'Shared', prices: [{ label: 'Adult', amountEur: 1, maxGuests: null }] }],
      },
      { contentOnly: true, pricingLocked: true },
    );

    await db.asOwner();
    const act = (
      await db.pg.query<{ status: string; operator_id: string }>(
        `select status, operator_id from activities where id = $1`,
        [id],
      )
    ).rows[0]!;
    expect(act).toEqual({ status: 'draft', operator_id: operatorId });
    const options = await db.pg.query(`select id from activity_options where activity_id = $1`, [
      id,
    ]);
    expect(options.rows).toHaveLength(0);
  });

  it('a team member WITH money.prices still saves prices (the lock is per permission)', async () => {
    const { activityId, optionId } = await seedActivity('priced-worker');
    const PRICER = 'b1b1b1b1-b1b1-b1b1-b1b1-b1b1b1b1b1b1';
    await seedWorker(PRICER, ['section.tours', 'money.prices']);

    await db.as({ sub: PRICER, role: 'authenticated' });
    const form = {
      ...EMPTY_ACTIVITY,
      slug: 'priced-worker',
      title: 'Repriced',
      options: [
        {
          id: optionId,
          name: 'Private group',
          prices: [{ label: 'Adult', amountEur: 90, maxGuests: null }],
        },
      ],
    };
    await updateActivity(activityId, form, { pricingLocked: false });

    const after = await priceRows(optionId);
    expect(after.map((r) => r.amount_minor)).toEqual([9000]);
  });
});
