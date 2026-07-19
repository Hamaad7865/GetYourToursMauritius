import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/seo/site';
import { publicServiceContext } from '@/lib/http/context';
import { searchActivities, CATALOGUE_HIDDEN_SLUGS } from '@/lib/services/activities';
import { loadPlaces } from '@/lib/catalogue/places';
import { transfers } from '@/lib/content/transfers';
import { loadPosts } from '@/lib/content/blog-live';
import { areas } from '@/lib/content/areas';

export const runtime = 'edge';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.url;
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/activities`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/mauritius-tours`, changeFrequency: 'weekly', priority: 0.9 },
    { url: `${base}/attractions`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/things-to-do-in-belle-mare`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/airport-transfers`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/mauritius-catamaran-cruise`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/ile-aux-cerfs-tours`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/dolphin-swim-mauritius`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/belle-mare-tours`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/blog`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/mauritius-travel-guide`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/reviews`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/destinations`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/ai-road-trip-planner`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/rent`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/contact`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/about`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/help`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/refunds`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/cookies`, changeFrequency: 'yearly', priority: 0.3 },
  ];

  const transferRoutes: MetadataRoute.Sitemap = transfers.map((t) => ({
    url: `${base}${t.path}`,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));

  const blogRoutes: MetadataRoute.Sitemap = (await loadPosts()).map((p) => ({
    url: `${base}${p.path}`,
    lastModified: p.datePublished,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));

  const destinationRoutes: MetadataRoute.Sitemap = areas.map((a) => ({
    url: `${base}${a.path}`,
    changeFrequency: 'monthly',
    priority: 0.6,
  }));

  const activityRoutes: MetadataRoute.Sitemap = [];
  try {
    // Page through the whole catalogue (the old single page-1/100 silently dropped tour #101+ once the
    // catalogue grows). Cap at 50 pages (5,000 tours) as a runaway guard.
    const pageSize = 100;
    for (let page = 1; page <= 50; page += 1) {
      const { items } = await searchActivities(publicServiceContext(), { page, pageSize });
      for (const activity of items) {
        activityRoutes.push({
          url: `${base}/activities/${activity.slug}`,
          changeFrequency: 'weekly',
          priority: 0.8,
        });
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
    attractionRoutes = places.map((place) => ({
      url: `${base}/attractions/${place.id}`,
      changeFrequency: 'monthly',
      priority: 0.6,
    }));
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
