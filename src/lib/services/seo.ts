import { z } from 'zod';
import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import {
  postSchema,
  postSummarySchema,
  seoMetaSchema,
  type DbPost,
  type PostSummary,
  type SeoMeta,
} from '@/lib/validation/seo';

/** The meta override for a public page path, or null when the page has none. */
export async function getSeoMeta(ctx: ServiceContext, path: string): Promise<SeoMeta | null> {
  const data = await callRpc(ctx, 'api_seo_meta', { path });
  if (data == null) return null;
  return seoMetaSchema.parse(data);
}

/** Published blog posts, newest first (for /blog + the sitemap). */
export async function listDbPosts(ctx: ServiceContext): Promise<PostSummary[]> {
  const data = await callRpc(ctx, 'api_list_posts', {});
  return z.array(postSummarySchema).parse(data);
}

/** One published post (editors also see drafts), or null. */
export async function getDbPost(ctx: ServiceContext, slug: string): Promise<DbPost | null> {
  const data = await callRpc(ctx, 'api_get_post', { slug });
  if (data == null) return null;
  return postSchema.parse(data);
}

/** Redirect target for a missed path, or null. Called only from the 404 catch-all. */
export async function lookupRedirect(ctx: ServiceContext, path: string): Promise<string | null> {
  const data = await callRpc(ctx, 'api_lookup_redirect', { path });
  return typeof data === 'string' && data.startsWith('/') ? data : null;
}
