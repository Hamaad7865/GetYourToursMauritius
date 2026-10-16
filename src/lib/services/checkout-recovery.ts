import type { ServiceContext } from './context';
import { callRpc } from './rpc';

/**
 * Adds the address behind a checkout-recovery email's token to the suppression list, so no further
 * recovery email is ever queued for it. Idempotent; an unknown token reports `false`.
 */
export async function optOutOfCheckoutRecovery(
  ctx: ServiceContext,
  token: string,
): Promise<boolean> {
  const data = await callRpc<{ ok?: boolean } | null>(ctx, 'api_checkout_recovery_opt_out', {
    token,
  });
  return data?.ok === true;
}
