import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
const COLLEAGUE = '6a6a6a6a-6a6a-6a6a-6a6a-6a6a6a6a6a6a';
/** An auth account with no profile — the target of a re-key attempt. */
const SPARE = '7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a';

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

  it('an unknown or NULL key is false for everyone, the Owner included', async () => {
    await asUser(db, OWNER);
    expect(await has('money.refunds')).toBe(true);
    expect(await has('money.refund')).toBe(false); // typo
    expect(await one<boolean>(db, `select has_permission(null) as v`)).toBe(false);
  });

  it('a team role only counts while its base matches the profile’s role', async () => {
    // The profile guard (its pairing rule applies to every writer) refuses this slipped pairing, so
    // the setup switches that one trigger off — has_permission's own base check is the defence in
    // depth under test here, for the day a pairing gets past the guard anyway.
    await db.asOwner();
    await db.pg.exec(`alter table profiles disable trigger profiles_role_guard`);
    try {
      await db.pg.query(`update profiles set role = 'seo' where id = $1`, [WORKER]);
      await asUser(db, WORKER);
      expect(await has('section.bookings')).toBe(false);
    } finally {
      await db.asOwner();
      await db.pg.query(`update profiles set role = 'staff' where id = $1`, [WORKER]);
      await db.pg.exec(`alter table profiles enable trigger profiles_role_guard`);
    }
    await asUser(db, WORKER);
    expect(await has('section.bookings')).toBe(true);
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
    await seedPeople(db, [[OWNER2, 'owner2@example.com', 'admin']]);
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
    expect(await failure(insertRole('Bad key', 'team', ['money.everything']))).toMatch(
      /team_roles_permissions_check/,
    );
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
    // TRUNCATE bypasses RLS, so no API role may hold it.
    expect(
      await one<boolean>(
        db,
        `select has_table_privilege('authenticated', 'public.team_roles', 'truncate') as v`,
      ),
    ).toBe(false);
  });

  it('the migration revokes every default privilege before granting back', () => {
    // PGlite does not replicate Supabase's default table privileges (anon / authenticated get ALL on
    // a new table, TRUNCATE included), so a privilege query cannot fail here. Pin the statements.
    const sql = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261025140000_admin_roles.sql'),
      'utf8',
    );
    const revoke = sql.indexOf('revoke all on team_roles from public, anon, authenticated;');
    const grant = sql.indexOf(
      'grant select, insert, update, delete on team_roles to authenticated;',
    );
    expect(revoke).toBeGreaterThan(-1);
    expect(grant).toBeGreaterThan(-1);
    expect(revoke).toBeLessThan(grant);
  });

  it('the Owner reads every role', async () => {
    await db.asOwner();
    const all = (await db.pg.query<{ id: string }>(`select id from team_roles`)).rows.map(
      (r) => r.id,
    );
    expect(all.length).toBeGreaterThan(1);
    await asUser(db, OWNER);
    const seen = (await db.pg.query<{ id: string }>(`select id from team_roles`)).rows.map(
      (r) => r.id,
    );
    expect(seen.sort()).toEqual(all.sort());
  });

  it('a member cannot update or delete their own role', async () => {
    await asUser(db, WORKER);
    const upd = await db.pg.query(`update team_roles set description = 'mine' where id = $1`, [
      workerRole,
    ]);
    expect(upd.affectedRows).toBe(0);
    const del = await db.pg.query(`delete from team_roles where id = $1`, [workerRole]);
    expect(del.affectedRows).toBe(0);
    await db.asOwner();
    const row = (
      await db.pg.query<{ description: string | null; permissions: string[] }>(
        `select description, permissions from team_roles where id = $1`,
        [workerRole],
      )
    ).rows[0]!;
    expect(row.description).toBeNull();
    expect(row.permissions).toEqual(['section.quotes']);
  });

  it('erasing the editor’s profile nulls updated_by instead of leaving a dangling id', async () => {
    await asUser(db, OWNER);
    const { rows } = await insertRole('Audited', 'team', ['section.leads']);
    const roleId = rows[0]!.id;
    const editor = () =>
      one<string | null>(db, `select updated_by as v from team_roles where id = $1`, [roleId]);

    // A second Owner edits the role: they are stamped as the editor.
    await asUser(db, OWNER2);
    await db.pg.query(`update team_roles set description = 'edited' where id = $1`, [roleId]);
    expect(await editor()).toBe(OWNER2);

    // That Owner erases their own profile: the FK's SET NULL must stick (the trigger may not
    // write the dead id back).
    expect(await failure(db.pg.query(`delete from profiles where id = $1`, [OWNER2]))).toBe('');
    await db.asOwner();
    expect(await editor()).toBeNull();
  });
});

describe('the profile guard', () => {
  let db: TestDb;
  let workerRole: string;
  let writerRole: string;
  let colleagueRole: string;
  beforeAll(async () => {
    db = await createTestDb();
    await seedPeople(db, [
      ...PEOPLE,
      [OWNER2, 'owner2@example.com', 'customer'],
      [COLLEAGUE, 'colleague@example.com', 'staff'],
    ]);
    workerRole = await seedTeamRole(db, WORKER, ['section.bookings']);
    writerRole = await seedTeamRole(db, WRITER, ['section.blog'], 'content');
    colleagueRole = await seedTeamRole(db, COLLEAGUE, ['section.quotes', 'money.refunds']);
    await db.pg.query(`insert into auth.users (id, email) values ($1, 'spare@example.com')`, [
      SPARE,
    ]);
  });
  afterAll(async () => db.close());

  const roleOf = async (id: string) => {
    await db.asOwner();
    return (
      await db.pg.query<{ role: string; team_role_id: string | null }>(
        `select role::text as role, team_role_id from profiles where id = $1`,
        [id],
      )
    ).rows[0]!;
  };

  it('a staff member cannot make themselves admin', async () => {
    await asUser(db, WORKER);
    await db.pg.query(`update profiles set role = 'admin' where id = $1`, [WORKER]);
    expect((await roleOf(WORKER)).role).toBe('staff');
  });

  it('a staff member cannot change their own or anyone’s team role', async () => {
    await asUser(db, WORKER);
    await db.pg.query(`update profiles set team_role_id = null where id = $1`, [WORKER]);
    expect((await roleOf(WORKER)).team_role_id).toBe(workerRole);
    await asUser(db, WORKER);
    await db.pg.query(`update profiles set role = 'staff' where id = $1`, [GUEST]);
    expect((await roleOf(GUEST)).role).toBe('customer');
  });

  it('a content member cannot move themselves onto a team role', async () => {
    await asUser(db, WRITER);
    await db.pg.query(`update profiles set team_role_id = $2 where id = $1`, [WRITER, workerRole]);
    expect(await roleOf(WRITER)).toEqual({ role: 'seo', team_role_id: writerRole });
  });

  it('a customer cannot give themselves a role or a team role', async () => {
    await asUser(db, GUEST);
    await db.pg.query(`update profiles set role = 'staff', team_role_id = $2 where id = $1`, [
      GUEST,
      workerRole,
    ]);
    expect(await roleOf(GUEST)).toEqual({ role: 'customer', team_role_id: null });
  });

  it('staff without a role cannot assign themselves one', async () => {
    await asUser(db, BARE);
    await db.pg.query(`update profiles set team_role_id = $2 where id = $1`, [BARE, workerRole]);
    expect((await roleOf(BARE)).team_role_id).toBeNull();
  });

  it('staff cannot change a colleague’s team role either', async () => {
    await asUser(db, WORKER);
    await db.pg.query(`update profiles set team_role_id = null where id = $1`, [COLLEAGUE]);
    await asUser(db, WORKER);
    await db.pg.query(`update profiles set team_role_id = $2 where id = $1`, [
      COLLEAGUE,
      workerRole,
    ]);
    expect(await roleOf(COLLEAGUE)).toEqual({ role: 'staff', team_role_id: colleagueRole });
  });

  it('a PostgREST-style upsert cannot promote a staff member', async () => {
    await asUser(db, WORKER);
    await db.pg.query(
      `insert into profiles (id, role, team_role_id) values ($1, 'admin', null)
       on conflict (id) do update set role = excluded.role, team_role_id = excluded.team_role_id`,
      [WORKER],
    );
    expect(await roleOf(WORKER)).toEqual({ role: 'staff', team_role_id: workerRole });
  });

  const profileExists = async (id: string) => {
    await db.asOwner();
    return (await db.pg.query(`select 1 from profiles where id = $1`, [id])).rows.length === 1;
  };

  it('a profile cannot be re-keyed onto another account', async () => {
    await asUser(db, WORKER);
    expect(
      await failure(db.pg.query(`update profiles set id = $2 where id = $1`, [WORKER, SPARE])),
    ).toMatch(/profile_id_immutable/);
    expect(await profileExists(SPARE)).toBe(false);
    expect(await roleOf(WORKER)).toEqual({ role: 'staff', team_role_id: workerRole });
  });

  it('two staff members’ roles cannot be swapped by re-keying their rows', async () => {
    await asUser(db, WORKER);
    expect(
      await failure(
        db.pg.query(
          `update profiles set id = case when id = $1 then $3::uuid else $1::uuid end
           where id in ($1, $2)`,
          [WORKER, COLLEAGUE, SPARE],
        ),
      ),
    ).toMatch(/profile_id_immutable/);
    expect(await profileExists(SPARE)).toBe(false);
    expect(await roleOf(WORKER)).toEqual({ role: 'staff', team_role_id: workerRole });
    expect(await roleOf(COLLEAGUE)).toEqual({ role: 'staff', team_role_id: colleagueRole });
  });

  it('not even the table owner may re-key a profile', async () => {
    await db.asOwner();
    expect(
      await failure(db.pg.query(`update profiles set id = $2 where id = $1`, [GUEST, SPARE])),
    ).toMatch(/profile_id_immutable/);
    expect(await profileExists(SPARE)).toBe(false);
    expect(await profileExists(GUEST)).toBe(true);
  });

  it('a staff member cannot delete a profile or edit the Owner’s', async () => {
    await asUser(db, WORKER);
    const del = await db.pg.query(`delete from profiles where id = $1`, [GUEST]);
    expect(del.affectedRows).toBe(0);
    const upd = await db.pg.query(`update profiles set full_name = 'x' where id = $1`, [OWNER]);
    expect(upd.affectedRows).toBe(0);
  });

  it('a signed-up customer still cannot insert themselves as admin', async () => {
    const NEWBIE = '5a5a5a5a-5a5a-5a5a-5a5a-5a5a5a5a5a5a';
    await db.asOwner();
    await db.pg.query(`insert into auth.users (id) values ($1)`, [NEWBIE]);
    await asUser(db, NEWBIE);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'admin')`, [NEWBIE]);
    expect((await roleOf(NEWBIE)).role).toBe('customer');
  });

  it('a team role must match the profile’s base', async () => {
    await asUser(db, OWNER);
    expect(
      await failure(
        db.pg.query(`update profiles set role = 'admin', team_role_id = $2 where id = $1`, [
          GUEST,
          workerRole,
        ]),
      ),
    ).toMatch(/team_role_mismatch/);
    expect(
      await failure(
        db.pg.query(`update profiles set role = 'seo', team_role_id = $2 where id = $1`, [
          GUEST,
          workerRole,
        ]),
      ),
    ).toMatch(/team_role_mismatch/);
  });

  it('the last Owner cannot be demoted or deleted — not even by themselves', async () => {
    await asUser(db, OWNER);
    expect(
      await failure(db.pg.query(`update profiles set role = 'customer' where id = $1`, [OWNER])),
    ).toMatch(/last_owner/);
    await db.asOwner();
    expect(await failure(db.pg.query(`delete from profiles where id = $1`, [OWNER]))).toMatch(
      /last_owner/,
    );
  });

  it('with a second Owner, one may step down', async () => {
    await asUser(db, OWNER);
    await db.pg.query(`update profiles set role = 'admin' where id = $1`, [OWNER2]);
    expect((await roleOf(OWNER2)).role).toBe('admin');
    await asUser(db, OWNER2);
    await db.pg.query(`update profiles set role = 'customer' where id = $1`, [OWNER2]);
    expect((await roleOf(OWNER2)).role).toBe('customer');
  });
});

describe('erasing a profile through api_erase_user', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    await seedPeople(db, [
      ...PEOPLE,
      [OWNER2, 'owner2@example.com', 'admin'],
      [COLLEAGUE, 'colleague@example.com', 'staff'],
    ]);
    await seedTeamRole(db, WORKER, ['section.bookings']);
    await seedTeamRole(db, COLLEAGUE, ['section.quotes']);
    await seedTeamRole(db, WRITER, ['section.blog'], 'content');
  });
  afterAll(async () => db.close());

  const erase = (id: string) =>
    db.pg.query(`select api_erase_user($1::jsonb)`, [JSON.stringify({ userId: id })]);
  const profileExists = async (id: string) => {
    await db.asOwner();
    return (await db.pg.query(`select 1 from profiles where id = $1`, [id])).rows.length === 1;
  };

  // api_erase_user is SECURITY DEFINER and open to any is_staff() caller, so it deletes as the table
  // owner and skips the Owner-only delete policy: the delete trigger has to hold the line.
  it('staff cannot erase a co-Owner or a team member', async () => {
    await asUser(db, WORKER);
    expect(await failure(erase(OWNER2))).toMatch(/forbidden/);
    await asUser(db, WORKER);
    expect(await failure(erase(COLLEAGUE))).toMatch(/forbidden/);
    await asUser(db, WORKER);
    expect(await failure(erase(WRITER))).toMatch(/forbidden/);
    expect(await profileExists(OWNER2)).toBe(true);
    expect(await profileExists(COLLEAGUE)).toBe(true);
    expect(await profileExists(WRITER)).toBe(true);
  });

  it('staff can still erase a customer (GDPR)', async () => {
    await asUser(db, WORKER);
    expect(await failure(erase(GUEST))).toBe('');
    expect(await profileExists(GUEST)).toBe(false);
  });

  it('a member can erase their own account', async () => {
    await asUser(db, WRITER);
    expect(await failure(erase(WRITER))).toBe('');
    expect(await profileExists(WRITER)).toBe(false);
  });

  it('an Owner can erase a team member, but never the last Owner', async () => {
    await asUser(db, OWNER);
    expect(await failure(erase(COLLEAGUE))).toBe('');
    expect(await profileExists(COLLEAGUE)).toBe(false);
    await asUser(db, OWNER);
    expect(await failure(erase(OWNER2))).toBe('');
    await asUser(db, OWNER);
    expect(await failure(erase(OWNER))).toMatch(/last_owner/);
    expect(await profileExists(OWNER)).toBe(true);
  });
});

describe('team RPCs', () => {
  let db: TestDb;
  let reservations: string;
  let content: string;
  beforeAll(async () => {
    db = await createTestDb();
    await seedPeople(db);
    reservations = await seedTeamRole(db, WORKER, ['section.bookings', 'section.quotes']);
    content = await seedTeamRole(db, WRITER, ['section.blog'], 'content');
  });
  afterAll(async () => db.close());

  const call = <T>(fn: string, p: unknown) =>
    one<T>(db, `select ${fn}($1::jsonb) as v`, [JSON.stringify(p)]);

  it('api_my_access describes the caller', async () => {
    await asUser(db, OWNER);
    const owner = await call<{ role: string; permissions: string[] }>('api_my_access', {});
    expect(owner.role).toBe('admin');
    expect([...owner.permissions].sort()).toEqual([...ALL_PERMISSIONS].sort());

    await asUser(db, WORKER);
    const worker = await call<{ role: string; teamRoleId: string; permissions: string[] }>(
      'api_my_access',
      {},
    );
    expect(worker).toMatchObject({ role: 'staff', teamRoleId: reservations });
    expect(worker.permissions).toEqual(['section.bookings', 'section.quotes']);

    await asUser(db, GUEST);
    expect((await call<{ permissions: string[] }>('api_my_access', {})).permissions).toEqual([]);
  });

  it('api_team_list is Owner-only and lists everyone but customers, with email', async () => {
    await asUser(db, WORKER);
    expect(await failure(call('api_team_list', {}))).toMatch(/forbidden/);
    await asUser(db, OWNER);
    const team = await call<Array<{ userId: string; email: string; role: string }>>(
      'api_team_list',
      {},
    );
    expect(team.map((m) => m.userId).sort()).toEqual([OWNER, WORKER, WRITER, BARE].sort());
    expect(team[0]!.role).toBe('admin'); // Owners first
    expect(team.find((m) => m.userId === WORKER)!.email).toBe('worker@example.com');
  });

  it('api_team_assign puts an account into a role by email, and sets the matching base', async () => {
    await asUser(db, OWNER);
    await call('api_team_assign', { email: 'GUEST@example.com ', teamRoleId: reservations });
    await db.asOwner();
    let p = (
      await db.pg.query<{ role: string; team_role_id: string }>(
        `select role::text as role, team_role_id from profiles where id = $1`,
        [GUEST],
      )
    ).rows[0]!;
    expect(p).toEqual({ role: 'staff', team_role_id: reservations });

    await asUser(db, OWNER);
    await call('api_team_assign', { userId: GUEST, teamRoleId: content });
    await db.asOwner();
    p = (
      await db.pg.query<{ role: string; team_role_id: string }>(
        `select role::text as role, team_role_id from profiles where id = $1`,
        [GUEST],
      )
    ).rows[0]!;
    expect(p).toEqual({ role: 'seo', team_role_id: content });
  });

  it('api_team_assign can make an Owner, and refuses bad input', async () => {
    await asUser(db, OWNER);
    await call('api_team_assign', { userId: BARE, teamRoleId: 'owner' });
    await db.asOwner();
    expect(
      await one<string>(db, `select role::text as v from profiles where id = $1`, [BARE]),
    ).toBe('admin');
    await asUser(db, OWNER);
    expect(
      await failure(call('api_team_assign', { email: 'nobody@example.com', teamRoleId: content })),
    ).toMatch(/not_found/);
    expect(
      await failure(call('api_team_assign', { userId: GUEST, teamRoleId: 'not-a-role' })),
    ).toMatch(/team_role_not_found/);
    await asUser(db, WORKER);
    expect(await failure(call('api_team_assign', { userId: WORKER, teamRoleId: 'owner' }))).toMatch(
      /forbidden/,
    );
  });

  it('api_team_remove turns a member back into a customer, but never the last Owner', async () => {
    await asUser(db, OWNER);
    await call('api_team_remove', { userId: WRITER });
    await db.asOwner();
    expect(
      await one<string>(db, `select role::text as v from profiles where id = $1`, [WRITER]),
    ).toBe('customer');
    // BARE became a second Owner above; remove them, then try the last one.
    await asUser(db, OWNER);
    await call('api_team_remove', { userId: BARE });
    expect(await failure(call('api_team_remove', { userId: OWNER }))).toMatch(/last_owner/);
    expect(
      await failure(call('api_team_remove', { userId: '9f9f9f9f-9f9f-9f9f-9f9f-9f9f9f9f9f9f' })),
    ).toMatch(/not_found/);
  });

  it('anonymous callers cannot execute any of them', async () => {
    await db.asOwner();
    for (const fn of ['api_my_access', 'api_team_list', 'api_team_assign', 'api_team_remove']) {
      expect(
        await one<boolean>(db, `select has_function_privilege('anon', $1, 'execute') as v`, [
          `public.${fn}(jsonb)`,
        ]),
        fn,
      ).toBe(false);
    }
  });
});
