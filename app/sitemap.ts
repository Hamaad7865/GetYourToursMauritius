import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/seo/site';
import { publicServiceContext } from '@/lib/http/context';
import { searchActivities, CATALOGUE_HIDDEN_SLUGS } from '@/lib/services/activities';
import { loadPlaces } from '@/lib/catalogue/places';
import { transfers } from '@/lib/content/transfers';
import { loadPosts } from '@/lib/content/blog-live';
import { areas } from '@/lib/content/areas';
import { LOCALES } from '@/lib/i18n/config';
import { localeAlternates, localePath } from '@/lib/i18n/routing';

export const runtime = 'edge';

/**
 * NOTE: nothing here may call `getLocale()`. The sitemap is one document describing BOTH languages,
 * not a per-visitor rendering — reading the request's locale would make it dynamic and emit a
 * half-sitemap that depends on who asked for it. `localePath`/`localeAlternates` are pure.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.url;

  type Entry = MetadataRoute.Sitemap[number];
  type Meta = Omit<Entry, 'url' | 'alternates'>;

  /**
   * One sitemap entry per language for a route, each carrying the FULL set of alternates including
   * itself — that is the form Google asks for, and it is what tells it the two URLs are the same
   * page in different languages rather than duplicates competing with each other.
   */
  function bilingual(path: string, meta: Meta): MetadataRoute.Sitemap {
    const { languages } = localeAlternates(path);
    const absolute = Object.fromEntries(
      Object.entries(languages).map(([code, p]) => [code, `${base}${p}`]),
    );
    return LOCALES.map((locale) => ({
      ...meta,
      url: `${base}${localePath(locale, path)}`,
      alternates: { languages: absolute },
    }));
  }

  const staticPages: { path: string; meta: Meta }[] = [
    { path: '/', meta: { changeFrequency: 'daily', priority: 1 } },
    { path: '/activities', meta: { changeFrequency: 'daily', priority: 0.9 } },
    { path: '/mauritius-tours', meta: { changeFrequency: 'weekly', priority: 0.9 } },
    { path: '/attractions', meta: { changeFrequency: 'weekly', priority: 0.7 } },
    { path: '/things-to-do-in-belle-mare', meta: { changeFrequency: 'weekly', priority: 0.7 } },
    { path: '/airport-transfers', meta: { changeFrequency: 'weekly', priority: 0.8 } },
    { path: '/mauritius-catamaran-cruise', meta: { changeFrequency: 'weekly', priority: 0.8 } },
    { path: '/ile-aux-cerfs-tours', meta: { changeFrequency: 'weekly', priority: 0.8 } },
    { path: '/dolphin-swim-mauritius', meta: { changeFrequency: 'weekly', priority: 0.8 } },
    { path: '/belle-mare-tours', meta: { changeFrequency: 'monthly', priority: 0.7 } },
    { path: '/blog', meta: { changeFrequency: 'weekly', priority: 0.7 } },
    { path: '/mauritius-travel-guide', meta: { changeFrequency: 'monthly', priority: 0.7 } },
    { path: '/reviews', meta: { changeFrequency: 'weekly', priority: 0.6 } },
    { path: '/destinations', meta: { changeFrequency: 'weekly', priority: 0.7 } },
    { path: '/ai-road-trip-planner', meta: { changeFrequency: 'monthly', priority: 0.6 } },
    { path: '/rent', meta: { changeFrequency: 'monthly', priority: 0.4 } },
    { path: '/contact', meta: { changeFrequency: 'monthly', priority: 0.4 } },
    { path: '/about', meta: { changeFrequency: 'monthly', priority: 0.4 } },
    { path: '/help', meta: { changeFrequency: 'monthly', priority: 0.4 } },
    { path: '/refunds', meta: { changeFrequency: 'yearly', priority: 0.3 } },
    { path: '/terms', meta: { changeFrequency: 'yearly', priority: 0.3 } },
    { path: '/privacy', meta: { changeFrequency: 'yearly', priority: 0.3 } },
    { path: '/cookies', meta: { changeFrequency: 'yearly', priority: 0.3 } },
  ];

  const staticRoutes: MetadataRoute.Sitemap = staticPages.flatMap(({ path, meta }) =>
    bilingual(path, meta),
  );

  const transferRoutes: MetadataRoute.Sitemap = transfers.flatMap((t) =>
    bilingual(t.path, { changeFrequency: 'monthly', priority: 0.6 }),
  );

  const blogRoutes: MetadataRoute.Sitemap = (await loadPosts()).flatMap((p) =>
    bilingual(p.path, {
      lastModified: p.datePublished,
      changeFrequency: 'monthly',
      priority: 0.6,
    }),
  );

  const destinationRoutes: MetadataRoute.Sitemap = areas.flatMap((a) =>
    bilingual(a.path, { changeFrequency: 'monthly', priority: 0.6 }),
  );

  const activityRoutes: MetadataRoute.Sitemap = [];
  try {
    // Page through the whole catalogue (the old single page-1/100 silently dropped tour #101+ once the
    // catalogue grows). Cap at 50 pages (5,000 tours) as a runaway guard.
    const pageSize = 100;
    for (let page = 1; page <= 50; page += 1) {
      const { items } = await searchActivities(publicServiceContext(), { page, pageSize });
      for (const activity of items) {
        activityRoutes.push(
          ...bilingual(`/activities/${activity.slug}`, {
            changeFrequency: 'weekly',
            priority: 0.8,
          }),
        );
      }
      // `items` is POST-filter: searchActivities drops CATALOGUE_HIDDEN_SLUGS after the RPC returns,
      // so a FULL page can come back short. Comparing it against pageSize therefore ended the loop on
      // the first page that happened to contain a hidden slug, silently dropping every tour after it.
      // At most one hidden slug per page can be removed, so a page shorter than that tolerance is
      // genuinely the last one.
      if (items.length < pageSize - CATALOGUE_HIDDEN_SLUGS.length) break;
    }
  } catch (error) {
    console.error('[sitemap] catalogue fetch failed', error);
  }

  let attractionRoutes: MetadataRoute.Sitemap = [];
  try {
    const places = await loadPlaces();
    attractionRoutes = places.flatMap((place) =>
      bilingual(`/attractions/${place.id}`, { changeFrequency: 'monthly', priority: 0.6 }),
    );
  } catch (error) {
    console.error('[sitemap] places fetch failed', error);
  }

  return [
    ...staticRoutes,
    ...transferRoutes,
    ...blogRoutes,
    ...destinationRoutes,
    ...activityRoutes,
    ...attractionRoutes,
  ];
}
