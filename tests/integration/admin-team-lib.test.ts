import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';
import { seedTeamRole } from '../db/team';
import { can } from '@/lib/admin/permissions';
import { loadCallerAccess, type AccessClient } from '@/lib/http/access';

const OWNER = 'aa000000-0000-0000-0000-000000000001';
const WORKER = 'aa000000-0000-0000-0000-000000000002';
const WRITER = 'aa000000-0000-0000-0000-000000000003';
const BARE = 'aa000000-0000-0000-0000-000000000004';

const hoisted = vi.hoisted(() => ({ shim: null as SupabaseShim | null }));
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => {
    if (!hoisted.shim) throw new Error('shim not initialised');
    return hoisted.shim;
  },
}));

let db: TestDb;
beforeAll(async () => {
  db = await createTestDb();
  await db.asOwner();
  const accounts: Array<readonly [id: string, email: string, role: string]> = [
    [OWNER, 'owner@example.com', 'admin'],
    [WORKER, 'worker@example.com', 'staff'],
    [WRITER, 'writer@example.com', 'seo'],
    [BARE, 'bare@example.com', 'staff'],
  ];
  for (const [id, email, role] of accounts) {
    // Confirmed: api_team_assign only matches a confirmed account by email.
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
  await seedTeamRole(db, WORKER, ['section.quotes']);
  await seedTeamRole(db, WRITER, ['section.blog'], 'content');
  hoisted.shim = makeSupabaseShim(db.pg);
});
afterAll(async () => db.close());

describe('loadCallerAccess (server, service-role reads)', () => {
  const access = (id: string) => {
    // Owner context = what the service-role client sees: every row, no RLS.
    return db.asOwner().then(() => loadCallerAccess(hoisted.shim as unknown as AccessClient, id));
  };

  it('the Owner can do everything', async () => {
    const a = await access(OWNER);
    expect(a.isOwner).toBe(true);
    expect(can(a, 'money.refunds')).toBe(true);
  });

  it('a team member gets their role', async () => {
    const a = await access(WORKER);
    expect(can(a, 'section.quotes')).toBe(true);
    expect(can(a, 'section.bookings')).toBe(false);
  });

  it('a content member never passes a guest-data gate', async () => {
    expect(can(await access(WRITER), 'section.quotes')).toBe(false);
  });

  it('fails closed for staff without a role and for an unknown user', async () => {
    expect((await access(BARE)).permissions.size).toBe(0);
    expect((await access('aa000000-0000-0000-0000-00000000ffff')).permissions.size).toBe(0);
  });

  it('grants nothing when the team role base does not match the profile role', async () => {
    // The database refuses to store this pairing, so build it with the profile guard switched off. The
    // server must then agree with has_permission() / api_my_access(): a role counts only while its
    // base matches (staff <-> team, seo <-> content).
    const STAFF_ON_CONTENT = 'aa000000-0000-0000-0000-000000000005';
    const SEO_ON_TEAM = 'aa000000-0000-0000-0000-000000000006';
    await db.asOwner();
    for (const [id, email] of [
      [STAFF_ON_CONTENT, 'mismatch-staff@example.com'],
      [SEO_ON_TEAM, 'mismatch-seo@example.com'],
    ] as const) {
      await db.pg.query(
        `insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())`,
        [id, email],
      );
      await db.pg.query(`insert into profiles (id, full_name, role) values ($1, $2, 'staff')`, [
        id,
        email.split('@')[0],
      ]);
    }
    await seedTeamRole(db, STAFF_ON_CONTENT, ['section.blog'], 'content');
    await seedTeamRole(db, SEO_ON_TEAM, ['section.quotes'], 'team');
    await db.pg.query(`alter table profiles disable trigger profiles_role_guard`);
    try {
      await db.pg.query(`update profiles set role = 'staff' where id = $1`, [STAFF_ON_CONTENT]);
      await db.pg.query(`update profiles set role = 'seo' where id = $1`, [SEO_ON_TEAM]);
    } finally {
      await db.pg.query(`alter table profiles enable trigger profiles_role_guard`);
    }

    expect((await access(STAFF_ON_CONTENT)).permissions.size).toBe(0);
    const seoOnTeam = await access(SEO_ON_TEAM);
    expect(seoOnTeam.permissions.size).toBe(0);
    expect(can(seoOnTeam, 'section.quotes')).toBe(false);
  });
});
