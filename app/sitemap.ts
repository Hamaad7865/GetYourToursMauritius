import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/seo/site';
import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';
import { loadPlaces } from '@/lib/catalogue/places';
import { transfers } from '@/lib/content/transfers';
import { posts } from '@/lib/content/blog';
import { areas } from '@/lib/content/areas';

export const runtime = 'edge';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.url;
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/activities`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/attractions`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/airport-transfers`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/blog`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/mauritius-travel-guide`, changeFrequency: 'monthly', priority: 0.7 },
    { url: `${base}/reviews`, changeFrequency: 'weekly', priority: 0.6 },
    { url: `${base}/destinations`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/ai-road-trip-planner`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${base}/airport-transfer`, changeFrequency: 'monthly', priority: 0.5 },
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

  const blogRoutes: MetadataRoute.Sitemap = posts.map((p) => ({
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

  let activityRoutes: MetadataRoute.Sitemap = [];
  try {
    const { items } = await searchActivities(publicServiceContext(), { page: 1, pageSize: 100 });
    activityRoutes = items.map((activity) => ({
      url: `${base}/activities/${activity.slug}`,
      changeFrequency: 'weekly',
      priority: 0.8,
    }));
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
