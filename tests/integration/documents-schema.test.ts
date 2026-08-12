import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';

/**
 * The Documents module schema against the REAL migrations: RLS, the CHECK constraints, and the four
 * SECURITY DEFINER RPCs (allocate_document_number / issue_document / convert_document / void_document).
 * A single PGlite connection proves the LOGIC (numbering increments per type/year, the guards fire,
 * RLS locks a non-staff account out) — not true multi-transaction race contention.
 */

const STAFF = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const CUSTOMER = 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2';

const asStaff = { sub: STAFF, role: 'authenticated' as const };
const asCustomer = { sub: CUSTOMER, role: 'authenticated' as const };

/** Insert a draft as the owner (bypassing RLS) and return its id. */
async function seedDraft(
  db: TestDb,
  overrides: { type?: string; currency?: string; issue_date?: string } = {},
): Promise<string> {
  const { rows } = await db.pg.query<{ id: string }>(
    `insert into documents (type, currency, lines, total_minor, issue_date)
       values ($1, $2, '[]'::jsonb, 100000, $3) returning id`,
    [
      overrides.type ?? 'invoice',
      overrides.currency ?? 'MUR',
      overrides.issue_date ?? '2026-08-12',
    ],
  );
  return rows[0]!.id;
}

describe('documents schema + RPCs', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1), ($2)`, [STAFF, CUSTOMER]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, 'Owner', 'admin')`, [
      STAFF,
    ]);
    await db.pg.query(
      `insert into profiles (id, full_name, role) values ($1, 'Guest', 'customer')`,
      [CUSTOMER],
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it('allocates gapless per-type, per-year numbers', async () => {
    await db.as(asStaff);
    const num = async (type: string, year: number) =>
      (
        await db.pg.query<{ allocate_document_number: string }>(
          `select allocate_document_number($1, $2)`,
          [type, year],
        )
      ).rows[0]!.allocate_document_number;

    expect(await num('invoice', 2026)).toBe('INV-2026-0001');
    expect(await num('invoice', 2026)).toBe('INV-2026-0002');
    // A different type has its own sequence.
    expect(await num('quote', 2026)).toBe('QUO-2026-0001');
    // A different year restarts.
    expect(await num('invoice', 2027)).toBe('INV-2027-0001');
    // Prefixes per type.
    expect(await num('proforma', 2026)).toBe('PRO-2026-0001');
    expect(await num('receipt', 2026)).toBe('RCT-2026-0001');
  });

  it('rejects an unknown document type', async () => {
    await db.as(asStaff);
    await expect(db.pg.query(`select allocate_document_number('bogus', 2026)`)).rejects.toThrow(
      /invalid_document_type/,
    );
  });

  it('issues a draft: allocates its number, freezes the issuer, moves off draft', async () => {
    await db.as(asStaff);
    const id = await seedDraft(db, { type: 'invoice', issue_date: '2026-08-12' });
    const { rows } = await db.pg.query<{
      number: string;
      status: string;
      issuer_snapshot: unknown;
    }>(`select * from issue_document($1, $2::jsonb)`, [
      id,
      JSON.stringify({ legalName: 'Belle Mare Tours Ltd' }),
    ]);
    expect(rows[0]!.status).toBe('issued');
    expect(rows[0]!.number).toMatch(/^INV-2026-\d{4}$/);
    expect(rows[0]!.issuer_snapshot).toMatchObject({ legalName: 'Belle Mare Tours Ltd' });
  });

  it('refuses to issue an already-issued document', async () => {
    await db.as(asStaff);
    const id = await seedDraft(db);
    await db.pg.query(`select issue_document($1, '{}'::jsonb)`, [id]);
    await expect(db.pg.query(`select issue_document($1, '{}'::jsonb)`, [id])).rejects.toThrow(
      /document_already_issued/,
    );
  });

  it('converts a quote into a new invoice draft and marks the quote converted', async () => {
    await db.as(asStaff);
    const quoteId = await seedDraft(db, { type: 'quote' });
    const { rows } = await db.pg.query<{
      id: string;
      type: string;
      status: string;
      source_document_id: string;
    }>(`select * from convert_document($1)`, [quoteId]);
    expect(rows[0]!.type).toBe('invoice');
    expect(rows[0]!.status).toBe('draft');
    expect(rows[0]!.source_document_id).toBe(quoteId);

    const src = await db.pg.query<{ status: string }>(
      `select status from documents where id = $1`,
      [quoteId],
    );
    expect(src.rows[0]!.status).toBe('converted');
  });

  it('refuses to convert a non-quote', async () => {
    await db.as(asStaff);
    const id = await seedDraft(db, { type: 'invoice' });
    await expect(db.pg.query(`select convert_document($1)`, [id])).rejects.toThrow(/not_a_quote/);
  });

  it('voids an issued document but refuses to void a draft', async () => {
    await db.as(asStaff);
    const id = await seedDraft(db);
    await expect(db.pg.query(`select void_document($1)`, [id])).rejects.toThrow(
      /draft_not_voidable/,
    );
    await db.pg.query(`select issue_document($1, '{}'::jsonb)`, [id]);
    const { rows } = await db.pg.query<{ status: string }>(`select * from void_document($1)`, [id]);
    expect(rows[0]!.status).toBe('void');
  });

  it('locks a non-staff account out of the tables and the RPCs', async () => {
    // Seed a document as the owner so there is a row to (not) see.
    await db.asOwner();
    const id = await seedDraft(db);

    await db.as(asCustomer);
    const seen = await db.pg.query(`select id from documents where id = $1`, [id]);
    expect(seen.rows).toHaveLength(0); // RLS hides it
    await expect(db.pg.query(`select allocate_document_number('invoice', 2026)`)).rejects.toThrow(
      /forbidden/,
    );
    await expect(db.pg.query(`select issue_document($1, '{}'::jsonb)`, [id])).rejects.toThrow(
      /forbidden/,
    );

    // And an anonymous caller is blocked even harder: it has no table grant at all (the module is
    // staff-only, so anon was never granted `documents`), so the read is denied outright rather than
    // filtered to zero rows.
    await db.as(null);
    await expect(db.pg.query(`select id from documents where id = $1`, [id])).rejects.toThrow(
      /permission denied/,
    );
  });
});
