import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';

/**
 * Schema guard for 20260909000000_quotes.
 *
 * The migration ledger / catch-up parity guards only prove the FILE is mirrored — they would pass
 * just the same if a table were spelled wrong or a constraint silently dropped. This asserts the
 * invariants the migration exists to enforce, before api_convert_quote is built on top of them:
 *
 *  - the money columns are `bigint`, like every other column on the money path (int caps at ~21.4M
 *    EUR-cents; 20260615121000 widened bookings/booking_items for exactly the full-boat charter case
 *    a bespoke quote is FOR, so the quotes tables must not reintroduce the cap);
 *  - anon can neither read nor write any of the three tables (the guest reads a quote server-side
 *    behind the link token, never with the anon key);
 *  - `quotes.booking_id` is UNIQUE — the schema-level half of "one quote never mints two bookings";
 *  - `quote_item_shape` — a catalogue line names an occurrence + option, a custom/rental line names
 *    neither and must carry its own description;
 *  - `booking_custom_items` refuses `kind = 'catalogue'` — a catalogue line has an occurrence, so it
 *    belongs in booking_items, not here.
 */

/** [table, column] pairs that carry money and therefore must be bigint. */
const MONEY_COLUMNS: Array<[string, string]> = [
  ['quotes', 'total_minor'],
  ['quote_items', 'unit_amount_minor'],
  ['quote_items', 'subtotal_minor'],
  ['booking_custom_items', 'unit_amount_minor'],
  ['booking_custom_items', 'subtotal_minor'],
];

const QUOTE_TABLES = ['quotes', 'quote_items', 'booking_custom_items'] as const;

/** A syntactically valid INSERT per table, so the failure is the privilege check and nothing else. */
const ANON_INSERTS: Record<(typeof QUOTE_TABLES)[number], string> = {
  quotes: `insert into quotes (ref, customer_name, customer_email, valid_until)
           values ('BMT-ANON1', 'Anon', 'anon@example.com', current_date + 7)`,
  quote_items: `insert into quote_items
                  (quote_id, position, kind, description, quantity, unit_amount_minor, subtotal_minor)
                values (gen_random_uuid(), 1, 'custom', 'Forged line', 1, 100, 100)`,
  booking_custom_items: `insert into booking_custom_items
                           (booking_id, position, kind, description, quantity, unit_amount_minor, subtotal_minor)
                         values (gen_random_uuid(), 1, 'custom', 'Forged line', 1, 100, 100)`,
};

describe('quotes schema (20260909000000)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('stores every money column as bigint, not int', async () => {
    for (const [table, column] of MONEY_COLUMNS) {
      const { rows } = await db.pg.query<{ data_type: string }>(
        `select data_type from information_schema.columns
          where table_schema = 'public' and table_name = $1 and column_name = $2`,
        [table, column],
      );
      expect(rows[0]?.data_type, `${table}.${column} is missing`).toBeDefined();
      expect(
        rows[0]!.data_type,
        `${table}.${column} is ${rows[0]!.data_type}; int caps at ~21.4M EUR-cents and a full-boat charter overflows it`,
      ).toBe('bigint');
    }
  });

  it('refuses anon reads and writes on all three tables', async () => {
    await db.as(null);
    try {
      for (const table of QUOTE_TABLES) {
        await expect(
          db.pg.query(`select * from ${table} limit 1`),
          `anon can read ${table}`,
        ).rejects.toThrow(/permission denied/i);
        await expect(db.pg.query(ANON_INSERTS[table]), `anon can write ${table}`).rejects.toThrow(
          /permission denied/i,
        );
      }
    } finally {
      await db.asOwner();
    }
  });

  it('refuses a second quote pointing at the same booking', async () => {
    const { rows: booking } = await db.pg.query<{ id: string }>(
      `insert into bookings (customer_name, customer_email, status, total_minor)
       values ('Converted Guest', 'converted@example.com', 'confirmed', 12000) returning id`,
    );
    const bookingId = booking[0]!.id;

    await db.pg.query(
      `insert into quotes (ref, customer_name, customer_email, valid_until, booking_id)
       values ('BMT-QUNIQ1', 'Guest', 'guest@example.com', current_date + 7, $1)`,
      [bookingId],
    );
    await expect(
      db.pg.query(
        `insert into quotes (ref, customer_name, customer_email, valid_until, booking_id)
         values ('BMT-QUNIQ2', 'Guest', 'guest@example.com', current_date + 7, $1)`,
        [bookingId],
      ),
    ).rejects.toThrow(/quotes_booking_id_key/);
  });

  describe('quote_item_shape', () => {
    let quoteId: string;
    let occurrenceId: string;
    let optionId: string;

    beforeAll(async () => {
      const seeded = await seedOccurrence(db, 10);
      occurrenceId = seeded.occurrenceId;
      optionId = seeded.optionId;
      const { rows } = await db.pg.query<{ id: string }>(
        `insert into quotes (ref, customer_name, customer_email, valid_until)
         values ('BMT-QSHAPE', 'Guest', 'guest@example.com', current_date + 7) returning id`,
      );
      quoteId = rows[0]!.id;
    });

    it('accepts a catalogue line with an occurrence + option, and a custom line with neither', async () => {
      await db.pg.query(
        `insert into quote_items
           (quote_id, position, kind, session_occurrence_id, activity_option_id,
            quantity, unit_amount_minor, subtotal_minor)
         values ($1, 1, 'catalogue', $2, $3, 2, 7500, 15000)`,
        [quoteId, occurrenceId, optionId],
      );
      await db.pg.query(
        `insert into quote_items
           (quote_id, position, kind, description, quantity, unit_amount_minor, subtotal_minor)
         values ($1, 2, 'custom', 'Private skipper, full day', 1, 40000, 40000)`,
        [quoteId],
      );
      const { rows } = await db.pg.query<{ n: number }>(
        `select count(*)::int as n from quote_items where quote_id = $1`,
        [quoteId],
      );
      expect(rows[0]!.n).toBe(2);
    });

    it('refuses a catalogue line with no occurrence', async () => {
      await expect(
        db.pg.query(
          `insert into quote_items
             (quote_id, position, kind, activity_option_id, quantity, unit_amount_minor, subtotal_minor)
           values ($1, 3, 'catalogue', $2, 1, 7500, 7500)`,
          [quoteId, optionId],
        ),
      ).rejects.toThrow(/quote_item_shape/);
    });

    it('refuses a custom line that names an occurrence', async () => {
      await expect(
        db.pg.query(
          `insert into quote_items
             (quote_id, position, kind, description, session_occurrence_id,
              quantity, unit_amount_minor, subtotal_minor)
           values ($1, 4, 'custom', 'Smuggled catalogue line', $2, 1, 7500, 7500)`,
          [quoteId, occurrenceId],
        ),
      ).rejects.toThrow(/quote_item_shape/);
    });
  });

  it('refuses a catalogue line in booking_custom_items', async () => {
    const { rows: booking } = await db.pg.query<{ id: string }>(
      `insert into bookings (customer_name, customer_email, status, total_minor)
       values ('Custom Guest', 'custom@example.com', 'confirmed', 40000) returning id`,
    );
    await expect(
      db.pg.query(
        `insert into booking_custom_items
           (booking_id, position, kind, description, quantity, unit_amount_minor, subtotal_minor)
         values ($1, 1, 'catalogue', 'Belongs in booking_items', 1, 7500, 7500)`,
        [booking[0]!.id],
      ),
    ).rejects.toThrow(/booking_custom_items_kind_check/);
  });
});
