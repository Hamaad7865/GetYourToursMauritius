import type { MetadataRoute } from 'next';
import { SITE, isNoindexBuild } from '@/lib/seo/site';

export const runtime = 'edge';

export default function robots(): MetadataRoute.Robots {
  // A sandbox build is a public duplicate of the live site: tell every crawler to stay out.
  if (isNoindexBuild()) return { rules: [{ userAgent: '*', disallow: '/' }] };
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/account', '/admin', '/api/'] }],
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
