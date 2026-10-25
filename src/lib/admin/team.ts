import { getBrowserSupabase } from '@/lib/supabase/browser';
import {
  buildAccess,
  isPermissionKey,
  type AdminAccess,
  type PermissionKey,
  type RoleBase,
} from '@/lib/admin/permissions';

/** One owner-defined role, as the Roles screen shows it. */
export interface TeamRole {
  id: string;
  name: string;
  description: string | null;
  base: RoleBase;
  permissions: PermissionKey[];
}

/** Someone in the back office (any non-customer profile). */
export interface TeamMember {
  userId: string;
  fullName: string | null;
  email: string | null;
  role: string;
  teamRoleId: string | null;
  teamRoleName: string | null;
}

export interface RoleInput {
  id: string | null;
  name: string;
  description: string;
  base: RoleBase;
  permissions: readonly PermissionKey[];
}

/**
 * Database refusals → sentences for the owner. A supabase-js error is a PLAIN OBJECT (not an Error), so
 * the raw message is matched here. Longer codes first: 'team_role_not_found' contains 'not_found'.
 */
const TEAM_ERRORS: Array<[string, string]> = [
  ['team_role_not_found', 'That role no longer exists — reload the page.'],
  ['team_role_mismatch', 'That role doesn’t fit this account.'],
  [
    'team_role_base_immutable',
    'Base access can’t change once a role exists. Create a new role instead.',
  ],
  [
    'content_role_permission',
    'A content-only role can only open Tours, Places, SEO, Blog and Redirects.',
  ],
  ['team_roles_name_key', 'A role with that name already exists.'],
  ['team_role_id_fkey', 'People still have this role. Move them to another role first.'],
  ['last_owner', 'There must always be at least one Owner. Make someone else Owner first.'],
  [
    'not_confirmed',
    'That account hasn’t confirmed its email yet. Ask them to click the link in their sign-up email, then add them.',
  ],
  [
    'ambiguous_email',
    'More than one account uses that email, so it can’t be added by email. Ask the developer to sort it out.',
  ],
  ['invalid_request', 'Something was missing from that request — reload the page and try again.'],
  [
    'not_found',
    'No account with that email. Ask them to sign up on the website first, then add them.',
  ],
  ['forbidden', 'Only the owner can do that.'],
];

export function teamErrorMessage(raw: string, fallback: string): string {
  return TEAM_ERRORS.find(([code]) => raw.includes(code))?.[1] ?? fallback;
}

function fail(error: { message?: string } | null, fallback: string): Error {
  return new Error(teamErrorMessage(error?.message ?? '', fallback));
}

/** The signed-in person's access (api_my_access). */
export async function loadMyAccess(): Promise<AdminAccess> {
  const { data, error } = await getBrowserSupabase().rpc('api_my_access', { p: {} });
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as {
    role?: string | null;
    teamRoleId?: string | null;
    teamRoleName?: string | null;
    permissions?: string[] | null;
  };
  return buildAccess({
    role: d.role ?? null,
    teamRoleId: d.teamRoleId ?? null,
    teamRoleName: d.teamRoleName ?? null,
    permissions: d.permissions ?? [],
  });
}

export async function loadRoles(): Promise<TeamRole[]> {
  const { data, error } = await getBrowserSupabase()
    .from('team_roles')
    .select('id, name, description, base, permissions')
    .order('name');
  if (error) throw fail(error, 'Could not load roles.');
  return (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    base: r.base === 'content' ? 'content' : 'team',
    permissions: (r.permissions ?? []).filter(isPermissionKey),
  }));
}

/** Create (id null) or update a role; returns its id. `base` is only sent on create. */
export async function saveRole(input: RoleInput): Promise<string> {
  const sb = getBrowserSupabase();
  const row = {
    name: input.name.trim(),
    description: input.description.trim() || null,
    permissions: [...input.permissions],
  };
  if (input.id) {
    const { error } = await sb.from('team_roles').update(row).eq('id', input.id);
    if (error) throw fail(error, 'Could not save the role.');
    return input.id;
  }
  const { data, error } = await sb
    .from('team_roles')
    .insert({ ...row, base: input.base })
    .select('id')
    .single();
  if (error) throw fail(error, 'Could not create the role.');
  return data.id;
}

export async function deleteRole(id: string): Promise<void> {
  const { error } = await getBrowserSupabase().from('team_roles').delete().eq('id', id);
  if (error) throw fail(error, 'Could not delete the role.');
}

export async function loadTeam(): Promise<TeamMember[]> {
  const { data, error } = await getBrowserSupabase().rpc('api_team_list', { p: {} });
  if (error) throw fail(error, 'Could not load the team.');
  return ((data ?? []) as unknown as TeamMember[]).map((m) => ({
    userId: m.userId,
    fullName: m.fullName ?? null,
    email: m.email ?? null,
    role: m.role,
    teamRoleId: m.teamRoleId ?? null,
    teamRoleName: m.teamRoleName ?? null,
  }));
}

/** Put an account into a role — `target` is a team role id, or 'owner'. */
export async function assignMember(
  who: { email?: string; userId?: string },
  target: string,
): Promise<void> {
  const { error } = await getBrowserSupabase().rpc('api_team_assign', {
    p: { ...who, teamRoleId: target },
  });
  if (error) throw fail(error, 'Could not change their role.');
}

export async function removeMember(userId: string): Promise<void> {
  const { error } = await getBrowserSupabase().rpc('api_team_remove', { p: { userId } });
  if (error) throw fail(error, 'Could not remove them.');
}
