'use server';

import { createServiceRoleClient } from '@/lib/supabase/admin';
import { verifyAccessToken } from '@/lib/http/auth';

export interface DeleteAccountResult {
  ok: boolean;
  /** A stable, non-PII error code the client can map to a localized message. */
  error?: 'unauthenticated' | 'erase_failed';
}

/**
 * Self-serve account deletion (GDPR right to erasure).
 *
 * The session is re-validated SERVER-side: the caller passes their Supabase access token (this app
 * is Bearer-based, not cookie-based — see `src/lib/http/auth.ts`), and we derive the user id + email
 * from the cryptographically verified JWT. The action NEVER trusts a client-passed id, so a user can
 * only ever erase themselves; `verifyAccessToken` rejects a forged or expired token.
 *
 * Order matters:
 *  1. `api_erase_user` (the SECURITY DEFINER engine) anonymizes-with-retention FIRST. Called with the
 *     service-role client it runs with staff privileges, but we pass the caller's OWN verified
 *     userId+email, and the RPC scopes to `user_id = userId OR email`, so the blast radius is exactly
 *     this user's rows. If it errors, we return and do NOT touch the auth user — nothing is lost.
 *  2. Only after the DB step succeeds do we delete the Supabase auth user. If THAT fails, the data is
 *     already anonymized/deleted, so we log a non-PII note and still return success — the orphaned
 *     auth record is a staff cleanup item, not a data leak.
 */
export async function deleteMyAccount(accessToken: string): Promise<DeleteAccountResult> {
  let userId: string;
  let email: string | null;
  try {
    const user = await verifyAccessToken(accessToken);
    userId = user.id;
    email = user.email;
  } catch {
    return { ok: false, error: 'unauthenticated' };
  }

  const admin = createServiceRoleClient();

  // DB erasure FIRST — anonymize-with-retention. On failure, abort before deleting the auth user.
  const { error: eraseError } = await admin.rpc('api_erase_user', {
    p: { userId, email },
  });
  if (eraseError) {
    // Non-PII: log the code/message only, never the user's email.
    console.error('gdpr_erase_failed', eraseError.message);
    return { ok: false, error: 'erase_failed' };
  }

  // Auth user removal. The data is already erased; a failure here is a cleanup item, not a leak.
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error('gdpr_auth_delete_failed', deleteError.message);
    // Intentionally still a success: erasure (the data-protection obligation) is complete.
  }

  return { ok: true };
}
