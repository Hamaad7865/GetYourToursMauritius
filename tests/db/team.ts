import type { TestDb } from './pglite';
import type { PermissionKey } from '@/lib/admin/permissions';

/**
 * Give `userId` a team role holding exactly `permissions`, as the table owner (RLS bypassed), and set
 * the matching profiles.role ('staff' for a team role, 'seo' for a content one). The profile row must
 * already exist. Returns the new role's id. Leaves the session in the OWNER context — call db.as(...)
 * afterwards to act as someone.
 */
export async function seedTeamRole(
  db: TestDb,
  userId: string,
  permissions: readonly PermissionKey[],
  base: 'team' | 'content' = 'team',
): Promise<string> {
  await db.asOwner();
  const name = `Test role ${Math.random().toString(36).slice(2, 10)}`;
  const { rows } = await db.pg.query<{ id: string }>(
    `insert into team_roles (name, base, permissions)
     values ($1, $2, (select coalesce(array_agg(k), '{}') from jsonb_array_elements_text($3::jsonb) k))
     returning id`,
    [name, base, JSON.stringify(permissions)],
  );
  const id = rows[0]!.id;
  await db.pg.query(`update profiles set role = $2::user_role, team_role_id = $3 where id = $1`, [
    userId,
    base === 'content' ? 'seo' : 'staff',
    id,
  ]);
  return id;
}
