'use server';

import { createServiceRoleClient } from '@/lib/supabase/admin';
import { verifyAccessToken } from '@/lib/http/auth';
import { userServiceContext } from '@/lib/http/context';
import { eraseAccountData } from '@/lib/services/account';

export interface DeleteAccountResult {
  ok: boolean;
  /** A stable, non-PII error code the client can map to a localized message. */
  error?: 'unauthenticated' | 'erase_failed';
  /** The data erasure completed but the auth-user removal failed transiently: the account is BANNED
   *  (cannot sign back in) and the removal is retryable. Never reported as a plain success — a
   *  "deleted" account that still exists in auth isn't deleted (review item 9). */
  pending?: boolean;
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
 *  1. `api_erase_user` (the SECURITY DEFINER engine) anonymizes-with-retention FIRST. It is run on a
 *     USER-SCOPED client carrying the caller's verified token, so the RPC's `auth.uid()` self-guard
 *     sees the caller (a service-role client has a NULL subject and is rejected as `forbidden`). The
 *     RPC also forces the email to the JWT identity, so the blast radius is exactly this user's rows.
 *     If it errors, we return and do NOT touch the auth user — nothing is lost.
 *  2. Only after the DB step succeeds do we delete the Supabase auth user (Admin API, service-role).
 *     If THAT fails, the data is already anonymized/deleted, so we log a non-PII note and still return
 *     success — the orphaned auth record is a staff cleanup item, not a data leak.
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

  // DB erasure FIRST — anonymize-with-retention. Run user-scoped so api_erase_user's auth.uid()
  // self-guard passes. On failure, abort before deleting the auth user.
  try {
    await eraseAccountData(userServiceContext(accessToken), userId, email);
  } catch (eraseError) {
    // Non-PII: log the code/message only, never the user's email.
    console.error(
      'gdpr_erase_failed',
      eraseError instanceof Error ? eraseError.message : String(eraseError),
    );
    return { ok: false, error: 'erase_failed' };
  }

  // Auth user removal (service-role Admin API). The data is already erased, so a failure here is not
  // a leak — but it is NOT "deleted" either: unhandled, the customer could sign back into a ghost
  // account. Ban the user (refresh tokens die, new sign-ins refused) and surface pending:true so the
  // caller knows the removal is still owed (retrying the action re-attempts it).
  const admin = createServiceRoleClient();
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    console.error('gdpr_auth_delete_failed', deleteError.message);
    const { error: banError } = await admin.auth.admin.updateUserById(userId, {
      ban_duration: '87600h',
    });
    if (banError) console.error('gdpr_auth_ban_failed', banError.message);
    return { ok: true, pending: true };
  }

  return { ok: true };
}
