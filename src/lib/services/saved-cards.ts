import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import {
  savedCardSchema,
  deleteSavedCardResultSchema,
  type SavedCard,
} from '@/lib/validation/saved-cards';

/** The caller's saved cards (metadata only), newest first. Owner-scoped in the RPC. */
export async function listSavedCards(ctx: ServiceContext): Promise<SavedCard[]> {
  const data = await callRpc(ctx, 'api_list_saved_cards', {});
  return z.array(savedCardSchema).parse(data ?? []);
}

/** Forget one of the caller's own cards (idempotent). Owner-scoped in the RPC. */
export async function deleteSavedCard(
  ctx: ServiceContext,
  id: string,
): Promise<{ id: string; deleted: true }> {
  const data = await callRpc(ctx, 'api_delete_saved_card', { id });
  return deleteSavedCardResultSchema.parse(data);
}
