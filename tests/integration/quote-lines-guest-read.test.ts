import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * A guest can see the lines of the quote booking they paid for.
 *
 * The trap this pins: `booking_json` is `security invoker`, so every subquery in it runs under the
 * CALLER's RLS. `booking_custom_items` shipped (20260909000000) with a single staff-only policy
 * while its sibling `booking_items` has had an owner-or-staff SELECT policy since 20260615120800 —
 * so the guest's own read matched zero rows and `customItems` came back `[]`.
 *
 * Nothing failed loudly, which is why it survived a whole feature being built on top of it: the
 * SELECT grant is present, so this was never a permission error, and RLS filters rows rather than
 * raising. An empty array is exactly what an ordinary (non-quote) booking returns. Every check run
 * as staff or as the table owner passed — the admin drawer, the DTO's own tests, a hand-run
 * `select booking_json(...)` in the SQL editor. Only the guest saw the hole, and only in production.
 *
 * So these tests assert the guest's view SPECIFICALLY. Reading as owner would pass either way and
 * prove nothing.
 */

const GUEST = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const STRANGER = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STAFF = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

interface CustomLine {
  description: string;
  quantity: number;
  unitAmountEur: number;
  subtotalEur: number;
}

describe('booking_custom_items: the guest reads their own quote booking’s lines', () => {
  let db: TestDb;
  let bookingId: string;
  /** A second booking, owned by nobody — the emailed-link path, before any account claims it. */
  let ownerlessId: string;

  /** `customItems` as the CURRENTLY impersonated caller sees it — the whole point of this suite. */
  async function customItemsAsCaller(id: string): Promise<CustomLine[]> {
    const { rows } = await db.pg.query<{ lines: CustomLine[] | null }>(
      `select booking_json($1::uuid) -> 'customItems' as lines`,
      [id],
    );
    return rows[0]!.lines ?? [];
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    for (const uid of [GUEST, STRANGER, STAFF]) {
      await db.pg.query(`insert into auth.users (id) values ($1)`, [uid]);
    }
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [GUEST]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [STRANGER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'admin')`, [STAFF]);

    // A quote booking as api_convert_quote mints one: no booking_items at all, the whole itemisation
    // in booking_custom_items.
    const mk = async (ref: string, userId: string | null): Promise<string> => {
      const { rows } = await db.pg.query<{ id: string }>(
        `insert into bookings (ref, user_id, customer_name, customer_email, source, currency,
                               total_minor, deposit_minor, status, payment_state, locale)
         values ($1, $2, 'Guest', 'guest@example.com', 'quote', 'EUR', 100, 10, 'confirmed', 'paid', 'en')
         returning id`,
        [ref, userId],
      );
      const id = rows[0]!.id;
      await db.pg.query(
        `insert into booking_custom_items (booking_id, kind, description, quantity,
                                          unit_amount_minor, subtotal_minor, position)
         values ($1, 'custom', 'TEST', 1, 100, 100, 0)`,
        [id],
      );
      return id;
    };
    bookingId = await mk('BMTGUESTLINES001', GUEST);
    ownerlessId = await mk('BMTGUESTLINES002', null);
  });

  afterAll(async () => {
    await db.close();
  });

  it('the OWNER of the booking sees its custom lines (the bug: they saw none)', async () => {
    await db.as({ sub: GUEST, role: 'authenticated' });
    const lines = await customItemsAsCaller(bookingId);
    expect(
      lines,
      'the guest who paid for this booking cannot read its lines — booking_json is security ' +
        'invoker, so booking_custom_items needs an owner-or-staff SELECT policy like booking_items',
    ).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      description: 'TEST',
      quantity: 1,
      unitAmountEur: 1,
      subtotalEur: 1,
    });
  });

  it('staff still see them (the pre-existing policy is not replaced)', async () => {
    await db.as({ sub: STAFF, role: 'authenticated' });
    expect(await customItemsAsCaller(bookingId)).toHaveLength(1);
  });

  it('a STRANGER sees none — the fix widens the read to the owner, not to everyone', async () => {
    await db.as({ sub: STRANGER, role: 'authenticated' });
    expect(await customItemsAsCaller(bookingId)).toHaveLength(0);
  });

  it('an ownerless quote booking stays invisible — that path is read under the link token', async () => {
    // user_id is null until api_claim_quote_bookings attaches it, and null matches neither branch.
    await db.as({ sub: STRANGER, role: 'authenticated' });
    expect(await customItemsAsCaller(ownerlessId)).toHaveLength(0);
    await db.as({ sub: GUEST, role: 'authenticated' });
    expect(await customItemsAsCaller(ownerlessId)).toHaveLength(0);
  });

  it('anon sees none', async () => {
    await db.as({ role: 'anon' });
    expect(await customItemsAsCaller(bookingId)).toHaveLength(0);
  });

  it('booking_custom_items carries BOTH policies — the staff one and the owner read', async () => {
    await db.asOwner();
    const { rows } = await db.pg.query<{ policyname: string }>(
      `select policyname from pg_policies where tablename = 'booking_custom_items' order by policyname`,
    );
    expect(rows.map((r) => r.policyname)).toEqual([
      'booking_custom_items_select',
      'booking_custom_items_staff',
    ]);
  });
});
