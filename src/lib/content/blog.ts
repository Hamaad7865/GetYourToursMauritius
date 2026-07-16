import { POSTS_RAW } from './_blog.gen';
import { BLOG_HERO } from './blog-images';

/**
 * Blog / travel-guide articles. Raw content is generated into `_blog.gen.ts`; this module
 * types it and stamps deterministic publish dates (no runtime now() so builds are stable).
 */

export interface PostContent {
  slug: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  readMins: number;
  /** `imageUrl` is an optional illustration under the section heading (admin-written posts only). */
  sections: { heading: string; paragraphs: string[]; imageUrl?: string | null }[];
  faq: { q: string; a: string }[];
  /** Cover photo (admin-written posts only) — hero band, index card thumb, OG/social image. */
  heroImageUrl?: string | null;
}

export interface Post extends PostContent {
  path: string;
  datePublished: string; // YYYY-MM-DD
}

export function blogPath(slug: string): string {
  return `/blog/${slug}`;
}

/** Deterministic publish date per post (newest first, 5 days apart) — no Date.now(), so builds are stable. */
function dateForIndex(i: number): string {
  const base = Date.parse('2026-06-17T00:00:00Z');
  return new Date(base - i * 5 * 86400000).toISOString().slice(0, 10);
}

export const posts: Post[] = POSTS_RAW.map((p, i) => ({
  ...p,
  // Seed posts carry no photo of their own, which left the index a wall of text-only cards and every
  // social share falling back to the site-wide OG image. BLOG_HERO (generated alongside the files in
  // public/blog) fills that in. A post that ever ships its own hero keeps it, and an admin-written DB
  // post replaces the whole seed anyway (blog-live.ts), so this never overrides real editorial choice.
  heroImageUrl: p.heroImageUrl ?? BLOG_HERO[p.slug] ?? null,
  path: blogPath(p.slug),
  datePublished: dateForIndex(i),
})).sort((a, b) => b.datePublished.localeCompare(a.datePublished));

export function getPost(slug: string): Post | null {
  return posts.find((p) => p.slug === slug) ?? null;
}

export function relatedPosts(slug: string, n = 3): Post[] {
  return posts.filter((p) => p.slug !== slug).slice(0, n);
}

/** Human date like "17 June 2026". */
export function formatPostDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}
