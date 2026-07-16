import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import { contentDefaultsMapSchema } from '@/lib/validation/content-defaults';
import type { ContentDefaultsMap } from '@/lib/catalogue/content-defaults';

/**
 * Every category's standard content, keyed by `activities.category`.
 *
 * FAILS SOFT BY DESIGN: an activity page must never break because standard content is unavailable
 * (table not migrated yet, DB blip). On any error we return {}, and `applyDefaults` then renders the
 * activity's own lists — exactly what it showed before this feature existed.
 */
export async function loadContentDefaults(ctx: ServiceContext): Promise<ContentDefaultsMap> {
  try {
    const data = await callRpc(ctx, 'api_content_defaults', {});
    return contentDefaultsMapSchema.parse(data ?? {});
  } catch {
    return {};
  }
}
