import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { seedTeamRole } from '../db/team';
import { ALL_PERMISSIONS, CONTENT_PERMISSIONS } from '@/lib/admin/permissions';

/**
 * Every database rule behind /admin/roles (20261025140000_admin_roles). Real Postgres: the RLS, the
 * triggers and the definer RPCs run exactly as in production. The rule that matters most is the one
 * the old schema got wrong — any is_staff() caller could change any profile's role, so a staff member
 * could make themselves admin.
 */

const OWNER = '0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a';
const OWNER2 = '0b0b0b0b-0b0b-0b0b-0b0b-0b0b0b0b0b0b';
const WORKER = '1a1a1a1a-1a1a-1a1a-1a1a-1a1a1a1a1a1a';
const WRITER = '2a2a2a2a-2a2a-2a2a-2a2a-2a2a2a2a2a2a';
const BARE = '3a3a3a3a-3a3a-3a3a-3a3a-3a3a3a3a3a3a';
const GUEST = '4a4a4a4a-4a4a-4a4a-4a4a-4a4a4a4a4a4a';

const PEOPLE: Array<[string, string, string]> = [
  [OWNER, 'owner@example.com', 'admin'],
  [WORKER, 'worker@example.com', 'staff'],
  [WRITER, 'writer@example.com', 'seo'],
  [BARE, 'bare@example.com', 'staff'],
  [GUEST, 'guest@example.com', 'customer'],
];

async function seedPeople(db: TestDb, people = PEOPLE): Promise<void> {
  await db.asOwner();
  for (const [id, email, role] of people) {
    await db.pg.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email]);
    await db.pg.query(`insert into profiles (id, full_name, role) values ($1, $2, $3::user_role)`, [
      id,
      email.split('@')[0],
      role,
    ]);
  }
}

const asUser = (db: TestDb, sub: string) => db.as({ sub, role: 'authenticated' });

/** The error message a statement raised, or '' when it succeeded. */
async function failure(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return '';
  } catch (e) {
    return (e as Error).message;
  }
}

async function one<T>(db: TestDb, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.pg.query<{ v: T }>(sql, params);
  return rows[0]!.v;
}

describe('the permission catalogue in SQL matches src/lib/admin/permissions.ts', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => db.close());

  it('permission_catalogue() lists exactly ALL_PERMISSIONS', async () => {
    const sql = await one<string[]>(db, `select permission_catalogue() as v`);
    expect([...sql].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('content_permission_catalogue() lists exactly CONTENT_PERMISSIONS', async () => {
    const sql = await one<string[]>(db, `select content_permission_catalogue() as v`);
    expect([...sql].sort()).toEqual([...CONTENT_PERMISSIONS].sort());
  });
});

describe('has_permission / is_admin', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    await seedPeople(db);
    await seedTeamRole(db, WORKER, ['section.bookings', 'money.prices']);
    await seedTeamRole(db, WRITER, ['section.blog'], 'content');
  });
  afterAll(async () => db.close());

  const has = (key: string) => one<boolean>(db, `select has_permission($1) as v`, [key]);

  it('the Owner holds every key and is_admin()', async () => {
    await asUser(db, OWNER);
    expect(await has('money.refunds')).toBe(true);
    expect(await one<boolean>(db, `select is_admin() as v`)).toBe(true);
  });

  it('a team member holds only their role’s keys', async () => {
    await asUser(db, WORKER);
    expect(await has('section.bookings')).toBe(true);
    expect(await has('money.prices')).toBe(true);
    expect(await has('money.refunds')).toBe(false);
    expect(await one<boolean>(db, `select is_admin() as v`)).toBe(false);
  });

  it('a content member holds their content keys', async () => {
    await asUser(db, WRITER);
    expect(await has('section.blog')).toBe(true);
    expect(await has('section.tours')).toBe(false);
  });

  it('fails closed for staff without a role, customers and anonymous callers', async () => {
    await asUser(db, BARE);
    expect(await has('section.bookings')).toBe(false);
    await asUser(db, GUEST);
    expect(await has('section.bookings')).toBe(false);
    await db.as(null);
    expect(await has('section.bookings')).toBe(false);
  });
});

describe('team_roles', () => {
  let db: TestDb;
  let workerRole: string;
  beforeAll(async () => {
    db = await createTestDb();
    await seedPeople(db);
    workerRole = await seedTeamRole(db, WORKER, ['section.quotes']);
  });
  afterAll(async () => db.close());

  const insertRole = (name: string, base: string, perms: string[]) =>
    db.pg.query<{ id: string; permissions: string[] }>(
      `insert into team_roles (name, base, permissions)
       values ($1, $2, (select coalesce(array_agg(k), '{}') from jsonb_array_elements_text($3::jsonb) k))
       returning id, permissions`,
      [name, base, JSON.stringify(perms)],
    );

  it('only the Owner may create a role', async () => {
    await asUser(db, WORKER);
    expect(await failure(insertRole('Sneaky', 'team', ['money.refunds']))).toMatch(
      /row-level security/,
    );
    await asUser(db, OWNER);
    const { rows } = await insertRole('  Reservations  ', 'team', [
      'section.quotes',
      'section.bookings',
      'section.quotes',
    ]);
    // Trimmed name, de-duplicated and sorted keys.
    const row = (
      await db.pg.query<{ name: string; permissions: string[] }>(
        `select name, permissions from team_roles where id = $1`,
        [rows[0]!.id],
      )
    ).rows[0]!;
    expect(row.name).toBe('Reservations');
    expect(row.permissions).toEqual(['section.bookings', 'section.quotes']);
  });

  it('refuses an unknown key and a duplicate name', async () => {
    await asUser(db, OWNER);
    expect(await failure(insertRole('Bad key', 'team', ['money.everything']))).toMatch(/check/i);
    await insertRole('Drivers', 'team', []);
    expect(await failure(insertRole('drivers ', 'team', []))).toMatch(/team_roles_name_key/);
  });

  it('a content-only role cannot hold a guest or money key', async () => {
    await asUser(db, OWNER);
    expect(await failure(insertRole('Writers+', 'content', ['section.bookings']))).toMatch(
      /content_role_permission/,
    );
    expect(await failure(insertRole('Writers$', 'content', ['money.reports']))).toMatch(
      /content_role_permission/,
    );
    expect(await failure(insertRole('Writers', 'content', ['section.blog']))).toBe('');
  });

  it('base access cannot change after creation', async () => {
    await asUser(db, OWNER);
    expect(
      await failure(
        db.pg.query(`update team_roles set base = 'content' where id = $1`, [workerRole]),
      ),
    ).toMatch(/team_role_base_immutable/);
  });

  it('a role with members cannot be deleted; an empty one can', async () => {
    await asUser(db, OWNER);
    expect(
      await failure(db.pg.query(`delete from team_roles where id = $1`, [workerRole])),
    ).toMatch(/team_role_id_fkey/);
    const { rows } = await insertRole('Temporary', 'team', []);
    expect(await failure(db.pg.query(`delete from team_roles where id = $1`, [rows[0]!.id]))).toBe(
      '',
    );
  });

  it('a member reads their own role only; anonymous callers have no privilege at all', async () => {
    await asUser(db, WORKER);
    const { rows } = await db.pg.query<{ id: string }>(`select id from team_roles`);
    expect(rows.map((r) => r.id)).toEqual([workerRole]);
    await db.asOwner();
    expect(
      await one<boolean>(
        db,
        `select has_table_privilege('anon', 'public.team_roles', 'select') as v`,
      ),
    ).toBe(false);
    expect(
      await one<boolean>(
        db,
        `select has_table_privilege('authenticated', 'public.team_roles', 'insert') as v`,
      ),
    ).toBe(true);
  });
});
