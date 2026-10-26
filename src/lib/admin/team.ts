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

/** A refusal rule: the database's code or constraint name, and the sentence the owner reads. */
type ErrorRule = readonly [code: string, message: string];

/**
 * Database refusals → sentences for the owner. A supabase-js error is a PLAIN OBJECT (not an Error), so
 * the raw message is matched here. Each code matches as a whole identifier (word boundaries), so the
 * bare 'forbidden' does not fire on 'forbidden_booking_status_transition'. Longer codes first anyway:
 * 'team_role_not_found' contains 'not_found'. Constraint names are written in full.
 */
const TEAM_ERRORS: readonly ErrorRule[] = [
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
  ['team_roles_name_check', 'A role name needs 1–60 characters.'],
  ['team_roles_description_check', 'Keep the description under 300 characters.'],
  ['team_roles_permissions_check', 'That permission isn’t recognised — reload the page.'],
  ['profiles_team_role_id_fkey', 'People still have this role. Move them to another role first.'],
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
  ['row-level security', 'Only the owner can do that.'],
];

/** `not_found` when the caller named an account by id (not an email): the row went away. */
const NO_SUCH_PERSON: readonly ErrorRule[] = [
  ['not_found', 'That person no longer has an account — reload the page.'],
];

function mentions(raw: string, code: string): boolean {
  const escaped = code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`).test(raw);
}

/**
 * `overrides` win over the shared table — for a call where a code means something narrower than the
 * default sentence says.
 */
export function teamErrorMessage(
  raw: string,
  fallback: string,
  overrides: readonly ErrorRule[] = [],
): string {
  const hit = [...overrides, ...TEAM_ERRORS].find(([code]) => mentions(raw, code));
  return hit?.[1] ?? fallback;
}

/** A real Error with a friendly message; the raw database error rides along as `cause`. */
function fail(
  error: { message?: string } | null,
  fallback: string,
  overrides: readonly ErrorRule[] = [],
): Error {
  return new Error(teamErrorMessage(error?.message ?? '', fallback, overrides), { cause: error });
}

/** How long the access call may take before it counts as failed (the screen would otherwise spin). */
export const MY_ACCESS_TIMEOUT_MS = 10_000;

/** The signed-in person's access (api_my_access). Rejects on an error or after MY_ACCESS_TIMEOUT_MS. */
export async function loadMyAccess(): Promise<AdminAccess> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error('Loading your permissions timed out.')),
      MY_ACCESS_TIMEOUT_MS,
    );
  });
  try {
    const { data, error } = await Promise.race([
      getBrowserSupabase().rpc('api_my_access', { p: {} }),
      timedOut,
    ]);
    if (error) throw new Error(error.message, { cause: error });
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
  } finally {
    clearTimeout(timer);
  }
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
    // RETURNING, because PostgREST answers "0 rows changed" (a deleted role, or RLS hiding it from a
    // non-owner) with success and no error.
    const { data, error } = await sb.from('team_roles').update(row).eq('id', input.id).select('id');
    if (error) throw fail(error, 'Could not save the role.');
    if (!data || data.length === 0) {
      throw new Error(
        'That role no longer exists, or only the owner can change it — reload the page.',
      );
    }
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
  // RETURNING for the same reason as saveRole: a no-op delete is not an error to PostgREST.
  const { data, error } = await getBrowserSupabase()
    .from('team_roles')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw fail(error, 'Could not delete the role.');
  if (!data || data.length === 0) {
    throw new Error(
      'That role no longer exists, or only the owner can delete it — reload the page.',
    );
  }
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
  // `not_found` reads "no account with that email" only when an email was typed; by id it means the
  // person's row went away.
  if (error) {
    throw fail(error, 'Could not change their role.', who.email ? [] : NO_SUCH_PERSON);
  }
}

export async function removeMember(userId: string): Promise<void> {
  const { error } = await getBrowserSupabase().rpc('api_team_remove', { p: { userId } });
  if (error) throw fail(error, 'Could not remove them.', NO_SUCH_PERSON);
}
