import { z } from 'zod';

/** Per-path meta override row (api_seo_meta DTO). */
export const seoMetaSchema = z.object({
  path: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  ogImageUrl: z.string().nullable(),
});
export type SeoMeta = z.infer<typeof seoMetaSchema>;

/** Blog post summary (api_list_posts DTO) — the /blog index + sitemap shape. */
export const postSummarySchema = z.object({
  slug: z.string(),
  title: z.string(),
  metaTitle: z.string().nullable(),
  metaDescription: z.string().nullable(),
  excerpt: z.string().nullable(),
  readMins: z.number().int(),
  heroImageUrl: z.string().nullable(),
  datePublished: z.string(),
});
export type PostSummary = z.infer<typeof postSummarySchema>;

/** Full blog post (api_get_post DTO) — matches PostContent in src/lib/content/blog.ts. */
export const postSchema = postSummarySchema.extend({
  sections: z.array(z.object({ heading: z.string(), paragraphs: z.array(z.string()) })),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
  status: z.enum(['draft', 'published']),
});
export type DbPost = z.infer<typeof postSchema>;

/** Validate an admin-entered redirect FROM path: site-relative, no query/hash, not the homepage. */
export function redirectFromPathError(from: string, to: string): string | null {
  const f = from.trim();
  const t = to.trim();
  if (!f.startsWith('/')) return 'The old URL must start with “/” (e.g. /old-tour).';
  if (f === '/') return 'You can’t redirect the homepage.';
  if (f.includes('?') || f.includes('#')) return 'Use the plain path only — no “?” or “#”.';
  if (!t.startsWith('/')) return 'The destination must be a path on this site, starting with “/”.';
  if (f === t) return 'The old URL and the destination are the same.';
  return null;
}
