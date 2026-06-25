import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import {
  accountExportSchema,
  profileSchema,
  type AccountExport,
  type Profile,
  type ProfileUpdate,
} from '@/lib/validation/account';

/** The caller's profile (create-if-missing on first read). */
export async function getProfile(ctx: ServiceContext): Promise<Profile> {
  const data = await callRpc(ctx, 'api_get_profile', {});
  return profileSchema.parse(data);
}

/** Update the caller's profile — only provided keys change (undefined keys are dropped by callRpc). */
export async function updateProfile(ctx: ServiceContext, input: ProfileUpdate): Promise<Profile> {
  const data = await callRpc(ctx, 'api_update_profile', input);
  return profileSchema.parse(data);
}

/** The caller's GDPR data export (profile incl. dateOfBirth + bookings). */
export async function exportAccount(ctx: ServiceContext): Promise<AccountExport> {
  const data = await callRpc(ctx, 'api_export_user', {});
  return accountExportSchema.parse(data);
}

/**
 * Erase the caller's data via api_erase_user, run on the USER-scoped context so auth.uid() is present —
 * api_erase_user's self-guard requires it and forces the email to the caller's JWT identity. The auth
 * user itself is removed separately by the route (service-role auth.admin.deleteUser).
 */
export async function eraseAccountData(
  ctx: ServiceContext,
  userId: string,
  email: string | null,
): Promise<void> {
  await callRpc(ctx, 'api_erase_user', { userId, email });
}
