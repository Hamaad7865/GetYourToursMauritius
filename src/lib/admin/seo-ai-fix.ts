import { getBrowserSupabase } from '@/lib/supabase/browser';
import { seoAiFixResponseSchema, type SeoAiFixResponse } from '@/lib/validation/seo-ai-fix';

/**
 * Browser client for POST /api/v1/seo/ai-fix.
 *
 * Mirrors lib/admin/search-console.ts: same Bearer-session auth, same { ok, data } envelope,
 * and the same "not connected" vs "real failure" distinction — with one addition the endpoint
 * needs: 422 `needs_review` means the rewrite FAILED verification and must NOT be saved. The
 * suggestion rides along for manual editing only.
 */
export class SeoAiUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeoAiUnavailable';
  }
}

export interface SeoAiReview {
  title: string;
  description: string;
  note: string;
}

export class SeoAiNeedsReview extends Error {
  readonly review: SeoAiReview;
  constructor(review: SeoAiReview) {
    super(review.note);
    this.name = 'SeoAiNeedsReview';
    this.review = review;
  }
}

export async function requestSeoAiFix(path: string): Promise<SeoAiFixResponse> {
  const {
    data: { session },
  } = await getBrowserSupabase().auth.getSession();
  const res = await fetch('/api/v1/seo/ai-fix', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(session ? { authorization: `Bearer ${session.access_token}` } : {}),
    },
    body: JSON.stringify({ path }),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: unknown;
    error?: { code?: string; message?: string; details?: unknown };
  } | null;
  if (res.status === 503 && body?.error?.code === 'not_configured') {
    throw new SeoAiUnavailable(body.error.message ?? 'Gemini is not connected.');
  }
  if (res.status === 422 && body?.error?.code === 'needs_review') {
    const suggestion = seoAiFixResponseSchema.safeParse(body.error.details);
    if (suggestion.success) {
      throw new SeoAiNeedsReview({
        title: suggestion.data.title,
        description: suggestion.data.description,
        note: suggestion.data.note ?? 'Needs manual review.',
      });
    }
    throw new SeoAiNeedsReview({
      title: '',
      description: '',
      note: body.error.message ?? 'Needs manual review.',
    });
  }
  if (!res.ok || !body?.ok) {
    throw new Error(body?.error?.message ?? 'AI fix failed.');
  }
  return seoAiFixResponseSchema.parse(body.data);
}
