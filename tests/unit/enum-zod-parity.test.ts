import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bookingSourceSchema } from '@/lib/validation/common';
import { pricingModeSchema } from '@/lib/validation/tours';

/**
 * A POSTGRES ENUM AND ITS ZOD MIRROR MUST AGREE — and the failure when they do not is silent until
 * it is severe.
 *
 * `booking_source` gained `'quote'` in migration 20260909000000_quotes.sql. `bookingSourceSchema`
 * was not updated, and nothing anywhere noticed: no test failed, the build was green, and the
 * quotes module shipped. The label only reaches the schema when a row CARRYING it is read — so the
 * bug lay dormant until the first guest paid a quote, and then GET /api/v1/bookings/{ref} answered
 * 500 (`ZodError: Invalid enum value. Expected 'web' | 'ai_chat' | 'whatsapp', received 'quote'`)
 * for every quote booking there will ever be. The customer saw "Something went wrong" on the
 * booking they had just paid for; the operator saw nothing at all.
 *
 * That is the shape of the whole class: a validator that is a SUBSET of the column it mirrors turns
 * a legal row into an unreadable one, and only for the rows that use the newest feature. So the
 * expectation is derived from the MIGRATIONS — the thing that actually defines the type — rather
 * than restated by hand here, where it would drift the same way.
 *
 * Adding a label to the database is therefore now a change that fails this test until the Zod enum
 * (and src/lib/supabase/types.ts, which the same label is missing from) is widened with it.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations');

/**
 * Every label a Postgres enum has by the end of the migration history: the labels its `create type`
 * declared, plus each one a later `alter type … add value` appended. Read in filename order, which is
 * the order Supabase applies them.
 */
function labelsFromMigrations(enumName: string): string[] {
  const labels: string[] = [];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

    // create type <name> as enum ('a', 'b', 'c')
    const created = new RegExp(`create\\s+type\\s+${enumName}\\s+as\\s+enum\\s*\\(([^)]*)\\)`, 'i');
    const createMatch = created.exec(sql);
    if (createMatch?.[1]) {
      for (const quoted of createMatch[1].matchAll(/'([^']+)'/g)) labels.push(quoted[1]!);
    }

    // alter type <name> add value [if not exists] 'd'
    const added = new RegExp(
      `alter\\s+type\\s+${enumName}\\s+add\\s+value\\s+(?:if\\s+not\\s+exists\\s+)?'([^']+)'`,
      'gi',
    );
    for (const m of sql.matchAll(added)) labels.push(m[1]!);
  }

  return [...new Set(labels)];
}

/**
 * The same expectation for a column whose "enum" is a CHECK constraint rather than a Postgres enum
 * type — `check (<column> in ('a', 'b'))`. A later migration widens one by DROPping and re-ADDing the
 * constraint, so the LAST definition in filename order is the live one (union would be wrong: it would
 * keep labels a re-definition deliberately removed).
 *
 * Scoped by column name, which is what the SQL text gives us; every column asserted below is unique
 * across the schema. A column name shared by two tables would need the constraint name instead.
 */
function checkLabelsFromMigrations(column: string): string[] {
  let labels: string[] = [];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const check = new RegExp(`check\\s*\\(\\s*${column}\\s+in\\s*\\(([^)]*)\\)`, 'gi');
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    for (const m of sql.matchAll(check)) {
      labels = [...m[1]!.matchAll(/'([^']+)'/g)].map((q) => q[1]!);
    }
  }

  return labels;
}

describe('Postgres enums and their Zod mirrors', () => {
  it('reads booking_source’s labels out of the migrations at all', () => {
    // Guards the guard: a regex that silently matched nothing would make every assertion below
    // vacuously true, which is exactly how this bug survived in the first place.
    const labels = labelsFromMigrations('booking_source');
    expect(labels).toContain('web');
    expect(labels.length).toBeGreaterThanOrEqual(4);
  });

  it('accepts every booking_source the database can store', () => {
    for (const label of labelsFromMigrations('booking_source')) {
      expect(
        bookingSourceSchema.safeParse(label).success,
        `bookingSourceSchema rejects '${label}', which the database can store — every read of a ` +
          `booking carrying it answers 500. Add it to the enum in src/lib/validation/common.ts ` +
          `(and to booking_source in src/lib/supabase/types.ts).`,
      ).toBe(true);
    }
  });

  it('accepts the quote source specifically, which is the one that broke', () => {
    expect(bookingSourceSchema.safeParse('quote').success).toBe(true);
  });

  it('does not accept a label the database has never had', () => {
    // The mirror must not be WIDER than the column either: a value Zod admits and Postgres rejects
    // fails at INSERT with a raw 22P02 instead of a readable refusal.
    expect(bookingSourceSchema.safeParse('carrier_pigeon').success).toBe(false);
  });
});

/**
 * The identical class, one constraint kind further out — and the reason the block above was not
 * enough. `activities.pricing_mode` is a CHECK constraint, not a Postgres enum, so nothing here
 * looked at it when migration 20260617210000 widened it with `'vehicle_custom'` for the AI road-trip
 * product. `pricingModeSchema` kept the three original labels, and from the day the planner activity
 * was published every read of it answered 500 (`GET /api/v1/activities/custom-road-trip`, logged in
 * error_logs on 2026-08-08) — the same dormant-until-a-row-uses-it failure, wearing a different
 * constraint.
 *
 * So the guard follows the column type, not the migration's syntax: any column a Zod enum mirrors is
 * derived from the migrations, whether Postgres spells it `create type` or `check (… in (…))`.
 */
describe('CHECK-constraint columns and their Zod mirrors', () => {
  it('reads activities.pricing_mode’s labels out of the migrations at all', () => {
    // Guards the guard, exactly as above: a regex matching nothing passes every assertion vacuously.
    const labels = checkLabelsFromMigrations('pricing_mode');
    expect(labels).toContain('per_person');
    expect(labels.length).toBeGreaterThanOrEqual(4);
  });

  it('accepts every pricing_mode the database can store', () => {
    for (const label of checkLabelsFromMigrations('pricing_mode')) {
      expect(
        pricingModeSchema.safeParse(label).success,
        `pricingModeSchema rejects '${label}', which the database can store — every read of an ` +
          `activity carrying it answers 500. Add it to the enum in src/lib/validation/tours.ts.`,
      ).toBe(true);
    }
  });

  it('accepts vehicle_custom specifically, which is the one that broke', () => {
    expect(pricingModeSchema.safeParse('vehicle_custom').success).toBe(true);
  });

  it('does not accept a mode the database has never had', () => {
    expect(pricingModeSchema.safeParse('per_hovercraft').success).toBe(false);
  });
});
