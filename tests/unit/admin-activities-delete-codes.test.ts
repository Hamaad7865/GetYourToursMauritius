import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isForeignKeyViolation } from '@/lib/admin/delete-guards';

/**
 * The two SQLSTATEs a blocked "delete tour" can arrive as, and the fact that /admin/tours knows
 * about both.
 *
 * Postgres does NOT use one code for "something still references this row". A plain NO ACTION
 * foreign key raises 23503 (foreign_key_violation); ON DELETE RESTRICT raises 23001
 * (restrict_violation). `booking_items.activity_option_id` is `on delete restrict`
 * (20260615120300_bookings.sql), and a tour's options CASCADE from the tour — so deleting a BOOKED
 * tour comes back as 23001, not 23503. Verified under PGlite in
 * tests/integration/quotes-schema.test.ts, which pins the exact code the real schema produces.
 *
 * AdminActivities matched 23503 alone, so the single most likely reason a delete is refused — the
 * tour has been sold — fell through to `e.message` and the operator was shown the raw Postgres
 * string ("update or delete on table … violates foreign key constraint …"), with no mention of
 * setting the tour to Draft instead. The quotes work (20260909000000) deliberately rethrows that
 * error UNCHANGED so the screen keeps the `code`; the screen therefore has to read it correctly.
 *
 * Source scan on purpose: the suite runs in the `node` environment with no jsdom, so a component
 * that only renders a string cannot be exercised any other way — the same approach as
 * fixed-height-grid-rows and snap-rail-scroll-padding.
 */

const SRC = readFileSync(
  join(process.cwd(), 'src', 'components', 'admin', 'AdminActivities.tsx'),
  'utf8',
);

/** Every SQLSTATE the component compares the caught error's `code` against. */
const COMPARED = new Set([...SRC.matchAll(/e\?\.code\s*===\s*'(\d{5})'/g)].map((m) => m[1]!));

describe('AdminActivities: the delete-refused message', () => {
  it('recognises both integrity codes a referenced tour can arrive as', () => {
    for (const code of ['23001', '23503'] as const) {
      expect(
        isForeignKeyViolation({ code }),
        `${code} is not treated as an integrity violation by the shared guard`,
      ).toBe(true);
      expect(
        [...COMPARED],
        `AdminActivities never compares the error code against ${code}, so a tour blocked by ${
          code === '23001' ? 'ON DELETE RESTRICT (a sold seat)' : 'a NO ACTION foreign key'
        } shows the operator the raw Postgres string instead of the Draft alternative`,
      ).toContain(code);
    }
  });

  it('still guides the operator to Draft rather than surfacing the DB message', () => {
    expect(SRC).toMatch(/bookings or availability/);
    expect(SRC).toMatch(/Draft/);
  });
});
