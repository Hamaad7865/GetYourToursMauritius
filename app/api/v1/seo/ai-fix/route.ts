import { apiHandler, parseJsonBody } from '@/lib/http/handler';
import { preflightResponse } from '@/lib/http/cors';
import { requireUser } from '@/lib/http/auth';
import { jsonOk, jsonError } from '@/lib/http/envelope';
import { rateLimit } from '@/lib/http/rate-limit';
import { buildServiceContext } from '@/lib/http/context';
import { createServiceRoleClient } from '@/lib/supabase/admin';
import { SITE } from '@/lib/seo/site';
import { BRAND_SUFFIX } from '@/lib/seo/page-registry';
import { buildSeoPageGroups, buildAuditPages } from '@/lib/seo/page-groups';
import { loadPosts } from '@/lib/content/blog-live';
import { runSeoAiFix, type SeoFixPage, type SeoFixPort } from '@/lib/services/seo-ai-fix';
import { seoAiFixRequestSchema, seoAiFixResponseSchema } from '@/lib/validation/seo-ai-fix';

export const runtime = 'edge';

/**
 * POST /api/v1/seo/ai-fix — one-click Gemini rewrite of a Health-check issue.
 *
 * Content-editor only (staff/admin/seo — the 'seo' role IS admitted: titles and descriptions
 * carry no customer data, and this is exactly that hire's job). Rate-limited before the gate
 * because every call runs a model (max two generations per click, server-side).
 *
 * The server NEVER writes: it returns a VERIFIED rewrite (or an unverified suggestion with the
 * reasons), and the browser persists it through the existing RLS-gated editor paths — the same
 * "server proposes, browser applies" split as the admin assistant.
 */
export const POST = apiHandler(async (req) => {
  await rateLimit(req, 'seo_ai_fix', 20, 60);

  const user = await requireUser(req);
  const admin = createServiceRoleClient();
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (profile?.role !== 'admin' && profile?.role !== 'staff' && profile?.role !== 'seo') {
    return jsonError(403, 'forbidden', 'Content editors only');
  }

  const body = await parseJsonBody(req, seoAiFixRequestSchema);
  const ctx = buildServiceContext(req);

  const port: SeoFixPort = {
    listPages: async (): Promise<SeoFixPage[]> => {
      const [groups, base, posts] = await Promise.all([
        buildSeoPageGroups(),
        buildAuditPages(),
        loadPosts(),
      ]);
      const templated = new Map<string, boolean>();
      for (const g of groups) for (const p of g.pages) templated.set(p.path, p.templated ?? false);

      const { data: overrideRows, error: overrideError } = await admin
        .from('seo_meta')
        .select('path,title,description');
      if (overrideError) throw new Error(overrideError.message);
      const overrides = new Map((overrideRows ?? []).map((r) => [r.path as string, r] as const));

      const pages: SeoFixPage[] = base
        .filter((p) => p.overridable)
        .map((p) => {
          const o = overrides.get(p.path);
          return {
            path: p.path,
            label: p.label,
            group: p.group,
            title: (o?.title as string | null)?.trim() || p.title,
            description: (o?.description as string | null)?.trim() || p.description,
            requireBrand: templated.get(p.path) ?? false,
            kind: 'override' as const,
            slug: null,
          };
        });

      const { data: tourRows, error: tourError } = await admin
        .from('activities')
        .select('slug,title,summary,description,seo_title,seo_description')
        .eq('status', 'published');
      if (tourError) throw new Error(tourError.message);
      for (const r of tourRows ?? []) {
        const slug = r.slug as string;
        const title = (r.title as string | null) ?? '';
        pages.push({
          path: `/activities/${slug}`,
          label: title,
          group: 'Tours',
          // Mirrors tourAuditPages: seoTitle ?? "<title> | <operator>".
          title: ((r.seo_title as string | null)?.trim() ||
            `${title} | ${SITE.operator}`) as string,
          description: ((r.seo_description as string | null)?.trim() ||
            (r.summary as string | null)?.trim() ||
            (r.description as string | null)?.trim() ||
            SITE.description) as string,
          requireBrand: true,
          kind: 'tour',
          slug,
        });
      }

      for (const post of posts) {
        if (post.path === '/blog') continue;
        pages.push({
          path: post.path,
          label: post.title,
          group: 'Blog',
          // Mirrors buildAuditPages: /blog/[slug] ships a plain title, the root template brands it.
          title: `${post.metaTitle || post.title}${BRAND_SUFFIX}`,
          description: post.metaDescription,
          requireBrand: true,
          kind: 'blog',
          slug: post.slug,
        });
      }
      return pages;
    },
  };

  const result = await runSeoAiFix(ctx, port, body.path);
  if (!result.available) {
    return jsonError(503, 'not_configured', result.note ?? 'AI is not configured.');
  }
  if (!result.verified) {
    // 422, not 200: the browser must NOT save this. The suggestion rides along in `details`
    // for manual editing — same as typing it by hand.
    const parsed = seoAiFixResponseSchema.parse(result);
    return jsonError(422, 'needs_review', parsed.note ?? 'Needs manual review.', parsed);
  }
  return jsonOk(seoAiFixResponseSchema.parse(result));
});

export function OPTIONS(req: Request): Response {
  return preflightResponse(req);
}
