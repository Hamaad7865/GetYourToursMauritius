import {
  posts as genPosts,
  blogPath,
  getPost as getGenPost,
  localisedPost,
  RELATED_POSTS,
  type Post,
} from './blog';
import { publicServiceContext } from '@/lib/http/context';
import { getDbPost, listDbPosts } from '@/lib/services/seo';
import type { Locale } from '@/lib/i18n/config';

/**
 * The LIVE blog source: database posts (written in /admin/blog) merged over the code-generated seed
 * posts — a DB post with the same slug replaces the seed one, new DB posts appear alongside. On any
 * DB error the seed posts still render (the blog can never go down with the database). Anon only
 * ever receives published rows (RLS + the api_* RPCs enforce it server-side).
 *
 * Deliberately no cookie-based locale lookup in this file: `app/sitemap.ts` calls `loadPosts()`
 * directly, and reading the locale cookie would force the sitemap into dynamic rendering. Instead
 * each function takes an explicit `locale` parameter that defaults to English — pages resolve the
 * visitor's locale themselves (from `@/lib/i18n/server`) and pass it in; the sitemap simply omits the
 * argument, so it keeps building statically in English. DB-written posts have no French overlay
 * (there is nothing to translate them with), so they render in whatever language the author wrote
 * them; only the code-generated seed posts pick up `POSTS_FR`.
 */

/** Post list for the index + sitemap + "keep reading" (summaries — DB rows carry empty sections). */
export async function loadPosts(locale: Locale = 'en'): Promise<Post[]> {
  let db: Post[] = [];
  try {
    db = (await listDbPosts(publicServiceContext())).map((p) => ({
      slug: p.slug,
      title: p.title,
      metaTitle: p.metaTitle ?? p.title,
      metaDescription: p.metaDescription ?? p.excerpt ?? '',
      excerpt: p.excerpt ?? '',
      readMins: p.readMins,
      sections: [],
      faq: [],
      heroImageUrl: p.heroImageUrl,
      path: blogPath(p.slug),
      datePublished: p.datePublished,
    }));
  } catch {
    /* DB unavailable / not migrated yet — the seed posts still render */
  }
  const dbSlugs = new Set(db.map((p) => p.slug));
  const seed = genPosts.filter((p) => !dbSlugs.has(p.slug)).map((p) => localisedPost(p, locale));
  return [...db, ...seed].sort((a, b) => b.datePublished.localeCompare(a.datePublished));
}

/** One full post: the DB version wins over the seed version of the same slug. */
export async function loadPost(slug: string, locale: Locale = 'en'): Promise<Post | null> {
  try {
    const p = await getDbPost(publicServiceContext(), slug);
    if (p) {
      return {
        slug: p.slug,
        title: p.title,
        metaTitle: p.metaTitle ?? p.title,
        metaDescription: p.metaDescription ?? p.excerpt ?? '',
        excerpt: p.excerpt ?? '',
        readMins: p.readMins,
        sections: p.sections,
        faq: p.faq,
        heroImageUrl: p.heroImageUrl,
        path: blogPath(p.slug),
        datePublished: p.datePublished,
      };
    }
  } catch {
    /* fall through to the seed post */
  }
  const seed = getGenPost(slug);
  return seed ? localisedPost(seed, locale) : null;
}

/**
 * Other posts to link under an article: the hand-picked ones first (RELATED_POSTS), then the posts
 * that follow this one in date order, wrapping round.
 *
 * The fill used to be "the newest posts", which meant every article without picks linked the same
 * three. On 2026-10-13 that was 36 articles all pointing at a post published four days earlier —
 * which promptly outranked the catamaran page it was written to support — and at two posts written
 * in French, shown under English articles. Walking on from the current post gives every article
 * its own three and every post a share of the links.
 *
 * Only the code-authored posts are used as fill: they have a translation, so the link is in the
 * reader's language. A post written in /admin/blog has one language and no way to say which, so it
 * appears here only when RELATED_POSTS names it.
 */
export async function loadRelatedPosts(
  slug: string,
  n = 3,
  locale: Locale = 'en',
): Promise<Post[]> {
  const all = await loadPosts(locale);
  const others = all.filter((p) => p.slug !== slug);
  const picked = (RELATED_POSTS[slug] ?? [])
    .map((s) => others.find((p) => p.slug === s))
    .filter((p): p is Post => p !== undefined);

  const seedSlugs = new Set(genPosts.map((p) => p.slug));
  const at = all.findIndex((p) => p.slug === slug);
  const following = at === -1 ? all : [...all.slice(at + 1), ...all.slice(0, at)];
  const fill = following.filter(
    (p) => p.slug !== slug && seedSlugs.has(p.slug) && !picked.includes(p),
  );
  return [...picked, ...fill].slice(0, n);
}
