import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { homePicksSchema, type HomePicks } from '@/lib/validation/home-picks';

/** The homepage's shared picks — most booked, and free tomorrow (api_home_picks, 20261030140000). */
export async function homePicks(ctx: ServiceContext): Promise<HomePicks> {
  const data = await callRpc(ctx, 'api_home_picks', {});
  return homePicksSchema.parse(data);
}
