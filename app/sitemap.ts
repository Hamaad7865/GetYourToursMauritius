import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/seo/site';
import { publicServiceContext } from '@/lib/http/context';
import { searchActivities } from '@/lib/services/activities';

export const runtime = 'edge';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = SITE.url;
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'daily', priority: 1 },
    { url: `${base}/activities`, changeFrequency: 'daily', priority: 0.9 },
    { url: `${base}/about`, changeFrequency: 'monthly', priority: 0.4 },
    { url: `${base}/help`, changeFrequency: 'monthly', priority: 0.4 },
  ];

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

  return [...staticRoutes, ...activityRoutes];
}
