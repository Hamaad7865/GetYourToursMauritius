import { buildAccess, type AdminAccess } from '@/lib/admin/permissions';

/**
 * The two reads loadCallerAccess makes, described structurally so the service-role Supabase client and
 * the PGlite shim both satisfy it (routes cast their client to this).
 */
export interface AccessClient {
  from(table: 'profiles' | 'team_roles'): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): { maybeSingle(): PromiseLike<{ data: unknown; error: unknown }> };
    };
  };
}

function errorText(error: unknown, fallback: string): string {
  return String((error as { message?: string } | null)?.message ?? fallback);
}

/**
 * The caller's back-office access, read through the SERVICE-ROLE client: `profiles` and `team_roles`
 * are RLS-protected and this must answer for any caller.
 *
 * NEVER derive it from `requireUser(req).role` — that is the JWT's Postgres role selector
 * ('authenticated' for staff and customers alike), not the business role. Fails closed: no profile,
 * no team role, a team role whose base does not match the profile's role, or an unknown role all give
 * no permissions.
 */
export async function loadCallerAccess(db: AccessClient, userId: string): Promise<AdminAccess> {
  const profile = await db
    .from('profiles')
    .select('role, team_role_id')
    .eq('id', userId)
    .maybeSingle();
  if (profile.error) throw new Error(errorText(profile.error, 'profile read failed'));
  const row = profile.data as { role?: unknown; team_role_id?: unknown } | null;
  const role = typeof row?.role === 'string' ? row.role : null;
  const teamRoleId = typeof row?.team_role_id === 'string' ? row.team_role_id : null;
  if (!teamRoleId) return buildAccess({ role });

  const team = await db
    .from('team_roles')
    .select('name, base, permissions')
    .eq('id', teamRoleId)
    .maybeSingle();
  if (team.error) throw new Error(errorText(team.error, 'team role read failed'));
  const t = team.data as { name?: unknown; base?: unknown; permissions?: unknown } | null;
  // A team role only counts while its base matches the profile's role (staff <-> team, seo <->
  // content) — the same rule has_permission() and api_my_access() apply, so the server never grants
  // what the database would refuse. The Owner ignores team roles altogether.
  const expectedBase = role === 'staff' ? 'team' : role === 'seo' ? 'content' : null;
  if (expectedBase && t?.base !== expectedBase) return buildAccess({ role });
  return buildAccess({
    role,
    teamRoleId,
    teamRoleName: typeof t?.name === 'string' ? t.name : null,
    permissions: Array.isArray(t?.permissions)
      ? t.permissions.filter((k): k is string => typeof k === 'string')
      : [],
  });
}
