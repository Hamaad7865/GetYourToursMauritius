import type { TestDb } from './pglite';

/**
 * Book exactly as the production booking route does since the api_book lockdown (20260808000000):
 * api_book is SERVICE-ROLE-ONLY, and the route calls it through a service-role client passing the
 * JWKS-verified user id as `actorUserId` (which the RPC stamps as the booking owner + checks in the F23
 * replay guard, in place of the now-null auth.uid()).
 *
 * This helper reads whoever is "signed in" in the current test session (request.jwt.claims.sub), flips
 * to service_role for the call, injects that id as actorUserId, and restores the prior session — so an
 * existing `call(db, 'api_book', …)` site keeps its intended identity semantics with a mechanical rename
 * to `apiBook(db, …)`: an authenticated session books an OWNED booking; anon / service_role (no sub)
 * books a GUEST booking (user_id null), exactly as before the lockdown. An explicit `actorUserId` in
 * params wins (for tests that assert a mismatched/forged id is refused).
 */
export async function apiBook<T = unknown>(
  db: TestDb,
  params: Record<string, unknown>,
): Promise<T> {
  const { rows: pre } = await db.pg.query<{ claims: string | null; role: string }>(
    `select current_setting('request.jwt.claims', true) as claims, current_user as role`,
  );
  const prev = pre[0]!;
  let sessionSub: string | null = null;
  try {
    sessionSub = prev.claims ? ((JSON.parse(prev.claims).sub as string | undefined) ?? null) : null;
  } catch {
    /* no claims / not JSON — treat as anonymous */
  }
  const actorUserId = (params.actorUserId as string | null | undefined) ?? sessionSub;

  await db.pg.exec(`reset role;`);
  await db.pg.query(`select set_config('request.jwt.claims', $1, false)`, [
    JSON.stringify({ role: 'service_role' }),
  ]);
  await db.pg.exec(`set role service_role;`);
  try {
    const { rows } = await db.pg.query<{ data: T }>(`select api_book($1::jsonb) as data`, [
      JSON.stringify({ ...params, actorUserId }),
    ]);
    return rows[0]!.data;
  } finally {
    await db.pg.exec(`reset role;`);
    await db.pg.query(`select set_config('request.jwt.claims', $1, false)`, [prev.claims ?? '']);
    if (prev.role === 'anon' || prev.role === 'authenticated' || prev.role === 'service_role') {
      await db.pg.exec(`set role ${prev.role};`);
    }
  }
}
