import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/seo/site';

export const runtime = 'edge';

export default function robots(): MetadataRoute.Robots {
  return {
    // /api/img is the allowlisted Wikimedia image proxy every attraction and area photo renders
    // through. Under the blanket /api/ disallow Google could not fetch a single one of them, so it
    // fell back to the logo as the /belle-mare thumbnail in search results. The longer rule wins.
    rules: [
      { userAgent: '*', allow: ['/', '/api/img'], disallow: ['/account', '/admin', '/api/'] },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
