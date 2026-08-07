import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { bookingSourceSchema } from '@/lib/validation/common';

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
