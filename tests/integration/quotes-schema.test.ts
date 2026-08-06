import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedOccurrence } from '../db/seed';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';

/**
 * Schema guard for 20260909000000_quotes.
 *
 * The migration ledger / catch-up parity guards only prove the FILE is mirrored — they would pass
 * just the same if a table were spelled wrong or a constraint silently dropped. This asserts the
 * invariants the migration exists to enforce, before api_convert_quote is built on top of them:
 *
 *  - `booking_source` gained the label 'quote'. This is the migration's ONE order-sensitive statement
 *    — it has to come first, because Postgres forbids using a value added by ALTER TYPE inside the
 *    transaction that added it — and it is the value api_convert_quote writes into `bookings.source`.
 *    Drop it or move it and every other guard in this file, the ledger tests and catch-up parity all
 *    stay green; the failure would surface only when the conversion RPC is built on top of it.
 *  - the money columns are `bigint`, like every other column on the money path (int caps at ~21.4M
 *    EUR-cents; 20260615121000 widened bookings/booking_items for exactly the full-boat charter case
 *    a bespoke quote is FOR, so the quotes tables must not reintroduce the cap);
 *  - anon can neither read nor write any of the three tables (the guest reads a quote server-side
 *    behind the link token, never with the anon key);
 *  - `quotes.booking_id` is UNIQUE — the schema-level half of "one quote never mints two bookings" —
 *    and `converted_at` survives the hard-delete that nulls it;
 *  - `quote_item_shape` — a catalogue line names an occurrence + option, a custom/rental line names
 *    neither and must carry its own description;
 *  - `booking_custom_items` refuses `kind = 'catalogue'` — a catalogue line has an occurrence, so it
 *    belongs in booking_items, not here;
 *  - the two FKs a quote line points OUT through behave as declared: a quoted occurrence survives
 *    "stop availability" (closed, never deleted), a draft quote never blocks a vehicle leaving the
 *    fleet, and a priced booking line does;
 *  - and every OTHER caller that deletes the rows a quote line points at — the tour editor's option
 *    reconcile and "delete tour" — is taught about them too, through the real admin helpers.
 */

const QUOTES_MIGRATION = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '20260909000000_quotes.sql'),
  'utf8',
);

/* The tour-editor helpers under test talk to Supabase through the browser client; the shim maps that
 * query builder onto the same PGlite instance, so the FK actions they trip over are the real ones. */
const hoisted = vi.hoisted(() => ({ shim: null as SupabaseShim | null }));
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => {
    if (!hoisted.shim) throw new Error('shim not initialised');
    return hoisted.shim;
  },
}));

const { EMPTY_ACTIVITY, updateActivity, deleteActivity } =
  await import('@/lib/admin/activity-write');

/**
 * The migration's table-lockdown tail — the `revoke all … from public, anon` plus the explicit
 * grants, which are deliberately the LAST statements in the file so this slice is exactly them.
 *
 * Why the test re-executes it: tests/db/auth-shim.sql replicates Supabase's ALTER DEFAULT PRIVILEGES
 * for FUNCTIONS ONLY (its own comment says so), so under PGlite a brand-new table hands anon nothing
 * to begin with and the anon-denied assertions below pass whether or not the revoke exists. On the
 * real project stock defaults DO hand anon every new table, so that revoke is the only thing closing
 * it — the one line in the migration with no coverage, and this repo has shipped exactly that leak
 * twice (api_booking_receipt, api_pending_payment_checkouts). beforeAll therefore grants anon the
 * tables to reproduce production's starting point and re-runs this tail: delete the revoke and the
 * grants survive, so the anon test goes red.
 */
const LOCKDOWN_TAIL = QUOTES_MIGRATION.slice(QUOTES_MIGRATION.indexOf('revoke all on quotes'));

const STAFF = 'd1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1';

/** [table, column] pairs that carry money and therefore must be bigint. */
const MONEY_COLUMNS: Array<[string, string]> = [
  ['quotes', 'total_minor'],
  ['quote_items', 'unit_amount_minor'],
  ['quote_items', 'subtotal_minor'],
  ['booking_custom_items', 'unit_amount_minor'],
  ['booking_custom_items', 'subtotal_minor'],
];

const QUOTE_TABLES = ['quotes', 'quote_items', 'booking_custom_items'] as const;

/**
 * Every function this migration creates or re-applies, with the EXECUTE the `authenticated` role is
 * supposed to be left holding. anon is never allowed one and service_role always is.
 *
 * `authenticated: true` = a staff/owner tool the signed-in admin (or the user erasing their own
 * account) calls through PostgREST. `authenticated: false` = a definer that only ever runs from
 * inside the database: 20260814000000 established that trigger execution never checks the caller's
 * EXECUTE, so revoking it costs the trigger nothing and closes the direct PostgREST call an
 * authenticated user could otherwise make to redact someone else's quote lines.
 */
const DEFINER_EXECUTE: ReadonlyArray<{ sig: string; authenticated: boolean }> = [
  { sig: 'stop_availability_atomic(jsonb)', authenticated: true },
  { sig: 'api_erase_user(jsonb)', authenticated: true },
  { sig: 'quotes_redact_lines()', authenticated: false },
];

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
    // Production's starting point: stock Supabase default privileges hand anon every new table.
    // See LOCKDOWN_TAIL above for why the harness cannot show that on its own.
    await db.pg.exec(
      `grant select, insert, update, delete on quotes, quote_items, booking_custom_items to anon;`,
    );
    await db.pg.exec(LOCKDOWN_TAIL);
    // A staff account, so the admin RPCs below run through their real is_staff() gate.
    await db.pg.query(`insert into auth.users (id) values ($1)`, [STAFF]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Admin', 'admin')`, [
      STAFF,
    ]);
    hoisted.shim = makeSupabaseShim(db.pg);
  });

  afterAll(async () => {
    await db.close();
  });

  it("adds 'quote' to the booking_source enum", async () => {
    const { rows } = await db.pg.query<{ label: string }>(
      `select e.enumlabel as label
         from pg_enum e
         join pg_type t on t.oid = e.enumtypid
        where t.typname = 'booking_source'
        order by e.enumsortorder`,
    );
    const labels = rows.map((row) => row.label);
    expect(labels, 'booking_source enum is missing entirely').not.toHaveLength(0);
    expect(
      labels,
      `booking_source is [${labels.join(', ')}]; api_convert_quote inserts source = 'quote' and would fail at runtime`,
    ).toContain('quote');
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

  it('refuses a quote priced in anything but EUR', async () => {
    // The DENOMINATION gets the same second look the amount already gets. api_convert_quote
    // re-derives and re-compares `total_minor` before it mints a booking, then copies `currency`
    // across untouched — and downstream nothing re-checks it: payments_ledger_currency_eur
    // (20260830000000) pins payments.currency = 'EUR' and api_create_payment never reads the
    // booking's currency. A quote stored as 'MUR' would therefore be shown and emailed as
    // "MUR 50000" and then charged 500 EUR: a silent mismatch, not a failure anyone would see.
    await expect(
      db.pg.query(
        `insert into quotes (ref, customer_name, customer_email, valid_until, currency, total_minor)
         values ('QCURR1', 'Guest', 'mur@example.com', current_date + 7, 'MUR', 50000)`,
      ),
      'a MUR quote was stored; it would be quoted in rupees and charged in euro',
    ).rejects.toThrow(/quotes_currency_eur/);

    // …and an UPDATE cannot reach it either, which is the way an already-sent quote would drift.
    await db.pg.query(
      `insert into quotes (ref, customer_name, customer_email, valid_until, total_minor)
       values ('QCURR2', 'Guest', 'eur@example.com', current_date + 7, 50000)`,
    );
    await expect(
      db.pg.query(`update quotes set currency = 'MUR' where ref = 'QCURR2'`),
    ).rejects.toThrow(/quotes_currency_eur/);
    const { rows } = await db.pg.query<{ currency: string }>(
      `select currency from quotes where ref = 'QCURR2'`,
    );
    expect(rows[0]!.currency).toBe('EUR');
  });

  it('refuses anon reads and writes on all three tables', async () => {
    // Privilege check first, and via has_table_privilege(): role_table_grants is documented in this
    // repo as lying (it once reported NO grant on a table anon could freely read).
    for (const table of QUOTE_TABLES) {
      for (const priv of ['select', 'insert', 'update', 'delete'] as const) {
        const { rows } = await db.pg.query<{ granted: boolean }>(
          `select has_table_privilege('anon', $1, $2) as granted`,
          [table, priv],
        );
        expect(rows[0]!.granted, `anon still holds ${priv} on ${table}`).toBe(false);
      }
    }

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

    // Both carry converted_at: quote_converted_shape (below) refuses a booking_id without one, and
    // this case must reach the UNIQUE, not die on the check.
    await db.pg.query(
      `insert into quotes (ref, customer_name, customer_email, valid_until, booking_id, converted_at)
       values ('BMT-QUNIQ1', 'Guest', 'guest@example.com', current_date + 7, $1, now())`,
      [bookingId],
    );
    await expect(
      db.pg.query(
        `insert into quotes (ref, customer_name, customer_email, valid_until, booking_id, converted_at)
         values ('BMT-QUNIQ2', 'Guest', 'guest@example.com', current_date + 7, $1, now())`,
        [bookingId],
      ),
    ).rejects.toThrow(/quotes_booking_id_key/);
  });

  it('refuses a booking_id with no converted_at — the conversion record is not optional', async () => {
    // Section 4 of the migration states the contract "set converted_at alongside booking_id, and
    // guard on converted_at" in a COMMENT. A comment is not an invariant: a conversion path that
    // sets booking_id and forgets converted_at leaves the quote looking unconverted the moment
    // api_erase_user hard-deletes the unpaid booking and the FK nulls booking_id — which re-arms the
    // guard the next task builds on and is the precise scenario converted_at exists to prevent.
    const { rows: booking } = await db.pg.query<{ id: string }>(
      `insert into bookings (customer_name, customer_email, status, total_minor)
       values ('Half-converted Guest', 'halfconv@example.com', 'draft', 5000) returning id`,
    );
    await expect(
      db.pg.query(
        `insert into quotes (ref, customer_name, customer_email, valid_until, booking_id)
         values ('BMT-QSHAPE3', 'Guest', 'guest@example.com', current_date + 7, $1)`,
        [booking[0]!.id],
      ),
      'a quote can name a booking without recording that it converted',
    ).rejects.toThrow(/quote_converted_shape/);

    // …and the constraint holds under the FK that clears booking_id: converted_at stays, so the row
    // is still legal after the booking is hard-deleted.
    await db.pg.query(
      `insert into quotes (ref, customer_name, customer_email, valid_until, booking_id, converted_at)
       values ('BMT-QSHAPE4', 'Guest', 'guest@example.com', current_date + 7, $1, now())`,
      [booking[0]!.id],
    );
    await expect(
      db.pg.query(`delete from bookings where id = $1`, [booking[0]!.id]),
      'quote_converted_shape blocked the `on delete set null` it has to coexist with',
    ).resolves.toBeTruthy();
  });

  it('closes EXECUTE on every function this migration creates or re-applies', async () => {
    // `revoke ... from public` is the known-insufficient form: Supabase's stock ALTER DEFAULT
    // PRIVILEGES grants EXECUTE on a new function to anon and authenticated EXPLICITLY, not through
    // PUBLIC, and CREATE OR REPLACE does not reset an existing ACL — so re-applying a function whose
    // original grant leaked leaves it leaking. This repo has shipped exactly that twice
    // (api_booking_receipt, api_pending_payment_checkouts), both times by omitting ONE word from the
    // revoke list — so the list is asserted per role, per function, rather than for anon alone.
    for (const { sig, authenticated } of DEFINER_EXECUTE) {
      const { rows } = await db.pg.query<{ anon: boolean; auth: boolean; sr: boolean }>(
        `select has_function_privilege('anon', $1, 'EXECUTE') as anon,
                has_function_privilege('authenticated', $1, 'EXECUTE') as auth,
                has_function_privilege('service_role', $1, 'EXECUTE') as sr`,
        [`public.${sig}`],
      );
      expect(rows[0]!.anon, `anon can execute ${sig}`).toBe(false);
      expect(
        rows[0]!.auth,
        authenticated
          ? `the signed-in admin lost ${sig}`
          : `a signed-in user can still call ${sig} directly over PostgREST`,
      ).toBe(authenticated);
      expect(rows[0]!.sr, `service_role lost ${sig}`).toBe(true);
    }
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

  it('keeps converted_at after the converted booking is hard-deleted (booking_id alone is not the record)', async () => {
    // api_erase_user hard-deletes every unpaid/pending booking for a person, and quotes.booking_id is
    // `on delete set null` — so the column the conversion guard reads can be cleared by a statement
    // that knows nothing about quotes, re-arming a converted quote to mint a second booking.
    // converted_at is the durable half: no FK can reach it.
    const { rows: booking } = await db.pg.query<{ id: string }>(
      `insert into bookings (customer_name, customer_email, status, total_minor)
       values ('Erased Guest', 'erased@example.com', 'draft', 9000) returning id`,
    );
    await db.pg.query(
      `insert into quotes (ref, customer_name, customer_email, valid_until, booking_id, converted_at)
       values ('BMT-QCONV1', 'Guest', 'guest@example.com', current_date + 7, $1, now())`,
      [booking[0]!.id],
    );

    await db.pg.query(`delete from bookings where id = $1`, [booking[0]!.id]);

    const { rows } = await db.pg.query<{ booking_id: string | null; converted_at: string | null }>(
      `select booking_id, converted_at from quotes where ref = 'BMT-QCONV1'`,
    );
    expect(rows[0]!.booking_id, 'the FK should have nulled booking_id').toBeNull();
    expect(
      rows[0]!.converted_at,
      'converted_at was cleared with the booking — the conversion guard has nothing durable to read',
    ).not.toBeNull();
  });

  it('closes — never deletes — an empty future slot a quote line still points at', async () => {
    // stop_availability_atomic DELETEs empty future occurrences, guarded only by "no booking_items,
    // no booking_holds". A draft quote's catalogue line has neither, so without a quote guard the
    // NO ACTION foreign key aborts the whole SECURITY DEFINER function and admin "stop availability"
    // dies with a raw Postgres error for any activity that appears on any quote.
    await db.asOwner();
    const seeded = await seedOccurrence(db, 8);
    const { rows: quote } = await db.pg.query<{ id: string }>(
      `insert into quotes (ref, customer_name, customer_email, valid_until)
       values ('BMT-QSTOP1', 'Guest', 'guest@example.com', current_date + 7) returning id`,
    );
    await db.pg.query(
      `insert into quote_items
         (quote_id, position, kind, session_occurrence_id, activity_option_id,
          quantity, unit_amount_minor, subtotal_minor)
       values ($1, 1, 'catalogue', $2, $3, 2, 7500, 15000)`,
      [quote[0]!.id, seeded.occurrenceId, seeded.optionId],
    );

    await db.as({ sub: STAFF, role: 'authenticated' });
    await expect(
      db.pg.query(`select stop_availability_atomic($1::jsonb)`, [
        JSON.stringify({ activityId: seeded.activityId }),
      ]),
      'stop_availability_atomic aborted on a quoted occurrence',
    ).resolves.toBeTruthy();

    await db.asOwner();
    const { rows } = await db.pg.query<{ status: string }>(
      `select status from session_occurrences where id = $1`,
      [seeded.occurrenceId],
    );
    expect(rows[0]?.status, 'the quoted occurrence was deleted instead of closed').toBe('closed');
  });

  describe('rental_vehicle_slug foreign keys declare their intent', () => {
    it('lets a vehicle leave the fleet while a DRAFT quote names it (set null)', async () => {
      await db.asOwner();
      const { rows: quote } = await db.pg.query<{ id: string }>(
        `insert into quotes (ref, customer_name, customer_email, valid_until)
         values ('BMT-QRENT1', 'Guest', 'guest@example.com', current_date + 7) returning id`,
      );
      await db.pg.query(
        `insert into quote_items
           (quote_id, position, kind, description, rental_vehicle_slug,
            quantity, unit_amount_minor, subtotal_minor)
         values ($1, 1, 'rental', 'Haojue VX, 3 days', 'haojue-vx', 3, 2000, 6000)`,
        [quote[0]!.id],
      );

      await expect(
        db.pg.query(`delete from rental_vehicles where slug = 'haojue-vx'`),
        'a draft quote line blocked a vehicle from leaving the fleet',
      ).resolves.toBeTruthy();

      const { rows } = await db.pg.query<{ slug: string | null; description: string }>(
        `select rental_vehicle_slug as slug, description from quote_items where quote_id = $1`,
        [quote[0]!.id],
      );
      expect(rows[0]!.slug).toBeNull();
      // The line stays readable without the join — the description carries the vehicle name.
      expect(rows[0]!.description).toContain('Haojue VX');
    });

    it('refuses to remove a vehicle a priced booking line names (restrict)', async () => {
      await db.asOwner();
      const { rows: booking } = await db.pg.query<{ id: string }>(
        `insert into bookings (customer_name, customer_email, status, total_minor)
         values ('Rental Guest', 'rental@example.com', 'confirmed', 6000) returning id`,
      );
      await db.pg.query(
        `insert into booking_custom_items
           (booking_id, position, kind, description, rental_vehicle_slug,
            quantity, unit_amount_minor, subtotal_minor)
         values ($1, 1, 'rental', 'Suzuki Address, 3 days', 'suzuki-address', 3, 2000, 6000)`,
        [booking[0]!.id],
      );

      await expect(
        db.pg.query(`delete from rental_vehicles where slug = 'suzuki-address'`),
      ).rejects.toThrow(/booking_custom_items_rental_vehicle_slug_fkey/);
    });
  });

  /**
   * stop_availability_atomic is not the only caller that deletes the rows a catalogue quote line
   * points at. `quote_items.activity_option_id` is NO ACTION and `session_occurrences` CASCADEs from
   * `activity_options`, so deleting an OPTION reaches quote_items through both foreign keys — and two
   * live admin paths delete options, guarded only by a booking_items check.
   */
  describe('the tour editor is taught about quote lines too', () => {
    const OPERATOR = 'belle-mare-tours';

    /** An activity + two options (each with a materialised slot) owned by the real operator slug. */
    async function seedTour(slug: string): Promise<{
      activityId: string;
      keptOptionId: string;
      quotedOptionId: string;
      quotedOccurrenceId: string;
    }> {
      await db.asOwner();
      const operatorId = (
        await db.pg.query<{ id: string }>(`select id from operators where slug = $1`, [OPERATOR])
      ).rows[0]!.id;
      const activityId = (
        await db.pg.query<{ id: string }>(
          `insert into activities (operator_id, slug, title, category, status)
           values ($1, $2, 'Quoted Tour', 'Sightseeing tours', 'published') returning id`,
          [operatorId, slug],
        )
      ).rows[0]!.id;
      const optionIds: string[] = [];
      const occurrenceIds: string[] = [];
      for (const [position, name] of [
        [0, 'Shared'],
        [1, 'Sunset'],
      ] as const) {
        const optionId = (
          await db.pg.query<{ id: string }>(
            `insert into activity_options (activity_id, name, position) values ($1, $2, $3) returning id`,
            [activityId, name, position],
          )
        ).rows[0]!.id;
        await db.pg.query(
          `insert into activity_option_prices (activity_option_id, label, amount_minor, position)
           values ($1, 'Adult', 7000, 0)`,
          [optionId],
        );
        occurrenceIds.push(
          (
            await db.pg.query<{ id: string }>(
              `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
               values ($1, $2, now() + interval '9 days', now() + interval '9 days 4 hours', 10)
               returning id`,
              [optionId, operatorId],
            )
          ).rows[0]!.id,
        );
        optionIds.push(optionId);
      }
      return {
        activityId,
        keptOptionId: optionIds[0]!,
        quotedOptionId: optionIds[1]!,
        quotedOccurrenceId: occurrenceIds[1]!,
      };
    }

    /** A draft quote whose single catalogue line names the given option + occurrence. */
    async function quoteLineOn(ref: string, occurrenceId: string, optionId: string): Promise<void> {
      const quoteId = (
        await db.pg.query<{ id: string }>(
          `insert into quotes (ref, customer_name, customer_email, valid_until)
           values ($1, 'Guest', 'guest@example.com', current_date + 7) returning id`,
          [ref],
        )
      ).rows[0]!.id;
      await db.pg.query(
        `insert into quote_items
           (quote_id, position, kind, session_occurrence_id, activity_option_id,
            quantity, unit_amount_minor, subtotal_minor)
         values ($1, 1, 'catalogue', $2, $3, 2, 7000, 14000)`,
        [quoteId, occurrenceId, optionId],
      );
    }

    beforeAll(async () => {
      await db.asOwner();
      await db.pg.query(`insert into operators (name, slug) values ('Belle Mare Tours', $1)`, [
        OPERATOR,
      ]);
    });

    it('keeps a quoted option the owner removed from the editor, instead of failing the save', async () => {
      const tour = await seedTour('quoted-option-tour');
      await quoteLineOn('BMT-QOPT1', tour.quotedOccurrenceId, tour.quotedOptionId);

      // The owner drops the quoted option from the form and saves.
      const form = {
        ...EMPTY_ACTIVITY,
        slug: 'quoted-option-tour',
        title: 'Quoted Tour',
        options: [
          {
            id: tour.keptOptionId,
            name: 'Shared',
            prices: [{ label: 'Adult', amountEur: 70, maxGuests: null }],
          },
        ],
      };

      await db.as({ sub: STAFF, role: 'authenticated' });
      // Before the guard this threw the raw 23503 MID-SAVE — after the activities row and the images
      // had already been written as separate statements, so the save was left half-applied.
      await expect(
        updateActivity(tour.activityId, form),
        'the save blew up on a quoted option',
      ).resolves.toBeUndefined();

      await db.asOwner();
      const opts = (
        await db.pg.query<{ id: string }>(
          `select id from activity_options where activity_id = $1`,
          [tour.activityId],
        )
      ).rows.map((r) => r.id);
      expect(opts, 'the quoted option was deleted out from under a live offer').toContain(
        tour.quotedOptionId,
      );
    });

    it('explains a quoted tour instead of surfacing the raw constraint on delete', async () => {
      const tour = await seedTour('quoted-delete-tour');
      await quoteLineOn('BMT-QOPT2', tour.quotedOccurrenceId, tour.quotedOptionId);

      await db.as({ sub: STAFF, role: 'authenticated' });
      const err = await deleteActivity(tour.activityId).then(
        () => null,
        (e: unknown) => e,
      );
      await db.asOwner();

      expect(err, 'deleting a quoted tour silently succeeded').not.toBeNull();
      const message =
        err instanceof Error ? err.message : String((err as { message?: string })?.message ?? err);
      expect(message, 'the raw Postgres constraint reached the operator').not.toMatch(
        /foreign key|fkey|violates/i,
      );
      expect(message, 'the message does not say the tour is on a quote').toMatch(/quote/i);
      expect(message, 'the message does not offer the alternative').toMatch(/draft/i);
    });

    it('still surfaces a non-quote foreign-key failure unchanged (the UI translates 23503 itself)', async () => {
      // A tour with a CONFIRMED booking is blocked by booking_items, not by quotes. Translating that
      // into a quotes message would be a lie — and would mask the "…has bookings or availability"
      // branch AdminActivities already renders from the 23503 code.
      const tour = await seedTour('booked-delete-tour');
      const bookingId = (
        await db.pg.query<{ id: string }>(
          `insert into bookings (customer_name, customer_email, status, total_minor)
           values ('Booked Guest', 'booked@example.com', 'confirmed', 7000) returning id`,
        )
      ).rows[0]!.id;
      await db.pg.query(
        `insert into booking_items
           (booking_id, session_occurrence_id, activity_option_id, price_label, quantity,
            unit_amount_minor, subtotal_minor)
         values ($1, $2, $3, 'Adult', 1, 7000, 7000)`,
        [bookingId, tour.quotedOccurrenceId, tour.quotedOptionId],
      );

      await db.as({ sub: STAFF, role: 'authenticated' });
      const err = (await deleteActivity(tour.activityId).then(
        () => null,
        (e: unknown) => e,
      )) as { code?: string; message?: string } | null;
      await db.asOwner();

      expect(err, 'deleting a booked tour silently succeeded').not.toBeNull();
      // Rethrown verbatim: still a PostgrestError-shaped object carrying the integrity-violation code,
      // which is what AdminActivities keys its own message off. Wrapping it in an Error would strip
      // `code` and silence that branch.
      //
      // The EXACT code, not /^23/: booking_items.activity_option_id is `on delete restrict`
      // (20260615120300), and RESTRICT raises 23001 — NOT the 23503 that plain NO ACTION raises. A
      // prefix match cannot tell the two apart, and AdminActivities matched only 23503, so a booked
      // tour missed the branch and showed the operator the raw Postgres string. Pin the code the real
      // schema produces so that stays honest.
      expect(err?.code, 'the DB error code the admin screen keys off was swallowed').toBe('23001');
      expect(err?.message, 'a booked tour was reported as a quoted one').not.toMatch(/quote/i);
      expect(err?.message, 'the underlying cause was replaced').toMatch(/booking_items/);
    });

    it('rethrows the real failure when the quote count itself could not be taken', async () => {
      // The mirror image of the test above: same BOOKED tour, but the quote_items count fails (a
      // schema cache that has not caught up with a deploy, an RLS denial, a dropped connection).
      //
      // A failed count is not evidence of a quote. Resolving the unknown in the ASSERTIVE direction
      // told the operator a tour was "named on at least one quote line" when the only thing holding
      // it was a booking — and did so through a bare `new Error`, which strips the `code` the admin
      // screen reads and so also suppressed its own "has bookings or availability" message. (The
      // option-reconcile guard resolves an unknown count the other way, toward KEEPING the option,
      // which is conservative and right; accusing is not the same shape of decision.)
      const tour = await seedTour('count-failed-delete-tour');
      const bookingId = (
        await db.pg.query<{ id: string }>(
          `insert into bookings (customer_name, customer_email, status, total_minor)
           values ('Counted Guest', 'counted@example.com', 'confirmed', 7000) returning id`,
        )
      ).rows[0]!.id;
      await db.pg.query(
        `insert into booking_items
           (booking_id, session_occurrence_id, activity_option_id, price_label, quantity,
            unit_amount_minor, subtotal_minor)
         values ($1, $2, $3, 'Adult', 1, 7000, 7000)`,
        [bookingId, tour.quotedOccurrenceId, tour.quotedOptionId],
      );

      // Break ONLY the quote_items read, exactly as the fleet test breaks booking_custom_items.
      const real = hoisted.shim!;
      const broken = {
        message: 'Could not find the table public.quote_items in the schema cache',
      };
      hoisted.shim = {
        ...real,
        from: (table: string) =>
          table === 'quote_items'
            ? ({
                select: () => ({
                  in: () => Promise.resolve({ data: null, count: null, error: broken }),
                }),
              } as never)
            : real.from(table),
      } as SupabaseShim;

      let err: { code?: string; message?: string } | null;
      try {
        await db.as({ sub: STAFF, role: 'authenticated' });
        err = (await deleteActivity(tour.activityId).then(
          () => null,
          (e: unknown) => e,
        )) as { code?: string; message?: string } | null;
      } finally {
        hoisted.shim = real;
        await db.asOwner();
      }

      expect(err, 'deleting a booked tour silently succeeded').not.toBeNull();
      expect(err?.code, 'an unreadable count cost the admin screen the code it keys off').toBe(
        '23001',
      );
      expect(err?.message, 'a count that failed was reported as an existing quote').not.toMatch(
        /quote/i,
      );
      expect(err?.message, 'the underlying cause was replaced').toMatch(/booking_items/);
    });
  });
});
