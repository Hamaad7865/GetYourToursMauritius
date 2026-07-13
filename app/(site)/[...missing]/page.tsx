import { notFound, permanentRedirect } from 'next/navigation';
import { publicServiceContext } from '@/lib/http/context';
import { lookupRedirect } from '@/lib/services/seo';

export const runtime = 'edge';

/**
 * Admin-managed redirects (the /admin/redirects screen → `seo_redirects`), applied at the edge.
 * Next.js only routes here when NO other route matched, so real pages pay zero overhead — a missed
 * path costs one indexed lookup, then either a permanent redirect or the normal 404. Build-time
 * redirects (next.config.mjs) still run first and never reach this.
 */
export default async function MissingPage({
  params,
}: {
  params: Promise<{ missing: string[] }>;
}) {
  const { missing } = await params;
  const path = `/${missing.map((s) => decodeURIComponent(s)).join('/')}`;
  let to: string | null = null;
  try {
    to = await lookupRedirect(publicServiceContext(), path);
  } catch {
    /* DB unavailable / not migrated — behave like a plain 404 */
  }
  if (to && to.startsWith('/') && to !== path) permanentRedirect(to);
  notFound();
}
