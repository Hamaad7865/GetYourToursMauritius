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
    await db.pg.query(
      `insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`,
      [id, email],
    );
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

  // The seeded people (OWNER, WORKER, WRITER, BARE, GUEST) are only ever READ by these tests. Anything a
  // test changes it changes on an account of its own, made here and removed again by `forget`, so the
  // tests do not depend on each other's order — and OWNER is the sole Owner whenever a test starts.
  let seq = 0;
  async function addPerson(
    opts: {
      email?: string;
      name?: string;
      role?: string;
      confirmed?: boolean;
      profile?: boolean;
    } = {},
  ): Promise<string> {
    seq += 1;
    const id = `8a000000-0000-4000-8000-${String(seq).padStart(12, '0')}`;
    await db.asOwner();
    await db.pg.query(
      `insert into auth.users (id, email, email_confirmed_at)
       values ($1, $2, case when $3::boolean then now() end)`,
      [id, opts.email ?? `person${seq}@example.com`, opts.confirmed ?? true],
    );
    if (opts.profile ?? true) {
      await db.pg.query(
        `insert into profiles (id, full_name, role) values ($1, $2, $3::user_role)`,
        [id, opts.name ?? `person${seq}`, opts.role ?? 'customer'],
      );
    }
    return id;
  }
  async function forget(...ids: string[]): Promise<void> {
    await db.asOwner();
    for (const id of ids) {
      await db.pg.query(`delete from profiles where id = $1`, [id]);
      await db.pg.query(`delete from auth.users where id = $1`, [id]);
    }
  }
  async function profileOf(
    id: string,
  ): Promise<{ role: string; team_role_id: string | null } | undefined> {
    await db.asOwner();
    return (
      await db.pg.query<{ role: string; team_role_id: string | null }>(
        `select role::text as role, team_role_id from profiles where id = $1`,
        [id],
      )
    ).rows[0];
  }

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

  it('api_my_access answers an account with no profile with nothing, not an error', async () => {
    const ghost = await addPerson({ profile: false });
    try {
      await asUser(db, ghost);
      expect(await call('api_my_access', {})).toEqual({
        role: null,
        teamRoleId: null,
        teamRoleName: null,
        base: null,
        permissions: [],
      });
    } finally {
      await forget(ghost);
    }
  });

  it('every Owner-only RPC refuses a staff, a content and a customer caller', async () => {
    const bystander = await addPerson({ role: 'customer' });
    try {
      for (const [who, caller] of [
        ['staff', WORKER],
        ['seo', WRITER],
        ['customer', GUEST],
      ] as const) {
        await asUser(db, caller);
        expect(await failure(call('api_team_list', {})), `list as ${who}`).toMatch(/forbidden/);
        await asUser(db, caller);
        expect(
          await failure(call('api_team_assign', { userId: bystander, teamRoleId: reservations })),
          `assign as ${who}`,
        ).toMatch(/forbidden/);
        await asUser(db, caller);
        // The escalation itself: asking to become an Owner.
        expect(
          await failure(call('api_team_assign', { userId: caller, teamRoleId: 'owner' })),
          `self-promote as ${who}`,
        ).toMatch(/forbidden/);
        await asUser(db, caller);
        expect(
          await failure(call('api_team_remove', { userId: bystander })),
          `remove as ${who}`,
        ).toMatch(/forbidden/);
      }
      // Refused means untouched.
      expect((await profileOf(bystander))!.role).toBe('customer');
      expect((await profileOf(WORKER))!.role).toBe('staff');
      expect((await profileOf(WRITER))!.role).toBe('seo');
      expect((await profileOf(GUEST))!.role).toBe('customer');
    } finally {
      await forget(bystander);
    }
  });

  it('api_team_list lists everyone but customers, with their email', async () => {
    await asUser(db, OWNER);
    const team = await call<Array<{ userId: string; email: string; role: string }>>(
      'api_team_list',
      {},
    );
    const ids = team.map((m) => m.userId);
    expect(ids).toEqual(expect.arrayContaining([OWNER, WORKER, WRITER, BARE]));
    expect(ids).not.toContain(GUEST);
    expect(team.every((m) => m.role !== 'customer')).toBe(true);
    expect(team.find((m) => m.userId === WORKER)!.email).toBe('worker@example.com');
  });

  it('api_team_list puts every Owner before every non-Owner, whatever their names', async () => {
    // Names chosen so a plain alphabetical sort would interleave them: 'aaa' < 'worker' < 'zzz'.
    const aaaStaff = await addPerson({ name: 'aaa-staff', role: 'staff' });
    const zzzOwner = await addPerson({ name: 'zzz-owner', role: 'admin' });
    try {
      await asUser(db, OWNER);
      const team = await call<Array<{ userId: string; role: string }>>('api_team_list', {});
      const ids = team.map((m) => m.userId);
      expect(ids).toEqual(expect.arrayContaining([OWNER, zzzOwner, aaaStaff, WORKER]));
      const firstNonOwner = team.findIndex((m) => m.role !== 'admin');
      expect(firstNonOwner).toBeGreaterThan(1); // at least the two Owners come before it
      expect(team.slice(firstNonOwner).every((m) => m.role !== 'admin')).toBe(true);
      expect(team.slice(0, firstNonOwner).map((m) => m.userId)).toEqual(
        expect.arrayContaining([OWNER, zzzOwner]),
      );
    } finally {
      await forget(aaaStaff, zzzOwner);
    }
  });

  it('api_team_assign puts an account into a role by email, and sets the matching base', async () => {
    const casey = await addPerson({ email: 'Casey.Mixed@Example.com' });
    try {
      await asUser(db, OWNER);
      await call('api_team_assign', {
        email: ' casey.mixed@EXAMPLE.com ',
        teamRoleId: reservations,
      });
      expect(await profileOf(casey)).toEqual({ role: 'staff', team_role_id: reservations });

      // By userId instead — an upper-case uuid is the same uuid — onto a content role.
      await asUser(db, OWNER);
      await call('api_team_assign', { userId: casey.toUpperCase(), teamRoleId: content });
      expect(await profileOf(casey)).toEqual({ role: 'seo', team_role_id: content });
    } finally {
      await forget(casey);
    }
  });

  it('api_team_assign: when both userId and email are given, userId wins', async () => {
    const named = await addPerson();
    const other = await addPerson({ email: 'other.holder@example.com' });
    try {
      await asUser(db, OWNER);
      await call('api_team_assign', {
        userId: named,
        email: 'other.holder@example.com',
        teamRoleId: reservations,
      });
      expect((await profileOf(named))!.role).toBe('staff');
      expect((await profileOf(other))!.role).toBe('customer');
    } finally {
      await forget(named, other);
    }
  });

  it('api_team_assign by email refuses an account that has not confirmed it', async () => {
    const stranger = await addPerson({ email: 'unconfirmed@example.com', confirmed: false });
    try {
      await asUser(db, OWNER);
      expect(
        await failure(
          call('api_team_assign', { email: 'Unconfirmed@Example.com', teamRoleId: 'owner' }),
        ),
      ).toMatch(/not_confirmed/);
      expect((await profileOf(stranger))!.role).toBe('customer');
    } finally {
      await forget(stranger);
    }
  });

  it('api_team_assign by email refuses an address held by more than one account', async () => {
    const first = await addPerson({ email: 'twin@example.com' });
    const second = await addPerson({ email: '  TWIN@example.com' }); // differs by case and spaces only
    const lone = await addPerson({ email: 'half@example.com' });
    const halfUnconfirmed = await addPerson({ email: 'HALF@example.com', confirmed: false });
    try {
      await asUser(db, OWNER);
      expect(
        await failure(
          call('api_team_assign', { email: 'twin@example.com', teamRoleId: reservations }),
        ),
      ).toMatch(/ambiguous_email/);
      // An unconfirmed twin still makes the address ambiguous: the confirmed one is not "the" owner.
      await asUser(db, OWNER);
      expect(
        await failure(
          call('api_team_assign', { email: 'half@example.com', teamRoleId: reservations }),
        ),
      ).toMatch(/ambiguous_email/);
      for (const id of [first, second, lone, halfUnconfirmed]) {
        expect((await profileOf(id))!.role, id).toBe('customer');
      }
    } finally {
      await forget(first, second, lone, halfUnconfirmed);
    }
  });

  it('api_team_assign can make an Owner', async () => {
    const heir = await addPerson();
    try {
      await asUser(db, OWNER);
      await call('api_team_assign', { userId: heir, teamRoleId: 'owner' });
      expect(await profileOf(heir)).toEqual({ role: 'admin', team_role_id: null });
    } finally {
      await forget(heir);
    }
  });

  it('api_team_assign creates the profile when the account has none yet', async () => {
    const fresh = await addPerson({ profile: false });
    try {
      expect(await profileOf(fresh)).toBeUndefined();
      await asUser(db, OWNER);
      await call('api_team_assign', { userId: fresh, teamRoleId: reservations });
      expect(await profileOf(fresh)).toEqual({ role: 'staff', team_role_id: reservations });
    } finally {
      await forget(fresh);
    }
  });

  it('api_team_assign refuses unknown targets and malformed input', async () => {
    const target = await addPerson();
    const missing = '9f9f9f9f-9f9f-4f9f-9f9f-9f9f9f9f9f9f';
    try {
      await asUser(db, OWNER);
      const refused = async (p: Record<string, unknown>) => failure(call('api_team_assign', p));
      expect(await refused({ email: 'nobody@example.com', teamRoleId: content })).toMatch(
        /not_found/,
      );
      expect(await refused({ userId: missing, teamRoleId: content })).toMatch(/not_found/);
      expect(await refused({ userId: target, teamRoleId: 'not-a-role' })).toMatch(
        /team_role_not_found/,
      );
      expect(await refused({ userId: target, teamRoleId: missing })).toMatch(/team_role_not_found/);
      expect(await refused({ userId: target })).toMatch(/invalid_request/); // no teamRoleId
      expect(await refused({ teamRoleId: content })).toMatch(/invalid_request/); // no one named
      expect(await refused({ email: '   ', teamRoleId: content })).toMatch(/invalid_request/);
      expect(await refused({ userId: 'not-a-uuid', teamRoleId: content })).toMatch(
        /invalid_request/,
      );
      expect((await profileOf(target))!.role).toBe('customer');
    } finally {
      await forget(target);
    }
  });

  it('api_team_assign never lets the only Owner step down — not even to a team role', async () => {
    await asUser(db, OWNER);
    expect(
      await failure(call('api_team_assign', { userId: OWNER, teamRoleId: reservations })),
    ).toMatch(/last_owner/);
    expect((await profileOf(OWNER))!.role).toBe('admin');
  });

  it('api_team_remove turns a member back into a customer', async () => {
    const member = await addPerson();
    const writer = await addPerson();
    try {
      await asUser(db, OWNER);
      await call('api_team_assign', { userId: member, teamRoleId: reservations });
      await call('api_team_assign', { userId: writer, teamRoleId: content });
      expect((await profileOf(writer))!.role).toBe('seo');

      await asUser(db, OWNER);
      await call('api_team_remove', { userId: member });
      await call('api_team_remove', { userId: writer.toUpperCase() });
      expect(await profileOf(member)).toEqual({ role: 'customer', team_role_id: null });
      expect(await profileOf(writer)).toEqual({ role: 'customer', team_role_id: null });
    } finally {
      await forget(member, writer);
    }
  });

  it('api_team_remove never removes the last Owner, but may remove a second one', async () => {
    const second = await addPerson({ role: 'admin' });
    try {
      await asUser(db, OWNER);
      await call('api_team_remove', { userId: second });
      expect((await profileOf(second))!.role).toBe('customer');
      await asUser(db, OWNER);
      expect(await failure(call('api_team_remove', { userId: OWNER }))).toMatch(/last_owner/);
      expect((await profileOf(OWNER))!.role).toBe('admin');
    } finally {
      await forget(second);
    }
  });

  it('api_team_remove refuses a missing, malformed or unknown userId', async () => {
    await asUser(db, OWNER);
    expect(await failure(call('api_team_remove', {}))).toMatch(/invalid_request/);
    expect(await failure(call('api_team_remove', { userId: '  ' }))).toMatch(/invalid_request/);
    expect(await failure(call('api_team_remove', { userId: 'not-a-uuid' }))).toMatch(
      /invalid_request/,
    );
    expect(
      await failure(call('api_team_remove', { userId: '9f9f9f9f-9f9f-4f9f-9f9f-9f9f9f9f9f9f' })),
    ).toMatch(/not_found/);
  });

  it('anonymous callers cannot execute any of them; signed-in ones can', async () => {
    await db.asOwner();
    for (const fn of ['api_my_access', 'api_team_list', 'api_team_assign', 'api_team_remove']) {
      for (const [role, expected] of [
        ['anon', false],
        ['authenticated', true],
      ] as const) {
        expect(
          await one<boolean>(db, `select has_function_privilege($1, $2, 'execute') as v`, [
            role,
            `public.${fn}(jsonb)`,
          ]),
          `${role} ${fn}`,
        ).toBe(expected);
      }
    }
  });
});

describe('money locks', () => {
  let db: TestDb;
  const PRICER = '6a6a6a6a-6a6a-6a6a-6a6a-6a6a6a6a6a6a';
  const CASHIER = '7a7a7a7a-7a7a-7a7a-7a7a-7a7a7a7a7a7a';
  let optionId: string;

  beforeAll(async () => {
    db = await createTestDb();
    await seedPeople(db, [
      ...PEOPLE,
      [PRICER, 'pricer@example.com', 'staff'],
      [CASHIER, 'cashier@example.com', 'staff'],
    ]);
    await seedTeamRole(db, WORKER, ['section.tours', 'section.rental']);
    await seedTeamRole(db, PRICER, ['section.tours', 'money.prices']);
    await seedTeamRole(db, CASHIER, ['money.currency']);
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const activityId = await one<string>(
      db,
      `insert into activities (operator_id, slug, title, category, status)
       select id, 'lock-test', 'Lock test', 'Island tours', 'draft' from operators limit 1
       returning id as v`,
    );
    optionId = await one<string>(
      db,
      `insert into activity_options
         (activity_id, name, position, private_base_minor, private_included, private_extra_minor, private_max_guests)
       values ($1, 'Private', 0, 20000, 4, 3000, 8) returning id as v`,
      [activityId],
    );
  });
  afterAll(async () => db.close());

  it('a price-only table: refused without money.prices, allowed with it', async () => {
    await asUser(db, WORKER);
    expect(
      await failure(
        db.pg.query(
          `insert into activity_option_prices (activity_option_id, label, amount_minor, position)
           values ($1, 'Adult', 5000, 0)`,
          [optionId],
        ),
      ),
    ).toMatch(/row-level security/);
    const upd = await db.pg.query(`update transport_band_pricing set sedan_minor = 1`);
    expect(upd.affectedRows).toBe(0);

    await asUser(db, PRICER);
    expect(
      await failure(
        db.pg.query(
          `insert into activity_option_prices (activity_option_id, label, amount_minor, position)
           values ($1, 'Adult', 5000, 0)`,
          [optionId],
        ),
      ),
    ).toBe('');
  });

  it('a mixed table: other columns stay editable, a changed price is refused', async () => {
    await asUser(db, WORKER);
    expect(
      await failure(
        db.pg.query(`update activity_options set name = 'Private trip' where id = $1`, [optionId]),
      ),
    ).toBe('');
    // An unchanged re-save of the price columns passes (the tour editor sends them back as loaded).
    expect(
      await failure(
        db.pg.query(
          `update activity_options set private_base_minor = 20000, private_extra_minor = 3000 where id = $1`,
          [optionId],
        ),
      ),
    ).toBe('');
    expect(
      await failure(
        db.pg.query(`update activity_options set private_base_minor = 1 where id = $1`, [optionId]),
      ),
    ).toMatch(/forbidden/);
    expect(
      await failure(
        db.pg.query(`update activity_options set private_included = 8 where id = $1`, [optionId]),
      ),
    ).toMatch(/forbidden/);

    await asUser(db, PRICER);
    expect(
      await failure(
        db.pg.query(`update activity_options set private_base_minor = 25000 where id = $1`, [
          optionId,
        ]),
      ),
    ).toBe('');
  });

  it('rental: a new priced vehicle needs money.prices', async () => {
    await asUser(db, WORKER);
    expect(
      await failure(
        db.pg.query(
          `insert into rental_vehicles (slug, name, daily_rate_minor) values ('lock-car', 'Lock car', 3600)`,
        ),
      ),
    ).toMatch(/forbidden/);
  });

  it('business_settings: WhatsApp stays editable, the rate needs money.currency', async () => {
    await asUser(db, WORKER);
    expect(
      await failure(db.pg.query(`update business_settings set whatsapp_number = '+230 5772 9919'`)),
    ).toBe('');
    expect(await failure(db.pg.query(`update business_settings set eur_mur_rate = 51`))).toMatch(
      /forbidden/,
    );
    await asUser(db, CASHIER);
    // CASHIER is staff (is_staff() passes the row policy) and holds money.currency.
    expect(await failure(db.pg.query(`update business_settings set eur_mur_rate = 51`))).toBe('');
  });

  it('the Owner and the service role are never blocked', async () => {
    await asUser(db, OWNER);
    expect(
      await failure(
        db.pg.query(`update activity_options set private_base_minor = 30000 where id = $1`, [
          optionId,
        ]),
      ),
    ).toBe('');
    // The harness has no Supabase default table privileges, so a table created after the first RLS
    // migration gives service_role SELECT only. Production has the full set; mirror it here so the
    // trigger — not a missing grant — is what is being tested.
    await db.asOwner();
    await db.pg.query(`grant update on business_settings to service_role`);
    await db.as({ role: 'service_role' });
    expect(
      await failure(
        db.pg.query(`update activity_options set private_base_minor = 31000 where id = $1`, [
          optionId,
        ]),
      ),
    ).toBe('');
    expect(await failure(db.pg.query(`update business_settings set charge_currency = 'EUR'`))).toBe(
      '',
    );
  });

  it('every guarded column and permission named in a money-guard trigger really exists', async () => {
    // A misspelt column in TG_ARGV would silently guard nothing (old and new are both null).
    await db.asOwner();
    const { rows } = await db.pg.query<{ tbl: string; args: string[] }>(
      `select tgrelid::regclass::text as tbl,
              string_to_array(encode(tgargs, 'escape'), '\\000') as args
         from pg_trigger
        where tgname like '%\\_money\\_guard' and not tgisinternal
        order by 1`,
    );
    expect(rows.map((r) => r.tbl)).toEqual([
      'activities',
      'activity_options',
      'business_settings',
      'rental_vehicles',
    ]);
    const catalogue = await one<string[]>(db, `select permission_catalogue() as v`);
    for (const { tbl, args } of rows) {
      const [perm, ...columns] = args.filter(Boolean); // tgargs ends with a trailing NUL
      expect(catalogue, `${tbl}: permission ${perm}`).toContain(perm);
      expect(columns.length, `${tbl}: guarded columns`).toBeGreaterThan(0);
      for (const col of columns) {
        const hit = await db.pg.query(
          `select 1 from pg_attribute
            where attrelid = $1::regclass and attname = $2 and attnum > 0 and not attisdropped`,
          [tbl, col],
        );
        expect(hit.rows.length, `${tbl}.${col}`).toBe(1);
      }
    }
  });
});
