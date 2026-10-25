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
});
