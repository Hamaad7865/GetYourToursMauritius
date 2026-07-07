import type { TestDb } from './pglite';

let seq = 0;

export interface SeedResult {
  operatorId: string;
  activityId: string;
  optionId: string;
  occurrenceId: string;
}

/**
 * Seeds a published activity → option → price tier → one bookable occurrence with
 * the given capacity. Runs in the owner context (bypasses RLS) — call db.asOwner()
 * first if a test has switched roles.
 */
export async function seedOccurrence(db: TestDb, capacity: number): Promise<SeedResult> {
  seq += 1;
  const { rows: op } = await db.pg.query<{ id: string }>(
    `insert into operators (name, slug) values ($1, $2) returning id`,
    [`Operator ${seq}`, `operator-${seq}`],
  );
  const operatorId = op[0]!.id;

  const { rows: act } = await db.pg.query<{ id: string }>(
    `insert into activities (operator_id, slug, title, category, status)
     values ($1, $2, $3, 'Catamaran cruises', 'published') returning id`,
    [operatorId, `activity-${seq}`, `Activity ${seq}`],
  );
  const activityId = act[0]!.id;

  const { rows: opt } = await db.pg.query<{ id: string }>(
    `insert into activity_options (activity_id, name) values ($1, 'Shared') returning id`,
    [activityId],
  );
  const optionId = opt[0]!.id;

  await db.pg.query(
    `insert into activity_option_prices (activity_option_id, label, amount_minor) values ($1, 'Adult', 7500)`,
    [optionId],
  );

  const { rows: occ } = await db.pg.query<{ id: string }>(
    `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
     values ($1, $2, now() + interval '2 days', now() + interval '2 days 4 hours', $3) returning id`,
    [optionId, operatorId, capacity],
  );

  return { operatorId, activityId, optionId, occurrenceId: occ[0]!.id };
}

export interface PrivateSeedResult {
  optionId: string;
  occurrenceId: string;
}

/**
 * Adds a PRIVATE option (base+per-head pricing, trips-counted pool) to an already-seeded
 * activity, with its own occurrence on the same day as the shared one. No price tiers —
 * the private config lives in the option columns.
 */
export async function seedPrivateOption(
  db: TestDb,
  seeded: SeedResult,
  cfg: { baseMinor: number; included: number; extraMinor: number; maxGuests: number; tripsPerDay: number },
): Promise<PrivateSeedResult> {
  const { rows: opt } = await db.pg.query<{ id: string }>(
    `insert into activity_options
       (activity_id, name, private_base_minor, private_included, private_extra_minor, private_max_guests, daily_capacity)
     values ($1, 'Private charter', $2, $3, $4, $5, $6) returning id`,
    [seeded.activityId, cfg.baseMinor, cfg.included, cfg.extraMinor, cfg.maxGuests, cfg.tripsPerDay],
  );
  const optionId = opt[0]!.id;

  const { rows: occ } = await db.pg.query<{ id: string }>(
    `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
     values ($1, $2, now() + interval '2 days', now() + interval '2 days 4 hours', $3) returning id`,
    [optionId, seeded.operatorId, cfg.tripsPerDay],
  );

  return { optionId, occurrenceId: occ[0]!.id };
}
