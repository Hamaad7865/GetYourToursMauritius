import { POSTS_RAW } from './_blog.gen';
import { POSTS_FR } from './_blog.fr.gen';
import { BLOG_HERO } from './blog-images';
import { localiseContent } from './localise';
import type { Locale } from '@/lib/i18n/config';

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

/**
 * The fields of a blog post that may be translated. An ALLOWLIST, deliberately — but note the
 * deliberate DIFFERENCE from the area/attraction/transfer guides: an area's `name` is a real place
 * name and stays out of its translation type, whereas a blog post's `title` is our own editorial
 * copy and belongs here. `sections` and `faq` are our own written article body and Q&A, so they
 * translate too — a translated `sections` entry must keep the same number and order of blocks as the
 * English source (pages render them positionally) and only ever set `heading`/`paragraphs` (never
 * `imageUrl`, which is a path, not prose). `slug`, `readMins`, `heroImageUrl` and each section's
 * `imageUrl` are identifiers or paths, never present here. `metaTitle`/`metaDescription` are also
 * left out for now — like `areaMetaTitle`/`attractionMetaTitle`/`transferMetaTitle`, SEO title/meta
 * tags are handled together in the metadata pass, not per content module.
 */
export type PostTranslation = Partial<Pick<PostContent, 'title' | 'excerpt' | 'sections' | 'faq'>>;

/** A post in the visitor's language, falling back to English per field. */
export function localisedPost(post: Post, locale: Locale): Post {
  return localiseContent(post, POSTS_FR[post.slug], locale);
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
