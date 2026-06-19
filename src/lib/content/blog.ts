import { POSTS_RAW } from './_blog.gen';

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
  sections: { heading: string; paragraphs: string[] }[];
  faq: { q: string; a: string }[];
}

export interface Post extends PostContent {
  path: string;
  datePublished: string; // YYYY-MM-DD
}

export function blogPath(slug: string): string {
  return `/blog/${slug}`;
}

/** Deterministic publish dates, newest first — stamped at build, no Date.now() dependency. */
const PUBLISH_DATES = [
  '2026-06-17',
  '2026-06-12',
  '2026-06-05',
  '2026-05-29',
  '2026-05-22',
  '2026-05-15',
  '2026-05-08',
  '2026-05-01',
  '2026-04-24',
  '2026-04-17',
];

export const posts: Post[] = POSTS_RAW.map((p, i) => ({
  ...p,
  path: blogPath(p.slug),
  datePublished: PUBLISH_DATES[i] ?? '2026-04-10',
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
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${d} ${months[(m ?? 1) - 1]} ${y}`;
}
