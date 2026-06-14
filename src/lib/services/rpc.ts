import type { RpcParams } from '@/lib/db/rpc';
import type { ServiceContext } from './context';
import { mapDbError } from './db-errors';

/** Calls an `api_*` Postgres function, mapping any DB exception to a ServiceError. */
export async function callRpc<T = unknown>(
  ctx: ServiceContext,
  fn: string,
  params: RpcParams,
): Promise<T> {
  try {
    return await ctx.db.rpc<T>(fn, params);
  } catch (error) {
    return mapDbError(error);
  }
}
