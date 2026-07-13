import { posts as genPosts, blogPath, getPost as getGenPost, type Post } from './blog';
import { publicServiceContext } from '@/lib/http/context';
import { getDbPost, listDbPosts } from '@/lib/services/seo';

/**
 * The LIVE blog source: database posts (written in /admin/blog) merged over the code-generated seed
 * posts — a DB post with the same slug replaces the seed one, new DB posts appear alongside. On any
 * DB error the seed posts still render (the blog can never go down with the database). Anon only
 * ever receives published rows (RLS + the api_* RPCs enforce it server-side).
 */

/** Post list for the index + sitemap + "keep reading" (summaries — DB rows carry empty sections). */
export async function loadPosts(): Promise<Post[]> {
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
  return [...db, ...genPosts.filter((p) => !dbSlugs.has(p.slug))].sort((a, b) =>
    b.datePublished.localeCompare(a.datePublished),
  );
}

/** One full post: the DB version wins over the seed version of the same slug. */
export async function loadPost(slug: string): Promise<Post | null> {
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
  return getGenPost(slug);
}

/** Other posts to link under an article (merged source, newest first). */
export async function loadRelatedPosts(slug: string, n = 3): Promise<Post[]> {
  const all = await loadPosts();
  return all.filter((p) => p.slug !== slug).slice(0, n);
}
